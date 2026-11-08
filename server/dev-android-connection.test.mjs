import test from 'node:test';
import assert from 'node:assert/strict';
import { maintainAndroidConnections } from '../scripts/dev-android-connection.mjs';

test('repairs the service port after USB reconnect without replacing the existing Metro mapping', async (t) => {
  const calls = []; let forwarded = false;
  const watcher = maintainAndroidConnections({ run: async (args) => {
    calls.push(args);
    if (args[0] === 'devices') return { stdout: 'List of devices attached\nphone\tdevice\nlocked\tunauthorized\n' };
    if (args.includes('pm')) return { stdout: 'package:/data/app/talkbridge/base.apk\n' };
    if (args.includes('--list')) return { stdout: 'UsbFfs tcp:8081 tcp:8081\n' + (forwarded ? 'UsbFfs tcp:8787 tcp:8787\n' : '') };
    forwarded = true; return { stdout: '' };
  } });
  t.after(() => watcher.stop());
  await watcher.check(); await watcher.check();
  assert.deepEqual(calls.filter((args) => args.includes('reverse') && !args.includes('--list')),
    [['-s', 'phone', 'reverse', 'tcp:8787', 'tcp:8787']]);
  assert.equal(calls.some((args) => args.includes('locked')), false);
  forwarded = false; await watcher.check();
  assert.equal(calls.filter((args) => args.includes('tcp:8787')).length, 2);
});

test('ignores phones without TalkBridge and tolerates ADB being unavailable', async (t) => {
  let attempts = 0; const calls = [];
  const watcher = maintainAndroidConnections({ run: async (args) => {
    calls.push(args);
    if (++attempts === 1) throw new Error('ADB not installed');
    if (args[0] === 'devices') return { stdout: 'List of devices attached\nphone\tdevice\n' };
    return { stdout: '' };
  } });
  t.after(() => watcher.stop());
  await watcher.check(); await watcher.check();
  assert.equal(calls.some((args) => args.includes('reverse')), false);
  watcher.stop(); const count = calls.length; await watcher.check(); assert.equal(calls.length, count);
});
