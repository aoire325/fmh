import { fromByteArray, toByteArray } from 'base64-js';
import { CAPTION_LIMIT, type CaptionKind } from './protocol';

export const MAX_MEETING_AUDIO = 512 * 1024;
export const AUDIO_CHUNK_BYTES = 3072;
export type MeetingAudio = { id: number; text: string; kind: CaptionKind; bytes: Uint8Array };
export type SpeechPeer = 'unknown' | 'ready' | 'muted';
type Wire = { readyState: string; bufferedAmount: number; send: (data: string) => void };
type Incoming = { id: number; text: string; kind: CaptionKind; size: number; chunks: Uint8Array[]; received: number; at: number };

/** Bounded audio transfer over the encrypted call data channel. Provider keys,
 * personal voice IDs, and audio URLs never cross between callers. */
export class MeetingSpeechTransport {
  private incoming: Incoming | null = null;
  private sequence = 0;
  private lastReceived = 0;
  private generation = 0;
  private sending = false;
  private enabled = true;
  peer: SpeechPeer = 'unknown';
  constructor(private channel: Wire, private onPeer: (peer: SpeechPeer) => void,
    private onAudio: (audio: MeetingAudio | null) => void, private now = Date.now) {}
  advertise() {
    if (this.channel.readyState !== 'open') return;
    try { this.send({ type: 'speech-support', version: 1, enabled: this.enabled }); }
    catch { /* A simultaneous hang-up can close the channel before send. */ }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) { this.incoming = null; this.onAudio(null); }
    if (this.channel.readyState === 'open') this.advertise();
  }
  stopSending() {
    this.generation++;
    if (this.channel.readyState === 'open') {
      try { this.send({ type: 'speech-stop' }); } catch { /* Already disconnected. */ }
    }
  }
  dispose() { this.generation++; this.incoming = null; this.peer = 'unknown'; }
  private send(value: object) { this.channel.send(JSON.stringify(value)); }
  receive(raw: unknown): boolean {
    if (typeof raw !== 'string' || raw.length > 8192) return false;
    let value;
    try { value = JSON.parse(raw); } catch { return false; }
    if (!value || typeof value !== 'object' || typeof value.type !== 'string' || !value.type.startsWith('speech-')) return false;
    if (this.incoming && this.now() - this.incoming.at > 15000) this.incoming = null;
    if (value.type === 'speech-support' && value.version === 1 && typeof value.enabled === 'boolean') {
      const firstContact = this.peer === 'unknown';
      this.peer = value.enabled ? 'ready' : 'muted'; this.onPeer(this.peer);
      if (firstContact && this.channel.readyState === 'open') this.advertise();
    } else if (value.type === 'speech-stop') { this.incoming = null; this.onAudio(null); }
    else if (value.type === 'speech-start' && this.enabled) {
      if (Number.isSafeInteger(value.id) && value.id > this.lastReceived && Number.isSafeInteger(value.size)
        && value.size > 0 && value.size <= MAX_MEETING_AUDIO && typeof value.text === 'string'
        && value.text.trim() && value.text.length <= CAPTION_LIMIT && ['typed', 'reviewed'].includes(value.kind)) {
        this.lastReceived = value.id;
        this.incoming = { id: value.id, size: value.size, text: value.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim(),
          kind: value.kind, chunks: [], received: 0, at: this.now() };
      }
    } else if (value.type === 'speech-chunk' && this.incoming && this.incoming.id === value.id) {
      const item = this.incoming;
      if (value.index !== item.chunks.length || typeof value.data !== 'string' || value.data.length > 4096
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) {
        this.incoming = null; return true;
      }
      const chunk = toByteArray(value.data);
      if (chunk.length !== Math.min(AUDIO_CHUNK_BYTES, item.size - item.received)) { this.incoming = null; return true; }
      item.chunks.push(chunk); item.received += chunk.length;
    } else if (value.type === 'speech-end' && this.incoming && this.incoming.id === value.id) {
      const item = this.incoming; this.incoming = null;
      if (item.received !== item.size || !this.enabled) return true;
      const bytes = new Uint8Array(item.size); let offset = 0;
      for (const chunk of item.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      this.onAudio({ id: item.id, text: item.text, kind: item.kind, bytes });
    }
    return true;
  }
  async sendAudio(bytes: Uint8Array, text: string, kind: CaptionKind, signal: AbortSignal) {
    if (this.sending) throw new Error('Another meeting message is still being sent.');
    if (this.peer !== 'ready') throw new Error(this.peer === 'muted' ? 'Your guest has turned off meeting voice playback.' : 'Your guest needs the updated TalkBridge app for meeting voices.');
    if (!bytes.length || bytes.length > MAX_MEETING_AUDIO || !text.trim() || text.length > CAPTION_LIMIT || kind === 'ai') {
      throw new Error('Use a short typed message or reviewed sign caption for meeting speech.');
    }
    const id = ++this.sequence; const generation = this.generation; this.sending = true;
    const current = () => !signal.aborted && generation === this.generation && this.channel.readyState === 'open' && this.peer === 'ready';
    try {
      if (!current()) throw new Error('Meeting speech stopped.');
      this.send({ type: 'speech-start', id, size: bytes.length, text: text.trim(), kind });
      const started = this.now();
      for (let offset = 0, index = 0; offset < bytes.length; offset += AUDIO_CHUNK_BYTES, index++) {
        while (this.channel.bufferedAmount > 32768) {
          if (!current()) throw new Error('Meeting speech stopped.');
          if (this.now() - started > 12000) throw new Error('Meeting speech could not be sent. Check the call connection.');
          await new Promise((done) => setTimeout(done, 20));
        }
        if (!current()) throw new Error('Meeting speech stopped.');
        this.send({ type: 'speech-chunk', id, index, data: fromByteArray(bytes.subarray(offset, offset + AUDIO_CHUNK_BYTES)) });
        await new Promise((done) => setTimeout(done, 0));
      }
      if (!current()) throw new Error('Meeting speech stopped.');
      this.send({ type: 'speech-end', id });
    } catch (error) {
      if (this.channel.readyState === 'open' && generation === this.generation) {
        try { this.send({ type: 'speech-stop' }); } catch { /* Disconnected. */ }
      }
      throw error;
    } finally { this.sending = false; }
  }
}
