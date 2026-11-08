import React, { act } from 'react';
import { useSentenceTranslator } from '../../src/recognition/use-sentence-translator';
import type { TrackingFrame } from '../../src/recognition/landmarks';
import type { SentenceInput } from '../../src/recognition/sentence-input';
import type { SentenceModels } from '../../src/recognition/sentence-decoder';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockLoad = jest.fn();
const mockTranslate = jest.fn();
jest.mock('../../assets/models/asl_sentence_encoder.tflite', () => 1);
jest.mock('../../assets/models/asl_sentence_decoder.tflite', () => 2);
jest.mock('../../src/recognition/local-model', () => ({ loadBundledModel: (...args: unknown[]) => mockLoad(...args) }));
jest.mock('../../src/recognition/sentence-decoder', () => ({ translateSentence: (...args: unknown[]) => mockTranslate(...args) }));

let sentence: ReturnType<typeof useSentenceTranslator>;
function Pilot({ session = 1, active = true }: { session?: number; active?: boolean }) {
  sentence = useSentenceTranslator(true, active, session);
  return null;
}

function frame(time: number): TrackingFrame {
  const points = (count: number) => Array.from({ length: count }, (_, i) => ({
    x: 0.3 + (i % 7) * 0.04 + Math.sin(time / 200 + i) * 0.04,
    y: 0.25 + (i % 9) * 0.035 + Math.cos(time / 300 + i) * 0.04, z: 0, visibility: 1,
  }));
  const pose = points(33);
  pose[11] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  pose[12] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  return { timestampMs: time, width: 480, height: 640, pose, face: points(478), blendshapes: {}, inferenceMs: 40,
    hands: [{ side: 'Left', score: 0.99, landmarks: points(21) }] };
}

describe('sentence attempt results', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  const record = async () => {
    await act(async () => sentence.start());
    act(() => { for (let t = 0; t <= 3000; t += 125) sentence.onFrame(frame(t)); });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mockLoad.mockReset().mockResolvedValue({});
    mockTranslate.mockReset().mockResolvedValue('Hello world.');
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(Pilot)));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });

  it('shows a result with a reason when stopped before enough movement was captured', async () => {
    await act(async () => sentence.start());
    await act(async () => sentence.finish());
    expect(sentence.result).toBe('unrecognized');
    expect(sentence.message).toMatch(/two seconds/i);
    expect(sentence.draft).toBe('');
    expect(sentence.busy).toBe(false);
    expect(sentence.recording).toBe(false);
    expect(mockTranslate).not.toHaveBeenCalled();
    await act(async () => sentence.start());
    expect(sentence.result).toBeNull();
    expect(sentence.recording).toBe(true);
  });

  it('returns a completed draft and clears the result on discard', async () => {
    await record();
    await act(async () => sentence.finish());
    expect(sentence.result).toBe('translated');
    expect(sentence.draft).toBe('Hello world.');
    act(() => root.render(React.createElement(Pilot, { active: false })));
    expect(sentence.result).toBe('translated');
    expect(sentence.draft).toBe('Hello world.');
    act(() => sentence.clearDraft());
    expect(sentence.result).toBeNull(); expect(sentence.draft).toBe('');
  });

  it('retains actual model text as unverified when final translation is rejected', async () => {
    mockTranslate.mockImplementation(async (_models: SentenceModels, _input: SentenceInput, _current: () => boolean,
      progress: (tokens: number, text: string) => void) => {
      progress(1, 'Hello');
      throw new Error('The sentence translation was uncertain.');
    });
    await record();
    await act(async () => sentence.finish());
    expect(sentence.result).toBe('unverified');
    expect(sentence.draft).toBe('Hello');
    expect(sentence.message).toMatch(/uncertain/);
    expect(sentence.busy).toBe(false);
  });

  it('reports decoder failure with no fabricated text when no words were emitted', async () => {
    mockTranslate.mockRejectedValue(new Error('Sentence decoder returned no result.'));
    await record(); await act(async () => sentence.finish());
    expect(sentence.result).toBe('unrecognized');
    expect(sentence.draft).toBe('');
    expect(sentence.message).toMatch(/no result/);
  });

  it.each(['cancel', 'session change'])('clears partial text and ignores late completion after %s', async (action) => {
    let resolve!: (text: string) => void;
    let progress!: (tokens: number, text: string) => void;
    mockTranslate.mockImplementation((_models: SentenceModels, _input: SentenceInput, _current: () => boolean,
      onProgress: typeof progress) => {
      progress = onProgress; progress(1, 'Hello');
      return new Promise<string>((done) => { resolve = done; });
    });
    await record();
    let pending!: Promise<void>;
    act(() => { pending = sentence.finish(); });
    expect(sentence.result).toBe('processing'); expect(sentence.draft).toBe('Hello');
    act(() => {
      if (action === 'cancel') sentence.cancel();
      else root.render(React.createElement(Pilot, { session: 2 }));
    });
    expect(sentence.result).toBeNull(); expect(sentence.draft).toBe('');
    await act(async () => { progress(2, 'Late text'); resolve('Stale final sentence.'); await pending; });
    expect(sentence.result).toBeNull(); expect(sentence.draft).toBe('');
    expect(sentence.busy).toBe(false);
  });

  it('shows a result if loading fails or tracking is interrupted', async () => {
    mockLoad.mockRejectedValueOnce(new Error('The offline model is missing.'));
    await act(async () => sentence.start());
    expect(sentence.result).toBe('unrecognized');
    expect(sentence.message).toMatch(/missing/);
    await act(async () => sentence.start());
    act(() => { sentence.onFrame(frame(0)); sentence.onFrame(frame(1000)); });
    expect(sentence.result).toBe('unrecognized'); expect(sentence.recording).toBe(false);
    expect(sentence.message).toMatch(/interrupted/);
  });
});
