import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { ensureDevCallService } from '../scripts/dev-call-service.mjs';

const receive = async (socket) => JSON.parse((await once(socket, 'message'))[0].toString());

test('development startup creates invitations and a second command preserves the waiting room', { timeout: 10000 }, async (t) => {
  const service = await ensureDevCallService({ port: 0 });
  t.after(() => service.close());
  assert.equal(service.owned, true);
  const url = `ws://127.0.0.1:${service.port}/calls`;
  const host = new WebSocket(url);
  await once(host, 'open');
  const created = receive(host);
  host.send(JSON.stringify({ type: 'create', name: 'Host' }));
  const { code } = await created;
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);

  const reused = await ensureDevCallService({ port: service.port });
  assert.equal(reused.owned, false);
  await reused.close(); // Exiting the second command must not close the first.
  const guest = new WebSocket(url);
  await once(guest, 'open');
  const ready = receive(host);
  const joined = receive(guest);
  guest.send(JSON.stringify({ type: 'join', name: 'Guest', code }));
  assert.equal((await ready).peerName, 'Guest');
  assert.equal((await joined).code, code);
});

test('development startup reports a port conflict instead of silently disabling calls', { timeout: 10000 }, async (t) => {
  const other = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  other.listen(0, '0.0.0.0');
  await once(other, 'listening');
  t.after(() => new Promise((resolve) => other.close(resolve)));
  await assert.rejects(ensureDevCallService({ port: other.address().port }), /occupied by another service/);
});
