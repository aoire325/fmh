import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVoiceSettings } from '@/state/voice-settings';
import { VoiceClient } from '@/voice/voice-client';
import { SpeechQueue, type SpeechJob, type SpeechState } from '@/voice/speech-queue';
import type { VoiceChoice } from '@/voice/types';
import { MeetingAudioPlayer } from './meeting-audio-player';
import { MAX_MEETING_AUDIO, type MeetingAudio } from './meeting-speech';
import type { CaptionKind } from './protocol';
import type { useVideoCall } from './use-video-call';

type Request = { voice: Exclude<VoiceChoice, 'device'>; rate: number; kind: CaptionKind };
const idle: SpeechState = { phase: 'idle', message: '', queued: 0 };
export function useMeetingVoice(call: ReturnType<typeof useVideoCall>) {
  const settings = useVoiceSettings();
  const { refresh, stop: stopTranslator } = settings;
  const [voice, updateVoice] = useState<Exclude<VoiceChoice, 'device'>>(() => settings.preferences.voice === 'device' ? 'male' : settings.preferences.voice);
  const [automatic, updateAutomatic] = useState(false);
  const [listen, updateListen] = useState(true);
  const [outgoing, setOutgoing] = useState(idle);
  const [incoming, setIncoming] = useState(idle);
  const [notice, setNotice] = useState('');
  const connected = call.phase === 'connected' && call.channelReady;
  const ended = ['idle', 'ended', 'error'].includes(call.phase);
  const { subscribeSpeech, setSpeechEnabled } = call;
  const latest = useRef({ call, connected, voice, automatic, listen, settings });
  const [player] = useState(() => new MeetingAudioPlayer());
  const [inbox] = useState(() => new SpeechQueue<MeetingAudio>((job, signal, speaking) => player.play(job.options.bytes, signal, speaking), setIncoming));
  const prepareSpeech = useCallback(async (job: SpeechJob<Request>, signal: AbortSignal, sending: () => void) => {
    if (!latest.current.connected || latest.current.call.peerSpeech !== 'ready') throw new Error('Your guest is not ready to hear meeting speech.');
    let file: Awaited<ReturnType<typeof VoiceClient.speech>> | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100000);
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) return;
      file = await VoiceClient.speech(job.text, job.options.voice, job.options.rate, controller.signal);
      const bytes = await file.bytes();
      if (signal.aborted || !latest.current.connected) return;
      if (bytes.length > MAX_MEETING_AUDIO) throw new Error('This voice message is too long. Try a shorter sentence.');
      sending();
      await latest.current.call.sendSpeech(bytes, job.text, job.options.kind, signal);
      if (!signal.aborted) setNotice('Voice sent to your guest.');
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (file?.exists) file.delete();
    }
  }, []);
  const outbox = useRef<SpeechQueue<Request> | null>(null);
  useLayoutEffect(() => { latest.current = { call, connected, voice, automatic, listen, settings }; });
  useEffect(() => {
    const queue = new SpeechQueue<Request>(prepareSpeech, setOutgoing);
    outbox.current = queue;
    return () => { queue.stop(); outbox.current = null; };
  }, [prepareSpeech]);
  useEffect(() => { stopTranslator(); void refresh(); }, [refresh, stopTranslator]);
  const stop = useCallback(() => {
    outbox.current?.stop(); inbox.stop();
    try { latest.current.call.stopSpeech(); } catch { /* Already disconnected. */ }
    setNotice('Meeting voice stopped.');
  }, [inbox]);
  useEffect(() => subscribeSpeech((audio) => {
    if (!audio) { inbox.stop(); return; }
    if (latest.current.connected && latest.current.listen) inbox.speak(audio.text, audio, true);
  }), [subscribeSpeech, inbox]);
  useEffect(() => { setSpeechEnabled(listen); }, [setSpeechEnabled, listen]);
  useEffect(() => {
    if (!connected) { outbox.current?.stop(); inbox.stop(); }
    if (ended) player.dispose();
  }, [connected, ended, inbox, player]);
  useEffect(() => () => { inbox.stop(); player.dispose(); }, [inbox, player]);
  const speak = useCallback((text: string, kind: CaptionKind = 'typed') => {
    const current = latest.current;
    if (!text.trim() || text.trim().length > 280 || kind === 'ai') return false;
    if (!current.connected || current.call.peerSpeech !== 'ready') { setNotice('Connect to a guest using the updated TalkBridge app before speaking.'); return false; }
    if (!current.settings.service?.configured) { setNotice('Connect your AI voices in Voice & speaking before using meeting speech.'); return false; }
    if (current.voice === 'personal' && current.settings.profile?.status !== 'ready') { setNotice('Your personal voice is not ready. Choose Male or Female AI voice.'); return false; }
    setNotice('');
    return outbox.current?.speak(text, { voice: current.voice, rate: current.settings.preferences.rate, kind }, true) ?? false;
  }, []);
  const speakReviewed = useCallback((text: string) => { if (latest.current.automatic) speak(text, 'reviewed'); }, [speak]);
  const chooseVoice = useCallback((next: Exclude<VoiceChoice, 'device'>) => { stop(); updateVoice(next); setNotice(''); }, [stop]);
  const setAutomatic = useCallback((enabled: boolean) => { updateAutomatic(enabled); if (!enabled) stop(); }, [stop]);
  const setListen = useCallback((enabled: boolean) => { updateListen(enabled); if (!enabled) inbox.stop(); }, [inbox]);
  const canSpeak = connected && call.peerSpeech === 'ready' && settings.service?.configured === true
    && (voice !== 'personal' || settings.profile?.status === 'ready');
  return { voice, chooseVoice, automatic, setAutomatic, listen, setListen, speak, speakReviewed, stop, canSpeak,
    outgoing, incoming, notice: connected ? notice : '', settings, connected, peerSpeech: call.peerSpeech };
}
export type MeetingVoice = ReturnType<typeof useMeetingVoice>;
