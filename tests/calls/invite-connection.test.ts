/// <reference types="node" />
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CallSession } from '../../src/calls/call-session';
import { createInvite, resolveCallTarget } from '../../src/calls/protocol';

// Use the Node transport with the same onopen/onmessage API as the native app.
const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const { WebSocket: Socket } = jest.requireActual(join(dirname(nodeRequire.resolve('ws/package.json')), 'index.js'));
class Stream {
  private track = { id: 'video', enabled: true, kind: 'video', stop() {} };
  getTracks() { return [this.track]; }
  getVideoTracks() { return [this.track]; }
  getAudioTracks() { return []; }
  release() {}
}
class Peer {
  private resolveRemote!: (description: { type: string }) => void;
  readonly remoteApplied = new Promise<{ type: string }>((resolve) => { this.resolveRemote = resolve; });
  localDescription: { toJSON: () => object } | null = null;
  remoteDescription: object | null = null;
  addEventListener() {}
  addTrack() {}
  addTransceiver() { return { sender: { async replaceTrack() {} } }; }
  getTransceivers() { return [{ receiver: { track: { kind: 'audio' } }, direction: 'recvonly', sender: { async replaceTrack() {} } }]; }
  createDataChannel() { return { label: 'signbridge-captions-v1', readyState: 'connecting', addEventListener() {}, close() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0' }; }
  async setLocalDescription(value: object) { this.localDescription = { toJSON: () => value }; }
  async setRemoteDescription(value: { type: string }) { this.remoteDescription = value; this.resolveRemote(value); }
  async addIceCandidate() {}
  close() {}
}

describe('actual app invitation flow through real call services', () => {
  let server: ChildProcess;
  let urls: string[];
  const sessions: CallSession[] = [];
  beforeAll(async () => {
    const source = `
      import { createCallServer } from './server/calls.mjs';
      import { once } from 'node:events';
      const urls=[];
      for(let i=0;i<2;i++) {
        const service=createCallServer({env:{}});
        service.server.listen(0,'127.0.0.1');
        await once(service.server,'listening');
        urls.push('ws://127.0.0.1:'+service.server.address().port+'/calls');
      }
      console.log(JSON.stringify(urls));
    `;
    server = spawn(process.execPath, ['--input-type=module', '--eval', source], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    urls = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Call test services did not start.')), 5000);
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.stdout!.once('data', (chunk) => { clearTimeout(timeout); resolve(JSON.parse(chunk.toString())); });
      server.stderr!.once('data', (chunk) => { clearTimeout(timeout); reject(new Error(chunk.toString())); });
    });
  }, 10000);
  afterEach(() => { for (const session of sessions.splice(0)) session.end(); });
  afterAll(async () => {
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  });

  function caller() {
    const peers: Peer[] = [];
    let peerCreated!: (peer: Peer) => void;
    const firstPeer = new Promise<Peer>((resolve) => { peerCreated = resolve; });
    const listeners = new Set<() => void>();
    const rtc = {
      mediaDevices: { async getUserMedia() { return new Stream(); } }, MediaStream: Stream,
      RTCPeerConnection: class extends Peer { constructor() { super(); peers.push(this); peerCreated(this); } },
      RTCSessionDescription: class { constructor(value: object) { Object.assign(this, value); } },
      RTCIceCandidate: class { constructor(value: object) { Object.assign(this, value); } },
    };
    const session = new CallSession(rtc as unknown as ConstructorParameters<typeof CallSession>[0], (url) => new Socket(url), () => {
      for (const listener of listeners) listener();
    });
    sessions.push(session);
    const waitFor = (phase: string) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { listeners.delete(check); reject(new Error(`Expected ${phase}: ${session.state.message}`)); }, 5000);
      const check = () => {
        if (session.state.phase !== phase) return;
        clearTimeout(timeout); listeners.delete(check); resolve();
      };
      listeners.add(check); check();
    });
    return { session, peers, firstPeer, waitFor };
  }

  it('reproduces the wrong-server rejection, then joins with the copied host invite and exchanges offer/answer', async () => {
    const host = caller();
    await host.session.start(urls[0], { action: 'create', name: 'Host', microphone: false, captions: false });
    await host.waitFor('waiting');
    const code = host.session.state.code;
    const wrong = caller();
    const wrongTarget = resolveCallTarget(code, urls[1], true);
    await wrong.session.start(wrongTarget.url, { action: 'join', name: 'Guest', code: wrongTarget.code, microphone: false, captions: false });
    await wrong.waitFor('error');
    expect(wrong.session.state.message).toContain('No call matches this code');
    expect(host.session.state.phase).toBe('waiting');

    const guest = caller();
    const copied = createInvite(code, host.session.state.serviceUrl);
    const target = resolveCallTarget(copied, urls[1], true);
    await guest.session.start(target.url, { action: 'join', name: 'Guest', code: target.code, microphone: false, captions: false });
    await Promise.all([host.waitFor('connecting'), guest.waitFor('connecting')]);
    const [hostPeer, guestPeer] = await Promise.all([host.firstPeer, guest.firstPeer]);
    const [answer, offer] = await Promise.all([hostPeer.remoteApplied, guestPeer.remoteApplied]);
    expect(answer.type).toBe('answer'); expect(offer.type).toBe('offer');
    expect(guest.session.state.peerName).toBe('Host'); expect(host.session.state.peerName).toBe('Guest');
    expect(guest.session.state.code).toBe(code);
  });

  it('joins with the same plain code while the host shares it, then exchanges SDP when the host returns', async () => {
    const host = caller(); const guest = caller();
    await host.session.start(urls[0], { action: 'create', name: 'Host', microphone: false, captions: false });
    await host.waitFor('waiting');
    host.session.setAppActive(false);
    const target = resolveCallTarget(host.session.state.code, urls[0], true);
    await guest.session.start(target.url, { action: 'join', name: 'Guest', code: target.code, microphone: false, captions: false });
    await guest.waitFor('connecting');
    expect(host.session.state.phase).toBe('waiting');
    expect(guest.session.state.message).toContain('Waiting for them to return');
    host.session.setAppActive(true);
    await host.waitFor('connecting');
    const [hostPeer, guestPeer] = await Promise.all([host.firstPeer, guest.firstPeer]);
    const [answer, offer] = await Promise.all([hostPeer.remoteApplied, guestPeer.remoteApplied]);
    expect(answer.type).toBe('answer'); expect(offer.type).toBe('offer');
    expect(guest.session.state.code).toBe(host.session.state.code);
  });
});
