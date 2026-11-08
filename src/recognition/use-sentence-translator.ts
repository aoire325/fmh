import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadBundledModel } from './local-model';
import encoderAsset from '../../assets/models/asl_sentence_encoder.tflite';
import decoderAsset from '../../assets/models/asl_sentence_decoder.tflite';
import { SentenceCapture, SENTENCE_MAX_MS } from './sentence-input';
import { translateSentence, type SentenceModels } from './sentence-decoder';
import type { TrackingFrame } from './landmarks';

export type SentenceResult = 'processing' | 'translated' | 'unverified' | 'unrecognized';

export function useSentenceTranslator(enabled: boolean, active: boolean, sessionToken: number) {
  const models = useRef<SentenceModels | null>(null);
  const capture = useRef(new SentenceCapture());
  const life = useRef({ active: false, generation: 0 });
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const recordingRef = useRef(false);
  const lastDisplayTimestamp = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activation = useMemo(() => ({ enabled, active, sessionToken }), [enabled, active, sessionToken]);
  const [recordingActivation, setRecordingActivation] = useState<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Record a complete short sentence, then tap Stop & translate. No pauses between words are needed.');
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<{ kind: SentenceResult; activation: object } | null>(null);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [frameSession, setFrameSession] = useState(-1);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; models.current = null; }; }, []);
  useEffect(() => () => { models.current = null; }, [enabled]);
  useLayoutEffect(() => {
    life.current = { active: enabled && active, generation: life.current.generation + 1 };
    lastDisplayTimestamp.current = -Infinity;
    const currentCapture = capture.current;
    currentCapture.reset();
    recordingRef.current = false;
    return () => {
      life.current.active = false; life.current.generation++;
      recordingRef.current = false; currentCapture.reset();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, active, sessionToken]);

  const finish = useCallback(async () => {
    if (!life.current.active || !recordingRef.current || !models.current || inFlight.current) return;
    recordingRef.current = false; setRecordingActivation(null);
    if (timer.current) clearTimeout(timer.current);
    const generation = life.current.generation;
    const current = () => life.current.active && life.current.generation === generation;
    let recovered = '';
    inFlight.current = true; setBusy(true); setDraft('');
    setResult({ kind: 'processing', activation });
    setMessage('Translating your sentence on this phone. Please wait.');
    try {
      const input = capture.current.finish();
      const text = await translateSentence(models.current, input, current,
        (tokens, partial) => {
          if (!current()) return;
          recovered = partial; setDraft(partial);
          setMessage(`Writing your draft · ${tokens} text tokens decoded…`);
        });
      if (!text.trim()) throw new Error('No clear sentence detected. Keep your face, shoulders and hands visible, then record again.');
      if (current()) {
        setDraft(text); setResult({ kind: 'translated', activation });
        setMessage('Translation draft ready. Review or edit it before using it.');
      }
    } catch (error) {
      if (current()) {
        setDraft(recovered);
        setResult({ kind: recovered ? 'unverified' : 'unrecognized', activation });
        setMessage(error instanceof Error ? error.message : 'The app could not recover text from this recording.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        if (life.current.active && life.current.generation !== generation) setMessage('Sentence processing cancelled. You can record again.');
      }
    }
  }, [activation]);

  const start = useCallback(async () => {
    if (!life.current.active || inFlight.current || recordingRef.current) return;
    const generation = life.current.generation;
    const current = () => life.current.active && life.current.generation === generation;
    inFlight.current = true; setBusy(true); setDraft(''); setResult(null);
    try {
      if (!models.current) {
        setMessage('Loading the bundled sentence encoder. Camera preview stays available.');
        const encoder = await loadBundledModel(encoderAsset);
        if (!current()) return;
        setMessage('Loading the bundled English decoder…');
        const decoder = await loadBundledModel(decoderAsset);
        if (!current()) return;
        models.current = { encoder, decoder };
      }
      if (!current()) return;
      capture.current.reset(); recordingRef.current = true;
      setRecordingActivation(activation);
      setMessage('Recording your sentence. Keep your face, shoulders and hands visible. Tap Stop & translate when finished (12 seconds maximum).');
      timer.current = setTimeout(() => { if (current()) void finish(); }, SENTENCE_MAX_MS);
    } catch (error) {
      if (current()) {
        setResult({ kind: 'unrecognized', activation });
        setMessage(error instanceof Error ? error.message : 'Could not load the offline sentence model.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        if (life.current.active && life.current.generation !== generation) setMessage('Sentence processing cancelled. You can record again.');
      }
    }
  }, [finish, activation]);

  const cancel = useCallback(() => {
    life.current.generation++;
    recordingRef.current = false; capture.current.reset(); setRecordingActivation(null);
    setDraft(''); setResult(null);
    if (timer.current) clearTimeout(timer.current);
    setMessage(inFlight.current
      ? 'Cancelling sentence processing. Waiting for the current offline model step to finish…'
      : 'Sentence capture cancelled. You can record again.');
  }, []);

  const onFrame = useCallback((next: TrackingFrame) => {
    if (!life.current.active) return;
    if (next.timestampMs - lastDisplayTimestamp.current >= 100 || next.timestampMs < lastDisplayTimestamp.current) {
      lastDisplayTimestamp.current = next.timestampMs;
      setFrame(next); setFrameSession(sessionToken);
    }
    if (!recordingRef.current) return;
    const result = capture.current.accept(next);
    if (result === 'limit') void finish();
    else if (result === 'context-missing') setMessage('Recording · move back until your face, shoulders and hands are visible. Tap Stop & translate when finished.');
    else if (result === 'capturing') setMessage('Recording your sentence · tap Stop & translate when finished (12 seconds maximum).');
    else if (result === 'interrupted') {
      cancel(); setResult({ kind: 'unrecognized', activation });
      setMessage('Camera tracking was interrupted. Please record the full sentence again.');
    }
  }, [cancel, finish, sessionToken, activation]);

  // A finished attempt remains reviewable when the camera stops. Only pending
  // processing is tied to the capture activation and hidden after interruption.
  const visibleResult = enabled && result && (result.kind !== 'processing' || result.activation === activation)
    ? result.kind : null;
  return { frame: active && frameSession === sessionToken ? frame : null,
    recording: active && recordingActivation === activation,
    result: visibleResult,
    busy, message, draft: visibleResult ? draft : '', editDraft: setDraft,
    clearDraft: () => { setDraft(''); setResult(null); }, start, finish, cancel, onFrame };
} 

