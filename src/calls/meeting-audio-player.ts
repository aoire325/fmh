import type { AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { requireVoiceNativeSupport } from '@/voice/native-support';

/** Keep one player for the meeting. Do not replace WebRTC's audio category or
 * deactivate its session between utterances, which can mute the call on iOS. */
export class MeetingAudioPlayer {
  private player: AudioPlayer | null = null;
  private cancel: (() => void) | null = null;
  async play(bytes: Uint8Array, signal: AbortSignal, speaking: () => void) {
    if (signal.aborted) return;
    requireVoiceNativeSupport('ExpoAudio');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep older development builds usable until voice is requested.
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
    this.player ??= createAudioPlayer(null, { updateInterval: 100, keepAudioSessionActive: true });
    const player = this.player;
    const file = new File(Paths.cache, `talkbridge-meeting-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    try {
      file.writeSync(bytes);
      await new Promise<void>((resolve, reject) => {
        let finished = false; let started = false;
        const done = (error?: Error) => {
          if (finished) return; finished = true;
          clearTimeout(timer); subscription.remove(); signal.removeEventListener('abort', abort); this.cancel = null;
          if (error) reject(error); else resolve();
        };
        const abort = () => { player.pause(); done(); };
        this.cancel = abort;
        const timer = setTimeout(() => { player.pause(); done(new Error('Meeting voice playback timed out.')); }, 60000);
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.error) done(new Error('The meeting voice could not play.'));
          else if (status.didJustFinish) done();
          else if (status.playing && !started) { started = true; speaking(); }
        });
        signal.addEventListener('abort', abort, { once: true });
        try { player.replace(file.uri); player.play(); }
        catch (error) { done(error instanceof Error ? error : new Error('Meeting audio is unavailable.')); }
      });
    } finally { if (file.exists) file.delete(); }
  }
  dispose() {
    this.cancel?.(); this.cancel = null;
    this.player?.remove(); this.player = null;
  }
}
