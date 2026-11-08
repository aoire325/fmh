import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensureDevCallService } from './dev-call-service.mjs';
import { maintainAndroidConnections } from './dev-android-connection.mjs';

const require = createRequire(import.meta.url);

async function main() {
  // Voice provider credentials stay on this Node service, outside the mobile bundle.
  try { process.loadEnvFile(fileURLToPath(new URL('../server/.env.local', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Start signaling before Expo so creating a call works as soon as the app opens.
  const service = await ensureDevCallService();
  const portArgument = process.argv.findIndex((value) => value === '--port' || value === '-p');
  const metroPort = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 8081;
  const android = maintainAndroidConnections({ ports: [...new Set([metroPort, service.port])].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535) });
  console.log(`TalkBridge call service ${service.owned ? 'started' : 'already running'} on port ${service.port}.`);
  const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), ...process.argv.slice(2)], { stdio: 'inherit' });
  const stop = (signal) => child.kill(signal);
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1)));
    });
    process.exitCode = code;
  } finally {
    android.stop();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    await service.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
