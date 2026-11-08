import { SpeechQueue, type SpeechJob, type SpeechState } from '../../src/voice/speech-queue';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('spoken communication queue', () => {
  it('speaks accepted utterances sequentially without rereading previous transcript text', async () => {
    const one = deferred(); const two = deferred(); const states: SpeechState[] = [];
    const play = jest.fn().mockImplementationOnce(() => one.promise).mockImplementationOnce(() => two.promise);
    const queue = new SpeechQueue(play, (state) => states.push(state));
    queue.speak('Hello', { voice: 'male' }, true); queue.speak('I need water', { voice: 'male' }, true);
    expect(play).toHaveBeenCalledTimes(1); expect(play.mock.calls[0][0].text).toBe('Hello');
    one.resolve(); await flush();
    expect(play).toHaveBeenCalledTimes(2); expect(play.mock.calls[1][0].text).toBe('I need water');
    two.resolve(); await flush(); expect(states.at(-1)?.phase).toBe('idle');
  });
  it('Stop aborts the current request and discards queued and late speech', async () => {
    const pending = deferred(); const states: SpeechState[] = [];
    const play = jest.fn((_job: SpeechJob<unknown>, _signal: AbortSignal) => pending.promise); const queue = new SpeechQueue(play, (state) => states.push(state));
    queue.speak('First', {}, true); queue.speak('Second', {}, true);
    const signal = play.mock.calls[0][1] as AbortSignal;
    queue.stop(); expect(signal.aborted).toBe(true);
    const changes = states.length;
    pending.resolve(); await flush();
    expect(play).toHaveBeenCalledTimes(1); expect(states).toHaveLength(changes);
  });
  it('manual replay replaces prior speech and ignores its late completion', async () => {
    const old = deferred(); const next = deferred();
    const play = jest.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    const states: SpeechState[] = []; const queue = new SpeechQueue(play, (state) => states.push(state));
    queue.speak('Old', {}, true); queue.speak('Queued old text', {}, true); queue.speak('Corrected transcript', {});
    expect(play.mock.calls[0][1].aborted).toBe(true); expect(play.mock.calls[1][0].text).toBe('Corrected transcript');
    play.mock.calls[1][2](); expect(states.at(-1)?.phase).toBe('speaking');
    old.resolve(); await flush(); expect(states.at(-1)?.phase).toBe('speaking');
    next.resolve(); await flush(); expect(states.at(-1)?.phase).toBe('idle'); expect(play).toHaveBeenCalledTimes(2);
  });
  it('reports synthesis errors and drops queued speech rather than speaking it unexpectedly later', async () => {
    const play = jest.fn().mockRejectedValue(new Error('No voice credits.'));
    const states: SpeechState[] = []; const queue = new SpeechQueue(play, (state) => states.push(state));
    queue.speak('One', {}, true); queue.speak('Two', {}, true); await flush();
    expect(states.at(-1)).toEqual({ phase: 'idle', message: 'No voice credits.', queued: 0 });
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('bounds latency and rejects invalid text before stopping existing speech', () => {
    const play = jest.fn((_job: SpeechJob<unknown>, _signal: AbortSignal) => new Promise<void>(() => {})); const states: SpeechState[] = [];
    const queue = new SpeechQueue(play, (state) => states.push(state));
    queue.speak('Speaking', {}, true);
    expect(queue.speak('   ', {})).toBe(false); expect(queue.speak('a'.repeat(1201), {})).toBe(false);
    expect(play.mock.calls[0][1].aborted).toBe(false);
    for (let index = 0; index < 6; index++) expect(queue.speak('Next', {}, true)).toBe(true);
    expect(queue.speak('Too many', {}, true)).toBe(false); expect(play.mock.calls[0][1].aborted).toBe(true);
    expect(states.at(-1)?.message).toMatch(/keep up/);
  });
});
