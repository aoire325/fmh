import { once } from 'node:events';
import { CALL_PROTOCOL_VERSION, createCallServer } from '../server/calls.mjs';

// Keep the development signaling port in sync with protocol.ts and adb reverse.
export async function ensureDevCallService({ port = 8787 } = {}) {
  const service = createCallServer({ env: { ...process.env, NODE_ENV: 'development' } });
  // ws forwards HTTP listen errors before the listening promise handles them.
  service.wss.on('error', () => {});
  try {
    service.server.listen(port, '0.0.0.0');
    await once(service.server, 'listening');
    return { owned: true, port: service.server.address().port, close: service.close };
  } catch (error) {
    await service.close();
    if (error.code !== 'EADDRINUSE') throw error;
    // A second Expo command must share the existing rooms, not replace them.
    let incompatible = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      const health = await response.json();
      if (response.ok && health.ok === true && health.service === 'signbridge-calls') {
        if (health.protocol === CALL_PROTOCOL_VERSION) return { owned: false, port, close: async () => {} };
        incompatible = true;
      }
    } catch { /* Report an occupied port with an actionable error below. */ }
    if (incompatible) throw new Error(`An incompatible TalkBridge call service is running on port ${port}. Stop the older development server, then start this project again so both phones use the updated call service.`);
    throw new Error(`Port ${port} is occupied by another service. Stop it, then start TalkBridge again.`);
  }
}
