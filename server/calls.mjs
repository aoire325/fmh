import { createServer } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { createVoiceService } from './voice-service.mjs';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CALL_PROTOCOL_VERSION = 2;
const newCode = () => [...randomBytes(12)].map((value) => alphabet[value % alphabet.length]).join('');
const validCode = (value) => typeof value === 'string' && /^[A-HJ-NP-Z2-9]{12}$/.test(value);
const normalizeCode = (value) => typeof value === 'string' && value.length <= 64
  ? value.toUpperCase().replace(/[\s\-\u2010-\u2015]/g, '') : '';
const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
const privateIPv4 = (address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);

// adb reverse reaches this service through loopback. Invitations must advertise
// the computer's LAN address, not localhost on the guest's own phone.
export function developmentServiceUrl(localAddress, port, interfaces = networkInterfaces()) {
  const address = localAddress?.replace(/^::ffff:/, '');
  const lan = privateIPv4(address || '') ? address : Object.entries(interfaces)
    .sort(([a], [b]) => Number(!/^(en|eth|wlan)/.test(a)) - Number(!/^(en|eth|wlan)/.test(b)))
    .flatMap(([, entries]) => entries || [])
    .find((entry) => !entry.internal && entry.family === 'IPv4' && privateIPv4(entry.address))?.address;
  return lan ? `ws://${lan}:${port}/calls` : undefined;
}

export function iceConfiguration(env = process.env) {
  const urls = (env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (urls.some((url) => !/^turns?:[^\s]+$/.test(url))) throw new Error('TURN_URLS must contain turn: or turns: URLs.');
  if (env.NODE_ENV === 'production' && (!urls.length || !env.TURN_SECRET)) {
    throw new Error('Production calls require TURN_URLS and TURN_SECRET for relay connectivity.');
  }
  const result = [{ urls: ['stun:stun.l.google.com:19302'] }];
  if (urls.length && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 10800}:${randomBytes(8).toString('hex')}`;
    result.push({ urls, username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return result;
}

/** Two-person, capability-based rooms. Possession of the random invitation is access.
 * Only connection metadata passes through this service; captions use the encrypted
 * WebRTC data channel. Nothing is persisted, and room codes/SDP are never logged.
 */
export function createCallServer({ env = process.env, now = Date.now } = {}) {
  iceConfiguration(env); // Fail at startup if deployment configuration is incomplete.
  const rooms = new Map();
  const addresses = new Map();
  const voice = createVoiceService({ env, now });
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/voice/')) { void voice.handle(request, response); return; }
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(request.url === '/health' ? { ok: true, service: 'signbridge-calls', protocol: CALL_PROTOCOL_VERSION } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ server, path: '/calls', maxPayload: 65536, perMessageDeflate: false });
  const closeRoom = (code, reason = 'The other person left the call.') => {
    const room = rooms.get(code);
    if (!room) return;
    rooms.delete(code);
    for (const member of room.members) {
      member.room = null;
      send(member.socket, { type: 'ended', message: reason });
      member.socket.close(1000);
    }
  };
  const readyRoom = (code, room) => {
    if (room.connectedAt !== null || room.members.length !== 2) return;
    if (room.members[0].inactiveAt !== null) {
      send(room.members[1].socket, { type: 'waiting_for_host', code }); return;
    }
    room.connectedAt = now();
    const iceServers = iceConfiguration(env);
    room.members.forEach((person, index) => send(person.socket, {
      type: 'ready', code, initiator: index === 0, peerName: room.members[1 - index].name, iceServers,
    }));
  };
  wss.on('connection', (socket, request) => {
    // Use the socket address, not an untrusted forwarded header. A reverse proxy
    // should additionally rate-limit upgrades by the actual client IP.
    const address = request.socket.remoteAddress || 'unknown';
    if (wss.clients.size > 500 || (addresses.get(address) || 0) >= 30) { socket.close(1013); return; }
    addresses.set(address, (addresses.get(address) || 0) + 1);
    const member = { socket, room: null, name: '', joinedAt: now(), alive: true, count: 0, window: now(), attempts: 0, inactiveAt: null };
    socket.on('pong', () => { member.alive = true; });
    socket.on('message', (raw, binary) => {
      if (now() - member.window > 10000) { member.window = now(); member.count = 0; }
      if (++member.count > 120 || binary) { socket.close(1008); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008); return; }
      if (!message || typeof message !== 'object') { socket.close(1008); return; }
      if (message.type === 'create' || message.type === 'join') {
        if (member.room || ++member.attempts > 5) { socket.close(1008); return; }
        if (typeof message.name !== 'string' || !message.name.trim() || message.name.length > 40) {
          send(socket, { type: 'error', message: 'Enter a display name of up to 40 characters.' }); return;
        }
        member.name = message.name.trim().replace(/[\x00-\x1f\x7f]/g, '');
        if (!member.name) { socket.close(1008); return; }
        if (message.type === 'create') {
          let code = newCode();
          while (rooms.has(code)) code = newCode();
          member.room = code;
          rooms.set(code, { members: [member], createdAt: now(), connectedAt: null });
          const serviceUrl = env.NODE_ENV === 'production' ? undefined
            : developmentServiceUrl(request.socket.localAddress, server.address().port);
          send(socket, { type: 'created', code, ...(serviceUrl ? { serviceUrl } : {}) });
        } else {
          const code = normalizeCode(message.code);
          if (!validCode(code)) {
            send(socket, { type: 'error', code: 'invalid_invite', message: 'Enter the complete 12-character invite code. Copy it from the host to avoid mistaking letters for numbers.' }); return;
          }
          const room = rooms.get(code);
          if (!room) {
            send(socket, { type: 'error', code: 'invite_not_found', message: 'No call matches this code on this call service. Ask the host to start a new call and use Copy invite. Paste the complete invite here so both phones reach the same service. The host must return to TalkBridge after sharing.' }); return;
          }
          if (room.members.length !== 1) {
            send(socket, { type: 'error', code: 'invite_full', message: 'This call already has two people. The host must start a new call to invite you.' }); return;
          }
          if (now() - room.createdAt > 15 * 60000) {
            closeRoom(code, 'Your invite expired after 15 minutes. Start a new call for a fresh code.');
            send(socket, { type: 'error', code: 'invite_expired', message: 'This invite expired after 15 minutes. Ask the host to start a new call and copy the new code.' }); return;
          }
          if (room.members[0].inactiveAt !== null && now() - room.members[0].inactiveAt >= 60000) {
            closeRoom(code, 'The host did not return to TalkBridge. Start a new call.');
            send(socket, { type: 'error', code: 'invite_expired', message: 'The host’s sharing break expired. Ask them to open TalkBridge and start a new call.' }); return;
          }
          if (room.members[0].socket.readyState !== WebSocket.OPEN) {
            closeRoom(code);
            send(socket, { type: 'error', code: 'host_disconnected', message: 'The host disconnected. Ask them to reopen SignBridge and start a new call.' }); return;
          }
          member.room = code; room.members.push(member);
          readyRoom(code, room);
        }
        return;
      }
      const room = rooms.get(member.room);
      if (!room) { socket.close(1008); return; }
      if (message.type === 'leave') { closeRoom(member.room); return; }
      if (message.type === 'presence') {
        if (typeof message.active !== 'boolean') { socket.close(1008); return; }
        // A bounded sharing break applies only before negotiation begins.
        if (!message.active && room.connectedAt === null && room.members[0] === member) {
          member.inactiveAt ??= now();
        } else if (message.active) {
          if (member.inactiveAt !== null && now() - member.inactiveAt >= 60000) {
            closeRoom(member.room, 'The host did not return to TalkBridge. Start a new call.'); return;
          }
          member.inactiveAt = null; member.alive = true;
          readyRoom(member.room, room);
        }
        return;
      }
      const peer = room.members.find((person) => person !== member);
      if (!peer) return;
      if (message.type === 'description') {
        const description = message.description;
        const expected = room.members[0] === member ? 'offer' : 'answer';
        if (!description || description.type !== expected || typeof description.sdp !== 'string' || description.sdp.length > 60000) {
          socket.close(1008); return;
        }
        send(peer.socket, { type: 'description', description: { type: description.type, sdp: description.sdp } });
      } else if (message.type === 'ice') {
        const candidate = message.candidate;
        if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096
          || (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 100))
          || (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 20))) {
          socket.close(1008); return;
        }
        send(peer.socket, { type: 'ice', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } });
      } else socket.close(1008);
    });
    socket.on('close', () => {
      addresses.set(address, Math.max(0, (addresses.get(address) || 1) - 1));
      if (!addresses.get(address)) addresses.delete(address);
      if (member.room) closeRoom(member.room);
    });
    socket.on('error', () => socket.close());
    socket.member = member;
  });
  const sweep = setInterval(() => {
    for (const [code, room] of rooms) {
      if ((room.connectedAt === null && now() - room.createdAt > 15 * 60000) || (room.connectedAt !== null && now() - room.connectedAt > 2 * 3600000)
        || (room.members[0].inactiveAt !== null && now() - room.members[0].inactiveAt >= 60000)) {
        closeRoom(code, 'This call expired. Start a new call to continue.');
      }
    }
    for (const socket of wss.clients) {
      const member = socket.member;
      if (!member) continue;
      // iOS can suspend JavaScript and WebSocket pongs while the host shares.
      if (member.inactiveAt !== null && now() - member.inactiveAt < 60000) continue;
      if (!member.alive || (!member.room && now() - member.joinedAt > 30000)) { socket.terminate(); continue; }
      member.alive = false; socket.ping();
    }
  }, 15000);
  sweep.unref();
  wss.on('close', () => clearInterval(sweep));
  return { server, wss, close: async () => {
    clearInterval(sweep);
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createCallServer();
  const port = Number(process.env.PORT || 8787);
  server.listen(port, '0.0.0.0', () => console.log(`SignBridge call signaling listening on port ${port}`));
}
