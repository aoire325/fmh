import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
function adbExecutable() {
  const name = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean);
  return roots.map((root) => join(root, 'platform-tools', name)).find(existsSync) ?? name;
}

/** USB reconnects discard adb reverse mappings. Expo restores Metro alone;
 * keep the call/voice service reachable too, only on authorized TalkBridge devices.
 * Never open screens, change permissions, or interrupt an existing connection.
 */
export function maintainAndroidConnections({ run = (args) => execute(adbExecutable(), args, { timeout: 4000 }),
  ports = [8081, 8787], intervalMs = 5000 } = {}) {
  let stopped = false;
  let pending = null;
  async function repair() {
    const { stdout } = await run(['devices']);
    const devices = stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/))
      .filter(([, state]) => state === 'device').map(([serial]) => serial);
    for (const serial of devices) {
      if (stopped) return;
      try {
        const installed = await run(['-s', serial, 'shell', 'pm', 'path', 'com.signbridge.asl']);
        if (!installed.stdout.trim().startsWith('package:')) continue;
        const mappings = await run(['-s', serial, 'reverse', '--list']);
        const current = new Set(mappings.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/).slice(-2).join(' ')));
        for (const port of ports) {
          if (stopped) return;
          const socket = `tcp:${port}`;
          if (!current.has(`${socket} ${socket}`)) await run(['-s', serial, 'reverse', socket, socket]);
        }
      } catch { /* A phone can disconnect during any ADB request. Retry on the next pass. */ }
    }
  }
  const check = () => {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    pending = repair().catch(() => {}).finally(() => { pending = null; });
    return pending;
  };
  const timer = setInterval(() => { void check(); }, intervalMs);
  timer.unref();
  void check();
  return { check, stop: () => { stopped = true; clearInterval(timer); } };
}
