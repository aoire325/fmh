export const CAPTION_LIMIT = 280;
export type CaptionKind = 'typed' | 'reviewed' | 'ai';
export type Caption = { type: 'caption'; sequence: number; text: string; kind: CaptionKind };
export type MediaState = { type: 'media'; camera: boolean; microphone: boolean; captions: boolean };
export type CallMessage = Caption | MediaState;
export const normalizeInvite = (value: string) => value.toUpperCase().replace(/[\s\-\u2010-\u2015]/g, '');
const validCode = (value: string) => /^[A-HJ-NP-Z2-9]{12}$/.test(value);
export const validInvite = (value: string) => validCode(normalizeInvite(value));
export const displayInvite = (value: string) => normalizeInvite(value).match(/.{1,4}/g)?.join(' - ') ?? '';

export type CallInvite = { code: string; serviceUrl?: string };
export function parseInvite(value: string): CallInvite | null {
  if (value.length > 2048) return null;
  const code = normalizeInvite(value.trim());
  if (validCode(code)) return { code };
  try {
    const link = new URL(value.trim());
    if (link.protocol !== 'signbridge:' || link.host || link.pathname !== '/call' || link.hash
      || link.searchParams.getAll('code').length !== 1 || link.searchParams.getAll('service').length !== 1) return null;
    const code = normalizeInvite(link.searchParams.get('code')!);
    const serviceUrl = link.searchParams.get('service')!;
    if (!validCode(code)) return null;
    // Parse WS here for development invites; release builds enforce WSS when
    // selecting the connection target, before requesting camera permission.
    signalingUrl(serviceUrl, true);
    return { code, serviceUrl };
  } catch { return null; }
}

export function createInvite(code: string, serviceUrl: string): string {
  const normalized = normalizeInvite(code);
  if (!validCode(normalized)) throw new Error('This call has no valid invitation yet.');
  const link = new URL('signbridge:///call');
  link.searchParams.set('code', normalized);
  link.searchParams.set('service', signalingUrl(serviceUrl, true));
  return link.toString();
}

export function resolveCallTarget(invite: string | undefined, configured: string | undefined, development: boolean, developmentHost?: string | null) {
  const parsed = invite === undefined ? null : parseInvite(invite);
  if (invite !== undefined && !parsed) throw new Error('Paste the complete invite or enter its 12-character code.');
  return { url: signalingUrl(parsed?.serviceUrl ?? configured, development, developmentHost), code: parsed?.code };
}

export function parseCallMessage(raw: unknown): CallMessage | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.type === 'caption' && Number.isSafeInteger(value.sequence) && value.sequence > 0
      && typeof value.text === 'string' && value.text.length <= CAPTION_LIMIT
      && ['typed', 'reviewed', 'ai'].includes(value.kind)) {
      return { type: 'caption', sequence: value.sequence, text: value.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim(), kind: value.kind };
    }
    if (value?.type === 'media' && ['camera', 'microphone', 'captions'].every((key) => typeof value[key] === 'boolean')) {
      return { type: 'media', camera: value.camera, microphone: value.microphone, captions: value.captions };
    }
  } catch { /* Ignore malformed peer data. */ }
  return null;
}

export function signalingUrl(value: string | undefined, development: boolean, developmentHost?: string | null): string {
  let url = value?.trim();
  // A dev client can load a bundle without the machine's ignored .env.local.
  // Use the same computer that served that client, never the phone's localhost
  // unless Metro itself was opened through localhost (e.g. adb reverse).
  if (!url && development && developmentHost) {
    try {
      const host = new URL(`http://${developmentHost}`);
      const hostname = host.hostname;
      const local = hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')
        || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
      if (local && !host.username && !host.password && !host.search && !host.hash && host.pathname === '/') {
        // The bundled development service listens on IPv4, including loopback.
        url = `ws://${hostname === '[::1]' || hostname === 'localhost' ? '127.0.0.1' : hostname}:8787/calls`;
      }
    } catch { /* Fall through to the actionable configuration error. */ }
  }
  if (!url) throw new Error(development
    ? 'Open the latest TalkBridge project from the same computer on both phones, then reload. The computer must also run the call service.'
    : 'This app build is missing its call service address. Install an updated build with calling configured.');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash || parsed.search
    || (parsed.protocol !== 'wss:' && !(development && parsed.protocol === 'ws:'))) {
    throw new Error('The call service must use a secure WebSocket address.');
  }
  return url;
}
