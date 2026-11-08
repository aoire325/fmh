import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createCallServer, developmentServiceUrl, iceConfiguration } from './calls.mjs';

async function fixture(t, options = {}) {
  const service = createCallServer({ env: {}, ...options });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(() => service.close());
  const url = `ws://127.0.0.1:${service.server.address().port}/calls`;
  async function connect(options = {}) { const socket = new WebSocket(url, options); await once(socket, 'open'); return socket; }
  return { connect };
}
const receive = async (socket) => JSON.parse((await once(socket, 'message'))[0].toString());
const send = (socket, value) => socket.send(JSON.stringify(value));

test('two clients join a private room, exchange SDP and ICE, and receive hang-up', async (t) => {
  const { connect } = await fixture(t);
  const host = await connect(); const guest = await connect();
  const created = receive(host); send(host, { type: 'create', name: 'Alice' });
  const { code } = await created; assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  const hostReady = receive(host); const guestReady = receive(guest);
  send(guest, { type: 'join', name: 'Bob', code });
  assert.equal((await hostReady).initiator, true); assert.equal((await guestReady).peerName, 'Alice');
  const offer = receive(guest); send(host, { type: 'description', description: { type: 'offer', sdp: 'v=0' } });
  assert.equal((await offer).description.sdp, 'v=0');
  const ice = receive(host); send(guest, { type: 'ice', candidate: { candidate: 'candidate', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await ice).type, 'ice');
  const ended = receive(guest); send(host, { type: 'leave' }); assert.equal((await ended).type, 'ended');
});

test('a third caller cannot enter a full room, and a closed invite cannot be reused', async (t) => {
  const { connect } = await fixture(t); const host = await connect(); const guest = await connect(); const extra = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  const ready = receive(guest); send(guest, { type: 'join', name: 'Guest', code }); await ready;
  const rejected = receive(extra); send(extra, { type: 'join', name: 'Extra', code }); assert.equal((await rejected).type, 'error');
  const ended = receive(guest); host.close(); await ended;
  const expired = receive(extra); send(extra, { type: 'join', name: 'Extra', code }); assert.equal((await expired).type, 'error');
});

test('guessed codes, invalid names, and non-signaling payloads are rejected', async (t) => {
  const { connect } = await fixture(t); const client = await connect();
  let reply = receive(client); send(client, { type: 'join', name: 'Guest', code: 'AAAAAAAAAAAA' }); assert.equal((await reply).type, 'error');
  reply = receive(client); send(client, { type: 'create', name: '' }); assert.equal((await reply).type, 'error');
  reply = receive(client); send(client, { type: 'create', name: 'Host' }); await reply;
  // Once a peer exists, captions cannot be smuggled through the signaling server.
  const close = once(client, 'close'); client.send('invalid JSON'); assert.equal((await close)[0], 1008);
});

test('production requires relay credentials and issues expiring TURN passwords', () => {
  assert.throws(() => iceConfiguration({ NODE_ENV: 'production' }), /TURN/);
  const config = iceConfiguration({ NODE_ENV: 'production', TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:5349', TURN_SECRET: 'test-only' });
  assert.equal(config.length, 2); assert.ok(config[1].credential); assert.ok(Number(config[1].username.split(':')[0]) > Date.now() / 1000);
  assert.throws(() => iceConfiguration({ TURN_URLS: 'https://wrong.example.com' }), /TURN_URLS/);
});

test('a guest can paste a lowercase invite with smart dashes and nonbreaking spaces', async (t) => {
  const { connect } = await fixture(t); const host = await connect(); const guest = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  const formatted = code.toLowerCase().match(/.{4}/g).join('\u00a0–\u00a0');
  const ready = receive(guest); send(guest, { type: 'join', name: 'Guest', code: formatted });
  assert.equal((await ready).code, code);
});

test('an expired invite immediately informs the waiting host instead of leaving a stale call screen', async (t) => {
  let clock = 1000;
  const { connect } = await fixture(t, { now: () => clock }); const host = await connect(); const guest = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  clock += 15 * 60000 + 1;
  const ended = receive(host); const rejected = receive(guest);
  send(guest, { type: 'join', name: 'Guest', code });
  assert.equal((await rejected).code, 'invite_expired');
  assert.equal((await ended).type, 'ended');
});

test('distinguishes invalid, missing and full invitations without evicting existing callers', async (t) => {
  const { connect } = await fixture(t); const host = await connect(); const guest = await connect(); const extra = await connect();
  let reply = receive(extra); send(extra, { type: 'join', name: 'Extra', code: 'wrong' });
  assert.equal((await reply).code, 'invalid_invite');
  reply = receive(extra); send(extra, { type: 'join', name: 'Extra', code: 'AAAAAAAAAAAA' });
  assert.equal((await reply).code, 'invite_not_found');
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  const ready = receive(guest); send(guest, { type: 'join', name: 'Guest', code }); await ready;
  reply = receive(extra); send(extra, { type: 'join', name: 'Extra', code }); assert.equal((await reply).code, 'invite_full');
  const offer = receive(guest); send(host, { type: 'description', description: { type: 'offer', sdp: 'v=0' } });
  assert.equal((await offer).type, 'description');
});

test('sharing an invite keeps the room and waits for the host before negotiating', async (t) => {
  const { connect } = await fixture(t); const host = await connect(); const guest = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  send(host, { type: 'presence', active: false });
  // A ping/pong roundtrip ensures the server processed the host's background
  // message before the guest joins over a separate socket.
  const pong = once(host, 'pong'); host.ping(); await pong;
  const waiting = receive(guest); send(guest, { type: 'join', name: 'Guest', code });
  assert.equal((await waiting).type, 'waiting_for_host');
  const hostReady = receive(host); const guestReady = receive(guest);
  send(host, { type: 'presence', active: true });
  assert.equal((await hostReady).initiator, true); assert.equal((await guestReady).initiator, false);
  // Foreground notifications during a connected call must not renegotiate.
  const messages = []; host.on('message', (raw) => messages.push(JSON.parse(raw)));
  send(host, { type: 'presence', active: true });
  const offer = receive(guest); send(host, { type: 'description', description: { type: 'offer', sdp: 'v=0' } });
  assert.equal((await offer).type, 'description'); assert.equal(messages.length, 0);
});

test('a host cannot extend the sharing grace indefinitely by repeating background messages', async (t) => {
  let clock = 0;
  const { connect } = await fixture(t, { now: () => clock }); const host = await connect(); const guest = await connect();
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  send(host, { type: 'presence', active: false });
  let pong = once(host, 'pong'); host.ping(); await pong;
  clock = 30000; send(host, { type: 'presence', active: false });
  pong = once(host, 'pong'); host.ping(); await pong;
  clock = 60000;
  const ended = receive(host); send(host, { type: 'presence', active: true });
  assert.equal((await ended).type, 'ended');
  const rejected = receive(guest); send(guest, { type: 'join', name: 'Guest', code });
  assert.equal((await rejected).code, 'invite_not_found');
});

test('development invites use LAN addresses for USB hosts, and prefer the interface the phone reached', () => {
  const interfaces = {
    utun0: [{ address: '10.9.0.2', family: 'IPv4', internal: false }],
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
  };
  assert.equal(developmentServiceUrl('127.0.0.1', 8787, interfaces), 'ws://192.168.1.10:8787/calls');
  assert.equal(developmentServiceUrl('::ffff:127.0.0.1', 8787, interfaces), 'ws://192.168.1.10:8787/calls');
  assert.equal(developmentServiceUrl('10.9.0.2', 8787, interfaces), 'ws://10.9.0.2:8787/calls');
  assert.equal(developmentServiceUrl('127.0.0.1', 8787, {}), undefined);
});

test('a suspended waiting host survives heartbeat checks during the sharing grace period', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 0;
  const { connect } = await fixture(t, { now: () => clock });
  const host = await connect({ autoPong: false });
  const creation = receive(host); send(host, { type: 'create', name: 'Host' }); const { code } = await creation;
  send(host, { type: 'presence', active: false });
  const pong = once(host, 'pong'); host.ping(); await pong;
  clock = 45000; t.mock.timers.tick(45000);
  const guest = await connect(); const waiting = receive(guest);
  send(guest, { type: 'join', name: 'Guest', code });
  assert.equal((await waiting).type, 'waiting_for_host');
  const hostReady = receive(host); const guestReady = receive(guest);
  send(host, { type: 'presence', active: true });
  assert.equal((await hostReady).type, 'ready'); assert.equal((await guestReady).type, 'ready');
});
