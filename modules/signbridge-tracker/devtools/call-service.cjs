const { WebSocket } = require('ws');

const CALL_PATH = '/_expo/plugins/signbridge-tracker/calls';

// SDK 58 mounts this WebSocket endpoint on Metro's own port. A guest on
// another laptop can reach the same host/port as the app, without a second
// firewall rule for 8787. Every proxy still uses the one local room directory.
function createCallProxy({ serviceUrl = 'ws://127.0.0.1:8787/calls' } = {}) {
  return (client, request) => {
    const upstream = new WebSocket(serviceUrl, { maxPayload: 65536, perMessageDeflate: false, autoPong: false });
    const pending = [];
    let pendingBytes = 0;
    const close = (socket, code = 1000, reason = '') => {
      if (socket.readyState === WebSocket.CONNECTING) { socket.terminate(); return; }
      if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    };
    client.on('message', (data, binary) => {
      if (binary || data.length > 65536) { close(client, 1009); return; }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: false });
      else if (upstream.readyState === WebSocket.CONNECTING && pendingBytes + data.length <= 65536) {
        pending.push(data); pendingBytes += data.length;
      } else close(client, 1011, 'The host call service is unavailable.');
    });
    upstream.on('open', () => {
      if (client.readyState !== WebSocket.OPEN) { close(upstream); return; }
      for (const data of pending.splice(0)) upstream.send(data, { binary: false });
      pendingBytes = 0;
    });
    upstream.on('message', async (data, binary) => {
      if (client.readyState !== WebSocket.OPEN) return;
      try {
        const message = !binary && JSON.parse(data.toString());
        if (message.type === 'created') {
          const url = new URL(request.url);
          if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && message.serviceUrl) {
            // The backend knows the LAN address when this host uses adb reverse.
            url.hostname = new URL(message.serviceUrl).hostname;
          }
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
          url.pathname = CALL_PATH; url.search = ''; url.hash = '';
          message.serviceUrl = url.toString();
          client.send(JSON.stringify(message)); return;
        }
      } catch { /* The backend client validates its own signaling payloads. */ }
      client.send(data, { binary });
    });
    // Preserve end-to-end heartbeat checks rather than keeping an abandoned
    // phone's room alive by automatically replying from the proxy.
    upstream.on('ping', (data) => { if (client.readyState === WebSocket.OPEN) client.ping(data); });
    client.on('pong', (data) => { if (upstream.readyState === WebSocket.OPEN) upstream.pong(data); });
    upstream.on('error', () => close(client, 1011, 'The host call service is unavailable. Restart npm start on the host laptop.'));
    client.on('error', () => close(upstream));
    client.on('close', () => close(upstream));
    upstream.on('close', (code, reason) => close(client, [1005, 1006, 1015].includes(code) ? 1011 : code, reason.toString()));
  };
}

exports.createCallProxy = createCallProxy;
exports.webSocketHandlers = { '/calls': createCallProxy() };
exports.default = async (request) => {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/health') return new Response('Not found', { status: 404 });
  try {
    return await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) });
  } catch { return Response.json({ ok: false, error: 'Start the host call service with npm start.' }, { status: 503 }); }
};
