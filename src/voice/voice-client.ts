import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { requireVoiceNativeSupport } from './native-support';
import { voiceServiceUrl, videoMimeType, type PersonalVoice, type VoiceServiceStatus, type VoiceChoice } from './types';

const OWNER_KEY = 'talkbridge.voice-owner.v1';
const ACCESS_KEY = 'talkbridge.voice-access.v1';
let ownerLoading: Promise<string> | null = null;
function secureStore() {
  requireVoiceNativeSupport('ExpoSecureStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load only after confirming that the native module exists.
  return require('expo-secure-store') as typeof import('expo-secure-store');
}
function serviceUrl() {
  return voiceServiceUrl(process.env.EXPO_PUBLIC_VOICE_SERVICE_URL, process.env.EXPO_PUBLIC_CALL_SIGNAL_URL,
    __DEV__, Constants.expoConfig?.hostUri);
}
async function ownerCredential() {
  if (!ownerLoading) ownerLoading = (async () => {
    requireVoiceNativeSupport('ExpoSecureStore', 'ExpoCrypto');
    const SecureStore = secureStore();
    const saved = await SecureStore.getItemAsync(OWNER_KEY);
    if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Crypto was checked above; do not crash old builds at module evaluation.
    const { getRandomBytesAsync } = require('expo-crypto') as typeof import('expo-crypto');
    const value = [...await getRandomBytesAsync(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(OWNER_KEY, value);
    return value;
  })();
  try { return await ownerLoading; }
  catch (error) { ownerLoading = null; throw error; }
}
async function headers() {
  const SecureStore = secureStore();
  const [owner, key] = await Promise.all([ownerCredential(), SecureStore.getItemAsync(ACCESS_KEY)]);
  return { 'X-Voice-Owner': owner, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
async function request(path: string, options: RequestInit = {}, authenticated = true) {
  const url = `${serviceUrl()}/voice/${path}`;
  const requestHeaders = { ...(authenticated ? await headers() : {}), ...options.headers };
  let response;
  try {
    response = await fetch(url, { ...options, headers: requestHeaders, signal: options.signal ?? AbortSignal.timeout(20000) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('The voice service could not be reached. Check your connection, or choose Device voice.');
  }
  if (!response.ok) {
    if (response.status === 404 && path === 'status') throw new Error('This service needs the voice update. Restart the TalkBridge service, then refresh voices.');
    let message = `Voice request failed (${response.status}). Try again.`;
    try { const body = await response.json(); if (typeof body?.error === 'string') message = body.error; } catch { /* Keep readable fallback. */ }
    throw new Error(message);
  }
  return response;
}
function personalVoice(value: unknown): PersonalVoice | null {
  if (value == null) return null;
  const profile = value as PersonalVoice;
  if (typeof profile.name !== 'string' || !['ready', 'verification_required'].includes(profile.status)
    || typeof profile.createdAt !== 'string') throw new Error('The voice service returned an invalid personal voice.');
  return { name: profile.name, status: profile.status, createdAt: profile.createdAt };
}

export const VoiceClient = {
  origin: serviceUrl,
  async status(): Promise<VoiceServiceStatus> {
    const value = await (await request('status', {}, false)).json();
    if (typeof value?.configured !== 'boolean' || typeof value?.message !== 'string') throw new Error('This service does not support AI voices. Update and restart the TalkBridge service.');
    return value;
  },
  async voices(): Promise<{ male: string; female: string }> { return (await request('voices')).json(); },
  async profile(): Promise<PersonalVoice | null> { return personalVoice((await (await request('profile')).json()).profile); },
  async setAccessKey(value: string) {
    const SecureStore = secureStore();
    if (value.trim()) await SecureStore.setItemAsync(ACCESS_KEY, value.trim());
    else await SecureStore.deleteItemAsync(ACCESS_KEY);
  },
  async createVoice(video: { uri: string; name: string; mimeType?: string }, name: string, signal: AbortSignal): Promise<PersonalVoice> {
    const mime = videoMimeType(video.name, video.mimeType);
    if (!mime) throw new Error('Choose a video of the person speaking.');
    const file = new File(video.uri);
    if (!file.exists || file.size <= 0) throw new Error('This video cannot be read. Choose it again.');
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a video smaller than 50 MB.');
    const response = await request(`profile?name=${encodeURIComponent(name.trim())}`, { method: 'POST', signal,
      headers: { 'Content-Type': mime, 'X-Voice-Consent': 'own-voice-v1' }, body: file });
    const profile = personalVoice((await response.json()).profile);
    if (!profile) throw new Error('The voice service did not return a personal voice. Refresh and try again.');
    return profile;
  },
  async deleteVoice() { await request('profile', { method: 'DELETE', signal: AbortSignal.timeout(100000) }); },
  async speech(text: string, voice: Exclude<VoiceChoice, 'device'>, rate: number, signal: AbortSignal) {
    const response = await request('speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate }), signal });
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('The voice service returned no speech audio.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal.aborted) throw new Error('Speech stopped.');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('The voice service returned invalid audio.');
    const file = new File(Paths.cache, `talkbridge-speech-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    try { file.writeSync(bytes); return file; }
    catch (error) { if (file.exists) file.delete(); throw error; }
  },
};
