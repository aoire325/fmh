export type VoiceChoice = 'male' | 'female' | 'personal' | 'device';
export type VoicePreferences = { voice: VoiceChoice; autoSpeak: boolean; rate: number };
export type PersonalVoice = { name: string; status: 'ready' | 'verification_required'; createdAt: string };
export type VoiceServiceStatus = { configured: boolean; requiresAccessKey: boolean; message: string; maxUploadBytes: number };
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = { voice: 'device', autoSpeak: true, rate: 1 };
export const VOICE_LABELS: Record<VoiceChoice, string> = {
  male: 'Male AI voice', female: 'Female AI voice', personal: 'My personal voice', device: 'Device voice',
};
export function readVoicePreferences(value: unknown): VoicePreferences {
  const saved = value as Partial<VoicePreferences> | null;
  return {
    voice: saved && ['male', 'female', 'personal', 'device'].includes(saved.voice ?? '') ? saved.voice! : 'device',
    autoSpeak: typeof saved?.autoSpeak === 'boolean' ? saved.autoSpeak : DEFAULT_VOICE_PREFERENCES.autoSpeak,
    rate: typeof saved?.rate === 'number' && Number.isFinite(saved.rate) && saved.rate >= 0.7 && saved.rate <= 1.2 ? saved.rate : 1,
  };
}

export function voiceServiceUrl(explicit: string | undefined, callUrl: string | undefined, development: boolean, host?: string | null) {
  let address = explicit?.trim();
  if (!address && callUrl?.trim()) {
    const call = new URL(callUrl.trim());
    if (!['ws:', 'wss:'].includes(call.protocol) || call.username || call.password || call.search || call.hash) {
      throw new Error('The configured voice service address is invalid.');
    }
    call.protocol = call.protocol === 'wss:' ? 'https:' : 'http:';
    address = call.origin;
  }
  if (!address && development && host) {
    const metro = new URL(`http://${host}`);
    const hostname = metro.hostname;
    if (hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      address = `http://${hostname === 'localhost' || hostname === '[::1]' ? '127.0.0.1' : hostname}:8787`;
    }
  }
  if (!address) throw new Error('AI voices are not connected in this build. Use Device voice, or configure the voice service.');
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(development && url.protocol === 'http:'))
    || url.pathname !== '/') throw new Error('The voice service must be an HTTPS origin without a path. HTTP is allowed only during development.');
  return url.origin;
}

export function videoMimeType(name: string, mime?: string) {
  if (mime?.startsWith('video/')) return mime;
  const extension = name.toLowerCase().split('.').pop();
  return ({ mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
    mkv: 'video/x-matroska', '3gp': 'video/3gpp', avi: 'video/x-msvideo', mpeg: 'video/mpeg' } as Record<string, string>)[extension ?? ''];
}
