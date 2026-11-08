import { File, Paths } from 'expo-file-system';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { playSpeech } from '@/voice/play-speech';
import { SpeechQueue, type SpeechState } from '@/voice/speech-queue';
import { VoiceClient } from '@/voice/voice-client';
import { DEFAULT_VOICE_PREFERENCES, readVoicePreferences, type PersonalVoice, type VoiceChoice, type VoicePreferences, type VoiceServiceStatus } from '@/voice/types';

type VoiceSettings = {
  preferences: VoicePreferences;
  setPreferences: (change: Partial<VoicePreferences>) => void;
  profile: PersonalVoice | null;
  service: VoiceServiceStatus | null;
  defaults: { male: string; female: string } | null;
  connectionError: string;
  refreshing: boolean;
  refresh: () => Promise<void>;
  setProfile: (profile: PersonalVoice | null) => void;
  speech: SpeechState;
  speak: (text: string, options?: { voice?: VoiceChoice; enqueue?: boolean }) => boolean;
  speakAccepted: (text: string) => void;
  stop: () => void;
};
const VoiceContext = createContext<VoiceSettings | null>(null);
const preferencesFile = () => new File(Paths.document, 'talkbridge-voice-settings-v1.json');
function loadPreferences() {
  try { const file = preferencesFile(); return file.exists ? readVoicePreferences(JSON.parse(file.textSync())) : DEFAULT_VOICE_PREFERENCES; }
  catch { return DEFAULT_VOICE_PREFERENCES; }
}

export function VoiceSettingsProvider({ children }: { children: ReactNode }) {
  const [preferences, updatePreferences] = useState(loadPreferences);
  const latest = useRef(preferences);
  const [profile, updateProfile] = useState<PersonalVoice | null>(null);
  const [service, setService] = useState<VoiceServiceStatus | null>(null);
  const [defaults, setDefaults] = useState<{ male: string; female: string } | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [speech, setSpeech] = useState<SpeechState>({ phase: 'idle', message: '', queued: 0 });
  const [queue] = useState(() => new SpeechQueue<VoicePreferences>(playSpeech, setSpeech));
  const mounted = useRef(true);
  const refreshGeneration = useRef(0);
  const invalidateRefresh = useCallback(() => { refreshGeneration.current++; }, []);
  const stop = useCallback(() => queue.stop(), [queue]);
  const setPreferences = useCallback((change: Partial<VoicePreferences>) => {
    if (change.voice !== undefined || change.rate !== undefined || change.autoSpeak === false) queue.stop();
    const next = readVoicePreferences({ ...latest.current, ...change });
    latest.current = next; updatePreferences(next);
    try {
      const file = preferencesFile();
      file.writeSync(JSON.stringify(next));
    } catch { setConnectionError('Voice settings could not be saved on this phone. They still apply for this session.'); }
  }, [queue]);
  const setProfile = useCallback((next: PersonalVoice | null) => {
    invalidateRefresh(); setRefreshing(false);
    updateProfile(next);
    if (!next && latest.current.voice === 'personal') setPreferences({ voice: 'device' });
  }, [setPreferences, invalidateRefresh]);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const current = () => mounted.current && generation === refreshGeneration.current;
    setRefreshing(true); setConnectionError('');
    try {
      const status = await VoiceClient.status();
      if (!current()) return;
      setService(status);
      if (status.configured) {
        const results = await Promise.allSettled([VoiceClient.voices(), VoiceClient.profile()]);
        if (!current()) return;
        if (results[0].status === 'fulfilled') setDefaults(results[0].value);
        else setDefaults(null);
        if (results[1].status === 'fulfilled') updateProfile(results[1].value);
        const error = results.find((result) => result.status === 'rejected');
        if (error?.status === 'rejected') throw error.reason;
      } else setDefaults(null);
    } catch (error) {
      if (current()) setConnectionError(error instanceof Error ? error.message : 'AI voices could not connect. Device speech remains available.');
    } finally { if (current()) setRefreshing(false); }
  }, []);
  const speak = useCallback((text: string, options?: { voice?: VoiceChoice; enqueue?: boolean }) =>
    queue.speak(text, { ...latest.current, ...(options?.voice ? { voice: options.voice } : {}) }, options?.enqueue), [queue]);
  const speakAccepted = useCallback((text: string) => {
    if (latest.current.autoSpeak) speak(text, { enqueue: true });
  }, [speak]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (state) => { if (state === 'background') queue.stop(); });
    return () => { mounted.current = false; invalidateRefresh(); listener.remove(); queue.stop(); };
  }, [queue, invalidateRefresh]);
  const value = useMemo(() => ({ preferences, setPreferences, profile, service, defaults, connectionError, refreshing,
    refresh, setProfile, speech, speak, speakAccepted, stop }),
  [preferences, setPreferences, profile, service, defaults, connectionError, refreshing, refresh, setProfile, speech, speak, speakAccepted, stop]);
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoiceSettings() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('Voice settings must be used inside their provider.');
  return value;
}
