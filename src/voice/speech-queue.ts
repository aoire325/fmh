export type SpeechPhase = 'idle' | 'preparing' | 'speaking';
export type SpeechState = { phase: SpeechPhase; message: string; queued: number };
export type SpeechJob<Options> = { text: string; options: Options };

/** One utterance at a time. Replacing/stopping invalidates all late network or
 * playback callbacks, so a finished upload cannot suddenly start old speech. */
export class SpeechQueue<Options> {
  private jobs: SpeechJob<Options>[] = [];
  private controller: AbortController | null = null;
  private generation = 0;
  constructor(private play: (job: SpeechJob<Options>, signal: AbortSignal, speaking: () => void) => Promise<void>,
    private onState: (state: SpeechState) => void) {}

  speak(text: string, options: Options, enqueue = false) {
    const normalized = text.trim();
    if (!normalized || normalized.length > 1200) return false;
    if (!enqueue) this.stop();
    if (this.jobs.length >= 6) {
      this.stop('Speech could not keep up. Tap Speak to read the full transcript.'); return false;
    }
    this.jobs.push({ text: normalized, options });
    if (!this.controller) void this.drain();
    return true;
  }
  stop(message = '') {
    this.generation++; this.jobs = []; this.controller?.abort(); this.controller = null;
    this.onState({ phase: 'idle', message, queued: 0 });
  }
  private async drain() {
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    while (this.jobs.length && generation === this.generation) {
      const job = this.jobs.shift()!;
      this.onState({ phase: 'preparing', message: '', queued: this.jobs.length });
      try {
        await this.play(job, controller.signal, () => {
          if (generation === this.generation) this.onState({ phase: 'speaking', message: '', queued: this.jobs.length });
        });
      } catch (error) {
        if (generation === this.generation) this.stop(error instanceof Error ? error.message : 'Speech is unavailable. Try again.');
        return;
      }
    }
    if (generation === this.generation) {
      this.controller = null; this.onState({ phase: 'idle', message: '', queued: 0 });
    }
  }
}
