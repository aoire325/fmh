import { VoiceClient } from './voice-client';
import { requireVoiceNativeSupport } from './native-support';
import type { SpeechJob } from './speech-queue';
import type { VoicePreferences } from './types';

let stoppingDeviceSpeech: Promise<unknown> = Promise.resolve();
function stopDeviceSpeech(Speech: typeof import('expo-speech')) {
  stoppingDeviceSpeech = Speech.stop().catch(() => {});
}

export async function playSpeech(job: SpeechJob<VoicePreferences>, signal: AbortSignal, speaking: () => void) {
  if (signal.aborted) return;
  await stoppingDeviceSpeech;
  if (signal.aborted) return;
  requireVoiceNativeSupport('ExpoAudio', ...(job.options.voice === 'device' ? ['ExpoSpeech'] : []));
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Check native availability before evaluating this library in older builds.
  const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
  if (signal.aborted) return;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
  if (signal.aborted) return;
  if (job.options.voice === 'device') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- An older development build may not contain the speech module.
    const Speech = require('expo-speech') as typeof import('expo-speech');
    if (signal.aborted) return;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const done = (error?: Error) => {
        if (finished) return; finished = true;
        clearTimeout(timeout); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { stopDeviceSpeech(Speech); done(); };
      const timeout = setTimeout(() => { stopDeviceSpeech(Speech); done(new Error('Device speech took too long. Check your phone’s text-to-speech settings.')); }, 180000);
      signal.addEventListener('abort', abort, { once: true });
      try {
        Speech.speak(job.text, { language: 'en-US', rate: job.options.rate, useApplicationAudioSession: true,
          onStart: speaking, onDone: () => done(), onStopped: () => done(), onError: (error) => done(error) });
      } catch (error) { done(error instanceof Error ? error : new Error('Device speech is unavailable.')); }
    });
    return;
  }
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 100000);
  const abortRequest = () => timeoutController.abort();
  signal.addEventListener('abort', abortRequest, { once: true });
  let file: Awaited<ReturnType<typeof VoiceClient.speech>> | null = null;
  try {
    file = await VoiceClient.speech(job.text, job.options.voice, job.options.rate, timeoutController.signal);
    clearTimeout(timer);
    if (signal.aborted) return;
    const player = createAudioPlayer(file.uri, { updateInterval: 100 });
    try {
      await new Promise<void>((resolve, reject) => {
        let started = false; let finished = false;
        const done = (error?: Error) => {
          if (finished) return; finished = true;
          clearTimeout(watchdog); subscription.remove(); signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve();
        };
        const abort = () => { player.pause(); done(); };
        const watchdog = setTimeout(() => done(new Error('Speech playback took too long. Check the audio output and try again.')), 180000);
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.error) done(new Error('Speech audio could not play. Try again.'));
          else if (status.didJustFinish) done();
          else if (status.playing && !started) { started = true; speaking(); }
        });
        signal.addEventListener('abort', abort, { once: true });
        try { player.play(); } catch (error) { done(error instanceof Error ? error : new Error('Audio playback is unavailable.')); }
      });
    } finally { player.remove(); }
  } catch (error) {
    if (timeoutController.signal.aborted && !signal.aborted) throw new Error('The online voice took too long. Try again or choose Device voice.');
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abortRequest);
    if (file?.exists) file.delete();
  }
}
