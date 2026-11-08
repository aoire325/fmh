import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createVoiceService } from './voice-service.mjs';

const owner = 'a'.repeat(64); const other = 'b'.repeat(64);
const configuredEnv = { ELEVENLABS_API_KEY: 'test-provider-key' };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'talkbridge-voice-test-'));
  const calls = []; const temporaryPaths = [];
  let verificationRequired = false; let verified = false; let deleteStatus = 200; let synthStatus = 200; let invalidSample = false;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers['xi-api-key'], configuredEnv.ELEVENLABS_API_KEY);
    calls.push({ url, init });
    if (url.includes('/v2/voices')) return Response.json({ voices: [
      { voice_id: 'current-male', name: 'Alex', labels: { gender: 'male' } },
      { voice_id: 'current-female', name: 'Jane', labels: { gender: 'female' } },
    ] });
    if (url.endsWith('/v1/voices/add')) {
      assert.equal(init.body.get('name'), 'TalkBridge — My voice');
      const audio = init.body.get('files');
      assert.equal(audio.type, 'audio/wav'); assert.equal(await audio.text(), 'sample audio');
      return Response.json({ voice_id: 'private-clone', requires_verification: verificationRequired });
    }
    if (init.method === 'DELETE') return new Response(null, { status: deleteStatus });
    if (url.includes('/v1/text-to-speech')) return new Response('fake mp3', { status: synthStatus, headers: { 'Content-Type': 'audio/mpeg' } });
    if (url.endsWith('/v1/voices/private-clone')) return Response.json({ is_owner: true, voice_verification: { is_verified: verified } });
    throw new Error(`Unexpected provider call: ${url}`);
  };
  const serviceOptions = { env: configuredEnv, dataDirectory: join(directory, 'profiles'), fetchImpl,
    extractSample: async (input, output) => {
      temporaryPaths.push(dirname(input));
      assert.equal(await readFile(input, 'utf8'), 'video with audible speech');
      if (invalidSample) throw Object.assign(new Error('bad sample'), { status: 422 });
      await writeFile(output, 'sample audio');
    }, ...options };
  let service = createVoiceService(serviceOptions);
  const server = createServer((request, response) => {
    if (!request.url.startsWith('/voice/')) { response.writeHead(404); response.end(); return; }
    void service.handle(request, response);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  const request = (path, init = {}, identity = owner) => fetch(`http://127.0.0.1:${server.address().port}/voice/${path}`, {
    ...init, headers: { 'X-Voice-Owner': identity, ...init.headers },
  });
  const upload = (init = {}) => request('profile?name=My%20voice', { method: 'POST', body: 'video with audible speech',
    ...init, headers: { 'Content-Type': 'video/mp4', 'X-Voice-Consent': 'own-voice-v1', ...init.headers } });
  const speak = (voice = 'personal', init = {}, identity = owner) => request('speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'I need some water.', voice, rate: 1 }), ...init,
  }, identity);
  return { request, upload, speak, calls, temporaryPaths, restart: () => { service = createVoiceService(serviceOptions); },
    verification: (required, complete = false) => { verificationRequired = required; verified = complete; },
    rejectDeletes: (status) => { deleteStatus = status; }, rejectSpeech: (status) => { synthStatus = status; },
    rejectSample: () => { invalidSample = true; } };
}

test('missing credentials and incomplete production configuration report unavailable without making provider calls', async (t) => {
  for (const env of [{}, { ...configuredEnv, NODE_ENV: 'production' }]) {
    const f = await fixture(t, { env });
    const status = await (await f.request('status')).json();
    assert.equal(status.configured, false);
    assert.equal((await f.speak('male')).status, 503); assert.equal(f.calls.length, 0);
  }
});
test('configured access keys and owner capabilities are checked before using paid endpoints', async (t) => {
  const f = await fixture(t, { env: { ...configuredEnv, NODE_ENV: 'production', VOICE_SERVICE_TOKEN: 'private-access' } });
  assert.equal((await f.request('voices')).status, 401);
  assert.equal((await f.request('voices', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await f.request('profile', { headers: { Authorization: 'Bearer private-access' } }, 'bad')).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('voices', { headers: { Authorization: 'Bearer private-access' } })).status, 200);
});
test('male and female presets resolve current provider voices and produce different speech requests', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('voices')).json(), { male: 'Alex', female: 'Jane' });
  for (const gender of ['male', 'female']) {
    const response = await f.speak(gender);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg'); assert.equal(await response.text(), 'fake mp3');
    const call = f.calls.at(-1);
    assert.match(call.url, new RegExp(`/current-${gender}\\?`));
    assert.equal(JSON.parse(call.init.body).text, 'I need some water.');
  }
  assert.equal(f.calls.filter((call) => call.url.includes('/v2/voices')).length, 1);
});
test('upload extracts audio, creates a persistent private profile, and removes temporary media', async (t) => {
  const f = await fixture(t);
  const result = await f.upload(); assert.equal(result.status, 201);
  const created = await result.json();
  assert.equal(created.profile.status, 'ready'); assert.equal(created.profile.name, 'My voice');
  assert.equal(JSON.stringify(created).includes('private-clone'), false);
  await assert.rejects(access(f.temporaryPaths[0]));
  f.restart();
  assert.deepEqual(await (await f.request('profile')).json(), created);
  assert.deepEqual(await (await f.request('profile', {}, other)).json(), { profile: null });
  const before = f.calls.length;
  assert.equal((await f.speak('personal', {}, other)).status, 404); assert.equal(f.calls.length, before);
  assert.equal((await f.speak()).status, 200); assert.match(f.calls.at(-1).url, /text-to-speech\/private-clone/);
  assert.equal((await f.upload()).status, 409);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/voices/add')).length, 1);
});
test('consent, file format, empty video, and short or unusable speech are rejected', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.upload({ headers: { 'X-Voice-Consent': '' } })).status, 400);
  assert.equal((await f.upload({ headers: { 'Content-Type': 'application/json' } })).status, 415);
  // A separate address/owner fixture keeps clone throttling independent of validation checks.
  const g = await fixture(t);
  assert.equal((await g.upload({ body: '' })).status, 400);
  g.rejectSample(); assert.equal((await g.upload()).status, 422);
  assert.equal(g.calls.length, 0);
  await assert.rejects(access(g.temporaryPaths[0]));
});
test('verification-required voices never synthesize until the provider confirms verification', async (t) => {
  const f = await fixture(t); f.verification(true);
  assert.equal((await (await f.upload()).json()).profile.status, 'verification_required');
  assert.equal((await f.speak()).status, 409);
  assert.equal((await (await f.request('profile')).json()).profile.status, 'verification_required');
  f.verification(true, true);
  assert.equal((await (await f.request('profile')).json()).profile.status, 'ready');
  assert.equal((await f.speak()).status, 200);
});
test('failed provider deletion preserves the profile for retry; success deletes both', async (t) => {
  const f = await fixture(t); await f.upload();
  const before = f.calls.length;
  assert.equal((await f.request('profile', { method: 'DELETE' }, other)).status, 200); assert.equal(f.calls.length, before);
  f.rejectDeletes(500); assert.equal((await f.request('profile', { method: 'DELETE' })).status, 502);
  assert.equal((await (await f.request('profile')).json()).profile.status, 'ready');
  f.rejectDeletes(200); assert.equal((await f.request('profile', { method: 'DELETE' })).status, 200);
  assert.equal((await (await f.request('profile')).json()).profile, null);
  assert.equal((await f.speak()).status, 404);
});
test('deleting a voice already removed at the provider clears the local profile too', async (t) => {
  const f = await fixture(t); await f.upload(); f.rejectDeletes(404);
  assert.equal((await f.request('profile', { method: 'DELETE' })).status, 200);
  assert.equal((await (await f.request('profile')).json()).profile, null);
});
test('speech rejects invalid or excessive text, unsupported speeds, arbitrary voice IDs, and provider failures', async (t) => {
  const f = await fixture(t);
  for (const body of [null, { text: '' }, { text: 'a'.repeat(1201), voice: 'male', rate: 1 },
    { text: 'Hello', voice: 'somebody-elses-clone', rate: 1 }, { text: 'Hello', voice: 'male', rate: 2 }]) {
    assert.equal((await f.speak('male', { body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(f.calls.length, 0);
  f.rejectSpeech(429);
  const response = await f.speak('female'); assert.equal(response.status, 429);
  assert.match((await response.json()).error, /credits/);
});
test('cloning is rate limited even when the device capability changes', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) {
    const result = await f.request('profile?name=My%20voice', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: 'no consent' }, String(index).repeat(64));
    assert.equal(result.status, 400);
  }
  assert.equal((await f.upload()).status, 429); assert.equal(f.calls.length, 0);
});
