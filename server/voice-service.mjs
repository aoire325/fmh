import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const API = 'https://api.elevenlabs.io';
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const CONSENT = 'own-voice-v1';
class VoiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new VoiceError(status, message); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};
const publicProfile = (profile) => profile ? {
  name: profile.name, status: profile.status, createdAt: profile.createdAt,
} : null;

async function readJson(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) fail(413, 'This speech request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Send a valid JSON speech request.'); }
}

/** Decode locally, with network protocols disabled. Only extracted audio is sent
 * to the voice provider. Temp files are removed by the caller on every outcome. */
export async function extractVoiceSample(input, output, executable = 'ffmpeg') {
  await new Promise((done, reject) => {
    const child = spawn(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-t', '120',
      '-af', 'silenceremove=start_periods=1:start_duration=0.15:start_threshold=-40dB:stop_periods=-1:stop_duration=0.75:stop_threshold=-40dB',
      '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', output], { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new VoiceError(422, 'This video took too long to process. Try a shorter clip.')); }, 60000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new VoiceError(error.code === 'ENOENT' ? 503 : 422, error.code === 'ENOENT'
        ? 'Voice creation needs FFmpeg installed on the voice service.' : 'This video could not be read. Try an MP4 or MOV recording.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(new VoiceError(422, 'No usable speech audio was found. Upload a video of the person speaking, with one clear voice.'));
    });
  });
  // PCM is mono 22,050 Hz, 16-bit. Reject short/silent output after removing silence.
  if ((await stat(output)).size < 22050 * 2 * 10) {
    fail(422, 'At least 10 seconds of audible speech is needed. Choose 30–120 seconds of clear speech without music or other speakers.');
  }
}

export function createVoiceService({ env = process.env, fetchImpl = fetch, extractSample = extractVoiceSample,
  now = Date.now, dataDirectory = env.VOICE_DATA_DIR || resolve('server/.voice-data') } = {}) {
  const configured = !!env.ELEVENLABS_API_KEY && (env.NODE_ENV !== 'production' || !!env.VOICE_SERVICE_TOKEN);
  const unavailable = !env.ELEVENLABS_API_KEY
    ? 'AI voices need an ElevenLabs API key on the voice service. Device speech is available without it.'
    : 'Set a voice service access key on the server before using AI voices in production.';
  const rates = new Map(); const busyOwners = new Set();
  let active = 0; let defaults = null; let defaultsAt = 0; let defaultsLoading = null;
  const profilePath = (owner) => join(dataDirectory, `${digest(owner)}.json`);
  async function profileFor(owner) {
    try { return JSON.parse(await readFile(profilePath(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function saveProfile(owner, profile) {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const target = profilePath(owner); const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  async function provider(path, options = {}) {
    let result;
    try {
      result = await fetchImpl(`${API}${path}`, { ...options,
        headers: { ...options.headers, 'xi-api-key': env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(90000) });
    } catch { fail(502, 'The voice provider could not be reached. Check the connection and try again.'); }
    if (!result.ok) {
      await result.body?.cancel();
      // Deletion is idempotent if a voice was already removed in the provider dashboard.
      if (result.status === 404 && options.method === 'DELETE') return result;
      if (result.status === 401 || result.status === 403) fail(502, 'The voice provider refused access. Check the server API key, voice permissions, and cloning plan.');
      if (result.status === 429) fail(429, 'The voice provider is busy or out of credits. Try again later.');
      if (result.status === 404) fail(502, 'This voice is no longer available from the provider. Refresh your voices or create it again.');
      fail(502, 'The voice provider could not complete this request. Check the recording, account plan, and voice verification status.');
    }
    return result;
  }
  async function defaultVoices() {
    if (defaults && now() - defaultsAt < 10 * 60000) return defaults;
    if (defaultsLoading) return defaultsLoading;
    defaultsLoading = (async () => {
      // Resolve current available defaults; retired hard-coded voice IDs are unreliable.
      const result = await provider('/v2/voices?voice_type=default&page_size=100');
      const { voices } = await result.json();
      const chosen = {};
      for (const gender of ['male', 'female']) {
        const override = env[`ELEVENLABS_${gender.toUpperCase()}_VOICE_ID`];
        const voice = voices?.find((item) => item.labels?.gender === gender && item.voice_id);
        if (override) chosen[gender] = { id: override, name: `${gender === 'male' ? 'Male' : 'Female'} AI voice` };
        else if (voice) chosen[gender] = { id: voice.voice_id, name: voice.name };
        else fail(503, `No default ${gender} voice is available. Set ELEVENLABS_${gender.toUpperCase()}_VOICE_ID on the server to an available voice.`);
      }
      defaults = chosen; defaultsAt = now(); return chosen;
    })();
    try { return await defaultsLoading; } finally { defaultsLoading = null; }
  }
  function rateLimit(request, owner, clone) {
    const time = now();
    for (const [key, entry] of rates) if (time - entry.at > 3600000) rates.delete(key);
    // Both address and capability limits apply; rotating a capability cannot bypass the address limit.
    for (const identity of [request.socket.remoteAddress || 'unknown', digest(owner)]) {
      const key = `${clone ? 'clone' : 'request'}:${identity}`;
      const period = clone ? 3600000 : 60000;
      let entry = rates.get(key);
      if (!entry || time - entry.at > period) { entry = { at: time, count: 0 }; rates.set(key, entry); }
      if (++entry.count > (clone ? 3 : 90)) fail(429, 'Too many voice requests. Wait a little before trying again.');
    }
  }
  return {
    async handle(request, response) {
      const path = request.url?.split('?')[0];
      if (!path?.startsWith('/voice/')) return false;
      let owner; let locked = false; let counted = false;
      try {
        if (path === '/voice/status' && request.method === 'GET') {
          json(response, 200, { configured, requiresAccessKey: !!env.VOICE_SERVICE_TOKEN, maxUploadBytes: MAX_VIDEO_BYTES,
            message: configured ? 'AI speech and personal voice creation are available online.' : unavailable }); return true;
        }
        if (!configured) fail(503, unavailable);
        if (env.VOICE_SERVICE_TOKEN && !equal(String(request.headers.authorization || ''), `Bearer ${env.VOICE_SERVICE_TOKEN}`)) {
          fail(401, 'Enter your voice service access key in Voice settings.');
        }
        owner = request.headers['x-voice-owner'];
        if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner)) fail(401, 'A valid device voice credential is required.');
        const clone = path === '/voice/profile' && request.method === 'POST';
        rateLimit(request, owner, clone);
        if (active >= 8) fail(503, 'The voice service is busy. Try again shortly.');
        active++; counted = true;
        if (path === '/voice/voices' && request.method === 'GET') {
          const voices = await defaultVoices();
          json(response, 200, { male: voices.male.name, female: voices.female.name });
        } else if (path === '/voice/profile' && request.method === 'GET') {
          if (busyOwners.has(owner)) fail(409, 'Another voice change is still running. Wait for it to finish.');
          busyOwners.add(owner); locked = true;
          const profile = await profileFor(owner);
          // Recheck verification with the provider instead of treating a clone response as ready.
          if (profile?.status === 'verification_required') {
            const result = await provider(`/v1/voices/${encodeURIComponent(profile.voiceId)}`);
            const voice = await result.json();
            if (voice.is_owner === true && voice.voice_verification?.is_verified === true) {
              profile.status = 'ready'; await saveProfile(owner, profile);
            }
          }
          json(response, 200, { profile: publicProfile(profile) });
        } else if (path === '/voice/profile' && ['POST', 'DELETE'].includes(request.method)) {
          if (busyOwners.has(owner)) fail(409, 'Another voice change is still running. Wait for it to finish.');
          busyOwners.add(owner); locked = true;
          const existing = await profileFor(owner);
          if (request.method === 'DELETE') {
            if (existing) {
              await provider(`/v1/voices/${encodeURIComponent(existing.voiceId)}`, { method: 'DELETE' });
              await rm(profilePath(owner), { force: true });
            }
            json(response, 200, { profile: null });
          } else {
            if (existing) fail(409, 'Delete your current personal voice before creating a new one.');
            if (request.headers['x-voice-consent'] !== CONSENT) fail(400, 'Confirm that this is your own voice, or that the speaker authorized its use.');
            const mime = String(request.headers['content-type'] || '').split(';')[0];
            if (!/^video\/(mp4|quicktime|webm|x-matroska|3gpp|x-msvideo|mpeg|x-m4v)$/.test(mime)) fail(415, 'Choose an MP4, MOV, WebM, or other supported video file.');
            if (Number(request.headers['content-length']) > MAX_VIDEO_BYTES) fail(413, 'Choose a video smaller than 50 MB.');
            const name = new URL(request.url, 'http://localhost').searchParams.get('name')?.trim();
            if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Give your personal voice a name of up to 60 characters.');
            const directory = await mkdtemp(join(tmpdir(), 'talkbridge-voice-'));
            let created;
            try {
              let bytes = 0;
              const input = join(directory, 'recording'); const sample = join(directory, 'sample.wav');
              const limit = new Transform({ transform(chunk, _encoding, next) {
                bytes += chunk.length;
                next(bytes > MAX_VIDEO_BYTES ? new VoiceError(413, 'Choose a video smaller than 50 MB.') : null, chunk);
              } });
              await pipeline(request, limit, createWriteStream(input, { mode: 0o600 }));
              if (!bytes) fail(400, 'This video is empty. Choose a recording with clear speech.');
              await extractSample(input, sample, env.FFMPEG_PATH || 'ffmpeg');
              const body = new FormData();
              body.append('name', `TalkBridge — ${name}`);
              body.append('description', 'A personal communication voice created with the speaker’s authorization in TalkBridge.');
              body.append('files', new Blob([await readFile(sample)], { type: 'audio/wav' }), 'sample.wav');
              const result = await provider('/v1/voices/add', { method: 'POST', body });
              const voice = await result.json();
              if (typeof voice.voice_id !== 'string' || !voice.voice_id) fail(502, 'The voice provider returned no voice. Try again.');
              const profile = { voiceId: voice.voice_id, name, status: voice.requires_verification ? 'verification_required' : 'ready',
                createdAt: new Date(now()).toISOString(), consent: CONSENT };
              try { await saveProfile(owner, profile); }
              catch (error) {
                // Do not leave an unowned clone behind when persistence fails.
                await provider(`/v1/voices/${encodeURIComponent(voice.voice_id)}`, { method: 'DELETE' }); throw error;
              }
              created = publicProfile(profile);
            } finally { await rm(directory, { recursive: true, force: true }); }
            json(response, 201, { profile: created });
          }
        } else if (path === '/voice/speech' && request.method === 'POST') {
          const body = await readJson(request);
          const text = typeof body?.text === 'string' ? body.text.trim() : '';
          if (!text || text.length > 1200) fail(400, 'Enter between 1 and 1,200 characters to speak.');
          if (!['male', 'female', 'personal'].includes(body.voice)) fail(400, 'Choose a male, female, or personal voice.');
          if (typeof body.rate !== 'number' || body.rate < 0.7 || body.rate > 1.2) fail(400, 'Choose a speech speed between 0.7 and 1.2.');
          let voiceId;
          if (body.voice === 'personal') {
            const profile = await profileFor(owner);
            if (!profile) fail(404, 'Create your personal voice from a video first.');
            if (profile.status !== 'ready') fail(409, 'Your personal voice needs verification with the voice provider before it can speak.');
            voiceId = profile.voiceId;
          } else voiceId = (await defaultVoices())[body.voice].id;
          const result = await provider(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
              voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: body.rate } }),
          });
          // A short utterance is bounded to 1,200 characters. Never store synthesized speech on the server.
          const audio = Buffer.from(await result.arrayBuffer());
          if (!audio.length || audio.length > 12 * 1024 * 1024) fail(502, 'The voice provider returned invalid speech audio.');
          response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
          response.end(audio);
        } else fail(404, 'This voice endpoint does not exist.');
      } catch (error) {
        if (!response.destroyed && !response.headersSent) json(response, error.status || 500,
          { error: error instanceof VoiceError ? error.message : 'The voice service could not save or process this request. Try again.' });
      } finally {
        if (locked) busyOwners.delete(owner);
        if (counted) active--;
      }
      return true;
    },
  };
}
