import { once } from 'node:events';
import { createCallServer } from '../server/calls.mjs';

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
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      const health = await response.json();
      if (response.ok && health.ok === true && health.service === 'signbridge-calls') {
        return { owned: false, port, close: async () => {} };
      }
    } catch { /* Report an occupied port with an actionable error below. */ }
    throw new Error(`Port ${port} is occupied by another service. Stop it, then start TalkBridge again.`);
  }
}
