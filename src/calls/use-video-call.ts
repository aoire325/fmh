import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { CallSession, initialCallState } from './call-session';
import { getWebRTC } from './native-webrtc';
import { resolveCallTarget, type CaptionKind } from './protocol';
import type { MeetingAudio } from './meeting-speech';

const audioModule = () => requireOptionalNativeModule<{ startCallAudio?: () => void; stopCallAudio?: () => void }>('SignBridgeTracker');

export function useVideoCall() {
  const [state, setState] = useState(initialCallState);
  const session = useRef<CallSession | null>(null);
  const mounted = useRef(true);
  const speechListener = useRef<(audio: MeetingAudio | null) => void>(() => {});
  const speechEnabled = useRef(true);
  const isFocused = useIsFocused();
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (next) => {
      // Permission prompts may temporarily make iOS inactive. Only background
      // ends the foreground-only call and releases camera/microphone resources.
      if (next === 'background') session.current?.end('Call ended when TalkBridge went into the background.');
    });
    return () => { mounted.current = false; listener.remove(); session.current?.end(); session.current = null; audioModule()?.stopCallAudio?.(); };
  }, []);
  useEffect(() => { if (!isFocused) session.current?.end(); }, [isFocused]);
  const start = useCallback((options: Parameters<CallSession['start']>[1]) => {
    try {
      const target = resolveCallTarget(options.action === 'join' ? options.code ?? '' : undefined,
        process.env.EXPO_PUBLIC_CALL_SIGNAL_URL, __DEV__, Constants.expoConfig?.hostUri);
      const rtc = getWebRTC();
      audioModule()?.startCallAudio?.();
      session.current ??= new CallSession(rtc, (address) => new WebSocket(address), (next) => {
        if (next.phase === 'ended' || next.phase === 'error') audioModule()?.stopCallAudio?.();
        if (mounted.current) setState(next);
      }, (audio) => speechListener.current(audio));
      session.current.setSpeechEnabled(speechEnabled.current);
      void session.current.start(target.url, { ...options, code: target.code });
    } catch (error) { audioModule()?.stopCallAudio?.(); setState({ ...initialCallState(), phase: 'error', message: error instanceof Error ? error.message : 'Calling is unavailable.' }); }
  }, []);
  const sendCaption = useCallback((text: string, kind: CaptionKind) => session.current?.sendCaption(text, kind) ?? false, []);
  const sendSpeech = useCallback(async (bytes: Uint8Array, text: string, kind: CaptionKind, signal: AbortSignal) => {
    if (!session.current) throw new Error('Start a meeting before speaking.');
    await session.current.sendSpeech(bytes, text, kind, signal);
  }, []);
  const stopSpeech = useCallback(() => session.current?.stopSpeech(), []);
  const setSpeechEnabled = useCallback((enabled: boolean) => { speechEnabled.current = enabled; session.current?.setSpeechEnabled(enabled); }, []);
  const subscribeSpeech = useCallback((listener: (audio: MeetingAudio | null) => void) => {
    speechListener.current = listener;
    return () => { if (speechListener.current === listener) speechListener.current = () => {}; };
  }, []);
  return { ...state, start, sendCaption, sendSpeech, stopSpeech, setSpeechEnabled, subscribeSpeech, end: () => session.current?.end(), toggleCamera: () => session.current?.toggleCamera(),
    toggleMicrophone: () => void session.current?.toggleMicrophone(), switchCamera: () => void session.current?.switchCamera(),
    setCaptions: (enabled: boolean) => session.current?.setCaptions(enabled) };
}
