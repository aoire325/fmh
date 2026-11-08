import React, { act, type ReactNode } from 'react';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { WelcomeScreen } from '../../src/components/welcome-screen';
import AboutScreen from '../../src/app/about';
import { MeetingPlanner } from '../../src/components/meeting-planner';
import HomeScreen from '../../src/app/index';
import { BASELINE_VERSION, type RecognitionExample } from '../../src/recognition/recognition-examples';
import { SIGN_FEATURE_WIDTH } from '../../src/recognition/sign-features';
import type { SentenceResult } from '../../src/recognition/use-sentence-translator';

// Keep Expo's native Jest environment; its setup defines window itself and
// cannot be combined directly with the jsdom environment's window accessor.
const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockCamera = { isActive: true, session: 'running', sessionToken: 1, facing: 'front',
  permission: { granted: true }, error: '', pause: jest.fn(), stop: jest.fn(),
  switchCamera: jest.fn(), reportCameraError: jest.fn(), start: jest.fn() };
let mockTutorialSeen = true;
const mockMarkTutorialSeen = jest.fn(() => { mockTutorialSeen = true; });
let mockStoredTutorial = false;
let mockStorageFails = false;
let mockSavedExamples: string | null = null;
let mockSavedMeetings: string | null = null;
const mockWriteFlag = jest.fn();
let mockView: string | undefined = 'camera';
let mockDimensions = { width: 1200, height: 900, fontScale: 1 };
let mockReduceMotion = false;
let mockMotionListener: (enabled: boolean) => void;
const mockRemoveMotionListener = jest.fn();
const mockSetOffset = jest.fn();
const mockStopAnimation = jest.fn();
const mockScrollTo = jest.fn();
let mockKeyboardDidShow: () => void;
const mockAnimate = jest.fn((_value: unknown, _config: unknown) => ({ start: jest.fn() }));
let mockCameraMounts = 0;
const mockChooseCandidate = jest.fn();
const mockSpeakAccepted = jest.fn();
const mockSpeak = jest.fn();
const mockStopSpeech = jest.fn();
let mockCandidates: string[] = [];
let mockProcessing = false;
let mockRecognitionMessage = 'Sign one word, then lower your hands.';
const mockFinishSign = jest.fn();
const mockSentence = { recording: true, busy: false, frame: null, draft: '', result: null as SentenceResult | null,
  message: 'Recording your sentence', editDraft: jest.fn(), clearDraft: jest.fn(),
  finish: jest.fn(), start: jest.fn(), cancel: jest.fn(), onFrame: jest.fn() };

jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children, onLayout, style, testID }: { children?: ReactNode; onLayout?: (event: unknown) => void; style?: unknown; testID?: string }) => {
    React.useLayoutEffect(() => { onLayout?.({ nativeEvent: { layout: { y: 320 } } }); }, [onLayout]);
    const entries = [style].flat() as ({ flexDirection?: string } | false | undefined)[];
    const direction = entries.reduce<{ flexDirection?: string }>((result, entry) => entry ? { ...result, ...entry } : result, {}).flexDirection;
    return React.createElement('div', { 'data-direction': direction || 'column', 'data-testid': testID }, children);
  };
  const measuredView = React.forwardRef((props: Parameters<typeof container>[0], ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ measureLayout: (_parent: unknown, success: (...values: number[]) => void) => success(0, 420, 300, 60) }));
    return React.createElement(container, props);
  });
  return { View: measuredView, Text: container, KeyboardAvoidingView: container,
    Modal: container, Platform: { OS: 'android' },
    FlatList: ({ data, renderItem, ListEmptyComponent }: {
      data: string[]; renderItem: (value: { item: string }) => ReactNode; ListEmptyComponent: ReactNode;
    }) => React.createElement('div', null, data.length
      ? data.slice(0, 20).map((item) => React.createElement('div', { key: item }, renderItem({ item }))) : ListEmptyComponent),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(mockReduceMotion),
      addEventListener: (_event: string, listener: (enabled: boolean) => void) => {
        mockMotionListener = listener; return { remove: mockRemoveMotionListener };
      },
    },
    useAnimatedValue: () => React.useState(() => ({ setValue: mockSetOffset, stopAnimation: mockStopAnimation }))[0],
    Animated: { Text: container, loop: () => ({ start: jest.fn(), stop: jest.fn() }), sequence: () => ({}), timing: (value: unknown, config: unknown) => mockAnimate(value, config),
      Value: class { setValue = mockSetOffset; stopAnimation = mockStopAnimation; } },
    useWindowDimensions: () => mockDimensions,
    ScrollView: React.forwardRef((props: Parameters<typeof container>[0], ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return React.createElement(container, props);
    }),
    TextInput: ({ value, onChangeText, onFocus, onBlur, accessibilityLabel }: {
      value: string; onChangeText: (value: string) => void; onFocus?: () => void;
      onBlur?: () => void; accessibilityLabel?: string;
    }) => React.createElement('textarea', { value, onFocus, onBlur, 'aria-label': accessibilityLabel,
      onInput: (event: { currentTarget: HTMLTextAreaElement }) => onChangeText(event.currentTarget.value),
      onChange: () => undefined }), ActivityIndicator: () => React.createElement('div', { role: 'progressbar' }),
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: {
      children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string;
    }) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
    Switch: ({ accessibilityLabel, value, onValueChange }: { accessibilityLabel: string; value: boolean; onValueChange: (value: boolean) => void }) =>
      React.createElement('button', { 'aria-label': accessibilityLabel, 'aria-checked': value, onClick: () => onValueChange(!value) }, String(value)),
    Alert: { alert: jest.fn() },
    Keyboard: { dismiss: jest.fn(), addListener: (_event: string, listener: () => void) => {
      mockKeyboardDidShow = listener; return { remove: jest.fn() };
    } }, Linking: { openSettings: jest.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => jest.requireActual('react').createElement('div', null, children),
}));
jest.mock('expo-image', () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => jest.requireActual('react').createElement('img', { alt: accessibilityLabel }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), setParams: jest.fn(({ view }: { view: string }) => { mockView = view; }) },
  useLocalSearchParams: () => ({ view: mockView }), useIsFocused: () => true,
}));
jest.mock('../../src/camera/use-camera-session', () => ({ useCameraSession: (active: boolean) => ({ ...mockCamera, isActive: active && mockCamera.isActive }) }));
jest.mock('../../src/camera/live-landmark-camera', () => ({
  LiveLandmarkCamera: ({ onReady }: { onReady: () => void }) => {
    const React = jest.requireActual('react');
    React.useEffect(() => { mockCameraMounts++; }, []);
    return React.createElement('button', { onClick: onReady, 'aria-label': 'Simulate camera ready' });
  },
}));
jest.mock('../../src/camera/landmark-overlay', () => ({ LandmarkOverlay: () => jest.requireActual('react').createElement('div', { 'data-testid': 'tracking-guides' }) }));
jest.mock('../../src/recognition/use-sentence-translator', () => ({ useSentenceTranslator: () => mockSentence }));
jest.mock('../../src/recognition/use-asl-word-recognizer', () => ({
  useAslWordRecognizer: (_active: boolean, _token: number, onWord: (word: string) => void) => ({
    processing: mockProcessing, candidates: mockCandidates, status: 'loaded',
    finishSign: mockFinishSign, message: mockRecognitionMessage,
    chooseCandidate: (word: string) => { mockChooseCandidate(word); onWord(word); },
  }),
}));
jest.mock('../../src/state/voice-settings', () => ({ useVoiceSettings: () => ({
  preferences: { voice: 'device', autoSpeak: false, rate: 1 }, setPreferences: jest.fn(),
  speech: { phase: 'idle', message: '', queued: 0 }, speakAccepted: mockSpeakAccepted, speak: mockSpeak, stop: mockStopSpeech,
}) }));
jest.mock('../../src/state/accessibility-settings', () => ({ useAccessibilitySettings: () => ({
  largeText: false, highContrast: false, tutorialSeen: mockTutorialSeen, markTutorialSeen: mockMarkTutorialSeen,
}) }));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  File: class {
    path: string;
    constructor(...parts: string[]) { this.path = parts.join('/'); }
    get exists() {
      if (mockStorageFails) throw new Error('Storage unavailable');
      if (this.path.endsWith('talkbridge-meetings-v1.json')) return mockSavedMeetings !== null;
      return this.path.endsWith('signbridge-examples-v1.json') ? mockSavedExamples !== null : mockStoredTutorial;
    }
    get size() { return mockSavedExamples?.length ?? 0; }
    async text() { return this.path.endsWith('talkbridge-meetings-v1.json') ? mockSavedMeetings : mockSavedExamples; }
    create() { if (mockStorageFails) throw new Error('Storage unavailable'); }
    writeSync(value: string) {
      if (mockStorageFails) throw new Error('Storage unavailable');
      if (this.path.endsWith('talkbridge-meetings-v1.json')) { mockSavedMeetings = value; return; }
      mockWriteFlag(value); mockStoredTutorial = true;
    }
  },
}));


describe('home screen sentence stop action', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks(); mockTutorialSeen = true; mockView = 'camera'; mockSentence.busy = false; mockSentence.recording = true;
    mockSentence.result = null; mockSentence.draft = '';
    mockSentence.editDraft.mockImplementation((value: string) => { mockSentence.draft = value; });
    mockSentence.clearDraft.mockImplementation(() => { mockSentence.draft = ''; mockSentence.result = null; });
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Options"]')!.click());
    const sentences = container.querySelector<HTMLButtonElement>('button[aria-label="Sentences"]')!;
    act(() => sentences.click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); mockSentence.result = null; mockSentence.draft = ''; });

  it('sends Stop to sentence translation without stopping the camera or losing the capture', () => {
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Simulate camera ready"]')!.click());
    const stops = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Stop & translate"]');
    expect(stops.length).toBe(2);
    for (const stop of stops) {
      expect(stop.textContent).toContain('Stop & translate');
      expect(stop.disabled).toBe(false);
      jest.clearAllMocks();
      act(() => stop.click());
      expect(mockSentence.finish).toHaveBeenCalledTimes(1);
      expect(mockCamera.stop).not.toHaveBeenCalled();
    }
    const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sentence"]')!;
    expect(cancel.textContent).toContain('Cancel sentence');
    act(() => cancel.click());
    expect(mockSentence.cancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Pause camera"]')!.disabled).toBe(true);
  });

  it('shows a visible Record sentence button before recording starts', () => {
    mockSentence.recording = false;
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Simulate camera ready"]')!.click());
    const record = container.querySelector<HTMLButtonElement>('button[aria-label="Record sentence"]')!;
    expect(record.textContent).toContain('Record sentence');
    expect(record.disabled).toBe(false);
    act(() => record.click());
    expect(mockSentence.start).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Stop camera"]')!.textContent).toContain('Stop camera');
  });

  it('blocks camera stop during processing and shows progress plus cancellation', () => {
    mockSentence.recording = false; mockSentence.busy = true;
    mockSentence.message = 'Analysing the recorded sentence offline';
    act(() => root.render(React.createElement(HomeScreen)));
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(container.textContent).toContain(mockSentence.message);
    const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop camera"]')!;
    expect(stop.disabled).toBe(true);
    act(() => stop.click());
    expect(mockCamera.stop).not.toHaveBeenCalled();
    const working = container.querySelector<HTMLButtonElement>('button[aria-label="Working offline…"]')!;
    expect(working.textContent).toContain('Working offline…');
    expect(working.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Cancel sentence"]')!.disabled).toBe(false);
  });

  it('shows an empty-capture result and allows a typed sentence without inventing a translation', () => {
    mockSentence.recording = false; mockSentence.result = 'unrecognized';
    mockSentence.message = 'No clear signing movement was captured. Please record the sentence again.';
    act(() => root.render(React.createElement(HomeScreen)));
    const panel = container.querySelector('[data-testid="sentence-result"]')!;
    expect(panel.textContent).toContain('No clear sentence detected');
    expect(panel.textContent).toContain(mockSentence.message);
    const draft = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(draft.value).toBe('');
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="Add sentence to transcript"]')!.disabled).toBe(true);
    act(() => { draft.value = 'I need help.'; draft.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    act(() => root.render(React.createElement(HomeScreen)));
    const transcript = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Sentence transcript"]')!;
    expect(transcript.value).toBe('');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Add sentence to transcript"]')!.click());
    expect(transcript.value).toBe('I need help.');
    expect(mockSentence.clearDraft).toHaveBeenCalledTimes(1);
    expect(mockSpeakAccepted).toHaveBeenCalledWith('I need help.');
  });

  it('shows recovered model text as unverified and waits for review before inserting it', () => {
    mockSentence.recording = false; mockSentence.result = 'unverified'; mockSentence.draft = 'Hello';
    mockSentence.message = 'The sentence translation was uncertain.';
    act(() => root.render(React.createElement(HomeScreen)));
    const panel = container.querySelector('[data-testid="sentence-result"]')!;
    expect(panel.textContent).toContain('Unverified draft');
    expect(panel.textContent).toContain('uncertain or incomplete AI guess');
    expect(panel.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Hello');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Sentence transcript"]')!.value).toBe('');
    expect(mockSpeakAccepted).not.toHaveBeenCalled();
  });

  it('shows progress and partial text immediately after stop, with insertion disabled until processing ends', () => {
    mockSentence.recording = false; mockSentence.busy = true; mockSentence.result = 'processing'; mockSentence.draft = 'Hello';
    act(() => root.render(React.createElement(HomeScreen)));
    const panel = container.querySelector('[data-testid="sentence-result"]')!;
    expect(panel.textContent).toContain('Translating your recording…');
    expect(panel.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(panel.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Hello');
    expect(panel.querySelector<HTMLButtonElement>('button[aria-label="Add sentence to transcript"]')!.disabled).toBe(true);
  });
}); 



describe('Sign to Text review flow', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const input = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Word transcript"]')!;
  const typeText = (value: string) => act(() => {
    input().value = value;
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks(); mockSavedExamples = null; mockTutorialSeen = true; mockDimensions = { width: 1200, height: 900, fontScale: 1 }; mockView = 'camera'; mockCameraMounts = 0; mockCandidates = ['HELLO']; mockProcessing = false;
    mockSentence.recording = false; mockSentence.busy = false;
    mockRecognitionMessage = 'Sign one word, then lower your hands.';
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(HomeScreen)));
    act(() => button('Simulate camera ready').click());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); mockSavedExamples = null; });

  it('speaks only accepted signs and lets typed text be read explicitly', () => {
    expect(mockSpeakAccepted).not.toHaveBeenCalled();
    act(() => button('Add HELLO').click());
    expect(input().value).toBe('HELLO'); expect(mockSpeakAccepted).toHaveBeenCalledTimes(1);
    expect(mockSpeakAccepted).toHaveBeenCalledWith('HELLO');
    typeText('I would like some water.');
    expect(mockSpeakAccepted).toHaveBeenCalledTimes(1);
    act(() => button('Speak transcript out loud').click());
    expect(mockSpeak).toHaveBeenCalledWith('I would like some water.');
    act(() => button('Choose a voice or upload a voice video').click());
    expect(router.push).toHaveBeenCalledWith('/voice');
  });

  it('stops speech when clearing text and does not speak words that cannot fit', () => {
    typeText('a'.repeat(1200));
    act(() => button('Add HELLO').click());
    expect(input().value).toHaveLength(1200); expect(mockSpeakAccepted).not.toHaveBeenCalled();
    mockStopSpeech.mockClear();
    act(() => button('Clear').click());
    expect(input().value).toBe(''); expect(mockStopSpeech).toHaveBeenCalledTimes(1);
    expect(button('Speak transcript out loud').disabled).toBe(true);
  });

  it('returns to welcome and reopens the same experience with text intact', () => {
    typeText('Keep my text');
    act(() => { button('Home').click(); root.render(React.createElement(HomeScreen)); });
    expect(container.querySelector('[data-testid="brand-footer"]')!.textContent).toContain('Communication Without Barriers');
    expect(button('Simulate camera ready')).toBeNull();
    expect(mockCamera.pause).toHaveBeenCalledTimes(1);
    act(() => { mockView = 'camera'; root.render(React.createElement(HomeScreen)); });
    expect(input().value).toBe('Keep my text');
    expect(mockCamera.start).not.toHaveBeenCalled();
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('shows welcome by default and enters the existing camera experience', () => {
    mockView = undefined;
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Get Started')).toBeNull();
    expect(button('New')).not.toBeNull();
    expect(button('Dictionary')).toBeNull();
    act(() => { mockView = 'camera'; root.render(React.createElement(HomeScreen)); });
    expect(button('Dictionary')).not.toBeNull();
    expect(button('Simulate camera ready')).not.toBeNull();
  });

  it('opens, searches and closes Dictionary without remounting or pausing the camera', () => {
    expect(button('Close Dictionary')).toBeNull();
    typeText('Keep this');
    act(() => button('Dictionary').click());
    expect(container.textContent).toContain('2,917 words');
    const search = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Search Dictionary"]')!;
    expect(search).not.toBeNull();
    act(() => { search.value = 'hello'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(container.textContent).toContain('HELLO');
    act(() => { search.value = 'moon'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(button('Select MOON')).not.toBeNull();
    act(() => { search.value = 'zzzzzznomatch'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(container.textContent).toContain('No matching words.');
    act(() => button('Close Dictionary').click());
    expect(button('Close Dictionary')).toBeNull();
    expect(input().value).toBe('Keep this');
    expect(mockCameraMounts).toBe(1);
    expect(mockCamera.pause).not.toHaveBeenCalled();
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('loads trained personal words into Dictionary, deduplicates versions, and keeps the existing selection flow', async () => {
    const version = (label: string, variantId: string, count = 3): RecognitionExample[] => Array.from({ length: count }, (_, i) => ({
      id: `${variantId}-${i}`, label, variantId, signer: 'me', session: variantId, split: 'train',
      createdAt: '2026-10-25', baselineVersion: BASELINE_VERSION,
      sequence: { version: 1, durationMs: 1000, frames: Array.from({ length: 24 }, (_, j) => ({ timestampMs: j * 1000 / 23,
        values: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(0.1), mask: Array<number>(SIGN_FEATURE_WIDTH * 2).fill(1) })) },
      baseline: ['FOREST', 'PILLOW', 'CLOUD'], displayed: ['FOREST', 'PILLOW', 'CLOUD'],
      diagnostics: { frames: 11, fps: 10, maxGapMs: 100, handCoverage: 1, faceCoverage: 1, inferenceMs: 20 },
    }));
    mockSavedExamples = JSON.stringify({ version: 1, examples: [
      ...version('MY NEW WORD', 'first'), ...version('MY NEW WORD', 'second'), ...version('HELLO', 'hello'),
      ...version('MY UNFINISHED WORD', 'unfinished', 1),
      ...version('MY TEST WORD', 'test').map((e) => ({ ...e, split: 'test' })),
      ...version('MY OTHER SIGNER', 'other').map((e) => ({ ...e, signer: 'someone-else' })),
    ] });
    // Reopening uses the real saved-example loader, including words taught before this UI update.
    await act(async () => root.render(React.createElement(HomeScreen, { key: 'reopened' })));
    const mounts = mockCameraMounts;
    act(() => button('Dictionary').click());
    expect(container.textContent).toContain('2,918 words');
    const search = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Search Dictionary"]')!;
    const searchFor = (value: string) => act(() => {
      search.value = value; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    for (const word of ['MY UNFINISHED WORD', 'MY TEST WORD', 'MY OTHER SIGNER']) {
      searchFor(word); expect(container.textContent).toContain('No matching words.');
    }
    searchFor('hello');
    expect(container.textContent).toContain('1 word');
    expect(container.querySelectorAll('button[aria-label="Select HELLO"]')).toHaveLength(1);
    searchFor('my new');
    expect(container.textContent).toContain('1 word');
    expect(container.querySelectorAll('button[aria-label="Select MY NEW WORD"]')).toHaveLength(1);
    await act(async () => button('Select MY NEW WORD').click());
    expect(button('Close Dictionary')).toBeNull();
    expect(container.textContent).toContain('Your gesture versions all produce “MY NEW WORD”');
    expect(container.textContent).toContain('2 saved versions of MY NEW WORD');
    act(() => button('Close Personal signs').click());
    act(() => button('Dictionary').click());
    expect(container.textContent).toContain('2,918 words');
    act(() => button('Close Dictionary').click());
    expect(mockCameraMounts).toBe(mounts);
    expect(mockCamera.pause).not.toHaveBeenCalled(); expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('opens the optional learning tools and arms an example without remounting the camera', async () => {
    mockStoredTutorial = false;
    expect(button('Recognition Lab')).toBeNull();
    act(() => button('Options').click());
    await act(async () => button('Recognition Lab').click());
    const label = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Expected sign"]')!;
    act(() => { label.value = 'HELLO'; label.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(button('Record example').disabled).toBe(false);
    act(() => button('Record example').click());
    expect(container.textContent).toContain('Example: HELLO');
    expect(mockCameraMounts).toBe(1);
    act(() => button('Cancel recording').click());
    act(() => button('Close Recognition Lab').click());
    expect(mockCameraMounts).toBe(1);
    expect(mockCamera.stop).not.toHaveBeenCalled();
    expect(mockCamera.pause).not.toHaveBeenCalled();
  });

  it('replaces the old teaching flow with an explicit new-word choice without remounting the camera', async () => {
    act(() => button('Options').click());
    expect(button('Teach a sign')).toBeNull();
    await act(async () => button('Personal signs').click());
    expect(button('Record version example')).toBeNull();
    act(() => button('Add new word').click());
    const label = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New personal word"]')!;
    expect(label).not.toBeNull();
    act(() => { label.value = 'MY NAME'; label.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    act(() => button('Use this word').click());
    act(() => button('Teach my version').click());
    expect(button('Record version example').disabled).toBe(false);
    act(() => button('Record version example').click());
    expect(container.textContent).toContain('Example: MY NAME');
    expect(mockCameraMounts).toBe(1);
    act(() => button('Close Personal signs').click());
    expect(button('Record version example')).toBeNull();
    expect(container.textContent).not.toContain('Example: MY NAME');
    act(() => button('Dictionary').click()); expect(container.textContent).toContain('2,917 words');
    expect(mockCameraMounts).toBe(1); expect(mockCamera.stop).not.toHaveBeenCalled(); expect(mockCamera.pause).not.toHaveBeenCalled();
  });

  it('selects HELLO from Dictionary and records a version under its existing word', async () => {
    act(() => button('Dictionary').click());
    const search = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Search Dictionary"]')!;
    act(() => { search.value = 'hello'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => button('Select HELLO').click());
    expect(button('Close Dictionary')).toBeNull();
    expect(container.textContent).toContain('Your gesture versions all produce “HELLO”');
    act(() => button('Teach my version').click());
    act(() => button('Record version example').click());
    expect(container.textContent).toContain('Example: HELLO');
    expect(mockCameraMounts).toBe(1);
    act(() => button('Cancel version recording').click());
    act(() => button('Close Personal signs').click());
    expect(input().value).toBe('');
  });

  it('offers adding a missing word from Dictionary and reuses canonical existing names', async () => {
    act(() => button('Dictionary').click());
    await act(async () => button('Word not in Dictionary').click());
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="New personal word"]')!;
    act(() => { input.value = 'hello'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(button('Use this word').textContent).toContain('Use existing HELLO');
    act(() => button('Use this word').click());
    expect(container.textContent).toContain('Your gesture versions all produce “HELLO”');
    expect(mockCameraMounts).toBe(1);
  });

  it('keeps secondary tools closed by default and adapts the panels to screen width and text scaling', () => {
    expect(button('Undo')).toBeNull();
    expect(button('Sentences')).toBeNull();
    expect(container.textContent).not.toContain('NOT SAVED');
    expect(button('Copy')).not.toBeNull();
    const direction = () => container.querySelector('[data-testid="translation-workspace"]')!.getAttribute('data-direction');
    expect(direction()).toBe('row');
    mockDimensions = { width: 390, height: 640, fontScale: 1 };
    act(() => root.render(React.createElement(HomeScreen)));
    expect(direction()).toBe('column');
    mockDimensions = { width: 1200, height: 900, fontScale: 2 };
    act(() => root.render(React.createElement(HomeScreen)));
    expect(direction()).toBe('column');
  });

  it('guides all four targets, supports Back and Finish, and leaves no tutorial UI behind', () => {
    mockTutorialSeen = false;
    act(() => button('Options').click());
    act(() => button('Replay tutorial').click());
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    expect(button('Back').disabled).toBe(true);
    act(() => button('Next').click());
    expect(container.textContent).toContain('Your recognized signs will appear here.');
    act(() => button('Back').click());
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    act(() => button('Next').click());
    act(() => button('Next').click());
    expect(container.textContent).toContain('Choose a suggestion if the recognition is incorrect.');
    const mounts = mockCameraMounts;
    act(() => button('Add HELLO').click());
    expect(input().value).toBe('HELLO');
    act(() => button('Next').click());
    expect(container.textContent).toContain('Open Dictionary to explore available signs.');
    act(() => button('Dictionary').click());
    expect(button('Close Dictionary')).not.toBeNull();
    act(() => button('Close Dictionary').click());
    act(() => button('Finish').click());
    expect(button('Next')).toBeNull(); expect(button('Finish')).toBeNull(); expect(button('Skip')).toBeNull();
    expect(container.textContent).not.toContain('Quick tour');
    expect(container.textContent).not.toContain('↓');
    expect(mockMarkTutorialSeen).toHaveBeenCalledTimes(1);
    expect(mockCameraMounts).toBe(mounts);
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('supports Skip, remembers completion and allows replay through Options', () => {
    mockTutorialSeen = false;
    act(() => button('Options').click());
    act(() => button('Replay tutorial').click());
    act(() => button('Skip').click());
    expect(button('Next')).toBeNull();
    expect(mockMarkTutorialSeen).toHaveBeenCalledTimes(1);
    act(() => { button('Home').click(); root.render(React.createElement(HomeScreen)); });
    act(() => { mockView = 'camera'; root.render(React.createElement(HomeScreen)); });
    expect(button('Next')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Replay tutorial').click());
    expect(container.textContent).toContain('Position your hands in front of the camera.');
    act(() => button('Skip').click());
  });

  it('keeps tutorial arrows static when reduced motion is enabled', async () => {
    mockReduceMotion = true;
    act(() => button('Options').click());
    await act(async () => button('Replay tutorial').click());
    expect(mockAnimate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Quick tour');
    mockReduceMotion = false;
  });

  it('removes redundant labels and places the existing suggestions before recognized text', () => {
    expect(container.textContent).not.toContain('EDITABLE');
    expect(container.textContent).not.toContain('ASL word recognition');
    expect(container.textContent).toContain('Recognized Text');
    expect(container.textContent).not.toContain('Suggestions');
    expect(container.textContent).not.toContain('3 possible matches');
    expect(container.textContent!.indexOf('HELLO')).toBeLessThan(container.textContent!.indexOf('Recognized Text'));
    expect(button('Home').textContent).toContain('Home');
    expect(button('Dictionary').textContent).toContain('Dictionary');
    expect(button('Options').textContent).toContain('Options');
    typeText('Still editable');
    expect(input().value).toBe('Still editable');
  });

  it('adds a real candidate to the editable transcript through the existing selection callback', () => {
    expect(input().value).toBe('');
    act(() => button('Add HELLO').click());
    expect(mockChooseCandidate).toHaveBeenCalledWith('HELLO');
    expect(input().value).toBe('HELLO');
  });

  it('supports manual edits, copy and clear', async () => {
    typeText('Hello there');
    await act(async () => button('Copy').click());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Hello there');
    act(() => button('Clear').click());
    expect(input().value).toBe('');
  });

  it('removes the extended text tools and keeps the basic editing controls', () => {
    for (const label of ['More text tools', 'Fewer text tools', 'Add space', 'Delete last character', 'Undo', 'Confirm final text']) {
      expect(button(label)).toBeNull();
    }
    typeText('Reviewed text');
    expect(input().value).toBe('Reviewed text');
    expect(button('Copy').disabled).toBe(false);
    expect(button('Clear').disabled).toBe(false);
    expect(mockCamera.pause).not.toHaveBeenCalled();
  });

  it('expands Options above the camera and closes without remounting it', () => {
    expect(container.textContent).not.toContain('Recognition options');
    act(() => button('Options').click());
    expect(container.textContent!.indexOf('Recognition options')).toBeLessThan(container.textContent!.indexOf('Recognized Text'));
    expect(button('Words')).not.toBeNull();
    expect(button('Use legacy 1,000-sign model')).toBeNull();
    expect(button('Use original 250-sign model')).toBeNull();
    expect(container.textContent).not.toMatch(/2,917|3,000|250-sign/);
    expect(mockCameraMounts).toBe(1);
    act(() => button('Hide options').click());
    expect(container.textContent).not.toContain('Recognition options');
    expect(mockCameraMounts).toBe(1);
  });

  it('shows three clickable matches without a retry button or blocking the next sign', () => {
    mockCandidates = ['HELLO', 'WATER', 'FRIEND'];
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Try again')).toBeNull();
    expect(button('Finish sign').disabled).toBe(false);
    for (const word of mockCandidates) {
      expect(button(`Add ${word}`).disabled).toBe(false);
      expect(button(`Add ${word}`).textContent).toContain(word);
      expect(button(`Add ${word}`).textContent).toBe(word);
    }
    expect(mockCameraMounts).toBe(1);
  });

  it('disables candidate selection and Finish during inference', () => {
    mockProcessing = true;
    act(() => root.render(React.createElement(HomeScreen)));
    expect(button('Try again')).toBeNull();
    expect(button('Add HELLO').disabled).toBe(true);
    expect(button('Finish sign')).toBeNull();
    expect(button('Reading sign…').disabled).toBe(true);
  });

  it('shows tracking guides by default, can hide them without remounting the camera and preserves Settings navigation', () => {
    expect(container.querySelector('[data-testid="tracking-guides"]')).not.toBeNull();
    expect(button('Open model and accessibility settings')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Hide tracking guides').click());
    expect(container.querySelector('[data-testid="tracking-guides"]')).toBeNull();
    act(() => button('Show tracking guides').click());
    expect(container.querySelector('[data-testid="tracking-guides"]')).not.toBeNull();
    expect(mockCameraMounts).toBe(1);
    act(() => button('Open model and accessibility settings').click());
    expect(router.push).toHaveBeenCalledWith('/settings');
    expect(mockCamera.stop).not.toHaveBeenCalled();
  });

  it('explains missing alternatives without displaying invented suggestions', () => {
    mockCandidates = [];
    act(() => root.render(React.createElement(HomeScreen)));
    expect(container.textContent).toContain(mockRecognitionMessage);
    expect(button('Add HELLO')).toBeNull();
    act(() => button('Options').click());
    act(() => button('Sentences').click());
    expect(container.textContent).toContain('no alternative predictions');
  });
});

describe('homepage and About navigation', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('shows the simplified homepage without the removed introduction or calendar copy', async () => {
    await act(async () => root.render(React.createElement(WelcomeScreen)));
    expect(container.querySelector('img')).toBeNull();
    for (const removed of ['Your week', 'Open translator', 'Plans are saved on this device']) {
      expect(container.textContent).not.toContain(removed);
    }
    expect(container.querySelector('button[aria-label="Today"]')).toBeNull();
    expect(container.querySelector('button[aria-label="New"]')).not.toBeNull();
    expect(mockAnimate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="brand-footer"]')!.textContent).toBe('talkbridgeCommunication Without Barriers');
  });

  it('shows the supplied About copy and only Homepage and Setting navigation', async () => {
    await act(async () => root.render(React.createElement(AboutScreen)));
    expect(container.textContent).toContain('About TalkBridge');
    expect(container.textContent).toContain('Who We Are');
    expect(container.textContent).toContain('Our Mission');
    expect(container.querySelector('[data-testid="brand-footer"]')!.textContent).toBe('talkbridgeCommunication Without Barriers');
    for (const value of ['Inclusivity:', 'Accessibility:', 'Understanding:', 'Respect:']) expect(container.textContent).toContain(value);
    expect(container.querySelector('button[aria-label="About Us"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Help"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Homepage"]')!.click());
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/', params: { view: 'welcome' } });
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Setting"]')!.click());
    expect(router.push).toHaveBeenCalledWith('/settings');
  });

  it('opens settings from the homepage information bar', async () => {
    await act(async () => root.render(React.createElement(WelcomeScreen)));
    expect(container.textContent).toContain('talkbridge');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Setting"]')!.click());
    expect(router.push).toHaveBeenCalledWith('/settings');
  });

  it('reveals the focused code field after the keyboard opens and stops after blur', async () => {
    await act(async () => root.render(React.createElement(WelcomeScreen)));
    const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Meeting code"]')!;
    act(() => field.focus());
    mockScrollTo.mockClear();
    act(() => mockKeyboardDidShow());
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 404, animated: false });
    act(() => field.blur()); mockScrollTo.mockClear();
    act(() => mockKeyboardDidShow()); expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it('returns to the top of the homepage without starting the translator', async () => {
    await act(async () => root.render(React.createElement(WelcomeScreen)));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Homepage"]')!.click());
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    expect(container.textContent).not.toContain('Open translator');
  });

  it('shows help when the question mark is pressed', async () => {
    await act(async () => root.render(React.createElement(WelcomeScreen)));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Help"]')!.click());
    expect(Alert.alert).toHaveBeenCalledWith('TalkBridge help', expect.stringContaining('Instant Meeting'), [{ text: 'Got it' }]);
  });
});

describe('saved tutorial preference', () => {
  const { AccessibilitySettingsProvider, useAccessibilitySettings } = jest.requireActual('../../src/state/accessibility-settings');
  let current: { tutorialSeen: boolean; markTutorialSeen: () => void };
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  function SettingsProbe() { current = useAccessibilitySettings(); return null; }
  beforeEach(() => {
    mockStorageFails = false; mockStoredTutorial = false; mockWriteFlag.mockClear();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const renderSettings = () => act(() => root.render(React.createElement(AccessibilitySettingsProvider, null, React.createElement(SettingsProbe))));

  it('persists completion and reads it when the settings provider mounts again', () => {
    renderSettings(); expect(current.tutorialSeen).toBe(false);
    act(() => current.markTutorialSeen());
    expect(current.tutorialSeen).toBe(true); expect(mockWriteFlag).toHaveBeenCalledWith('complete');
    act(() => root.unmount()); root = createRoot(container);
    renderSettings(); expect(current.tutorialSeen).toBe(true);
  });

  it('keeps a session preference when device storage is unavailable', () => {
    mockStorageFails = true; renderSettings();
    expect(current.tutorialSeen).toBe(false);
    act(() => current.markTutorialSeen());
    expect(current.tutorialSeen).toBe(true);
  });
});

describe('homepage meeting plans', () => {
  let container: HTMLDivElement;
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  const instant = jest.fn();
  const click = (label: string) => act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  const input = (label: string, value: string) => act(() => {
    const field = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
    field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const render = () => act(async () => root.render(React.createElement(MeetingPlanner, { onInstantMeeting: instant })));
  beforeEach(() => {
    jest.clearAllMocks(); mockStorageFails = false; mockSavedMeetings = null;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('opens an instant meeting from New', async () => {
    await render(); click('New'); click('Instant Meeting'); expect(instant).toHaveBeenCalledTimes(1);
  });
  it('distinguishes today from other empty days and shows the scheduling hint', async () => {
    await render();
    expect(container.textContent).toContain('No calls planned for today');
    expect(container.textContent).toContain('Pick a day, then press New to schedule a meeting.');
    click('Next week');
    expect(container.textContent).toContain('No calls planned on this day.');
    expect(container.textContent).not.toContain('No calls planned for today');
    click('Previous week');
    expect(container.textContent).toContain('No calls planned for today');
  });
  it('saves a future meeting, restores it on reopening, and can remove it', async () => {
    await render(); click('Next week'); click('New'); click('Create a Meeting for Later');
    input('Meeting title', 'Family call'); input('Meeting time', '14:30'); click('Save meeting');
    const saved = JSON.parse(mockSavedMeetings!);
    expect(saved[0].title).toBe('Family call'); expect(new Date(saved[0].startsAt).getHours()).toBe(14);
    expect(container.textContent).toContain('Meeting saved on this device.');
    act(() => root.unmount()); root = createRoot(container); await render(); click('Next week');
    expect(container.textContent).toContain('Family call');
    click('Start Family call'); expect(instant).toHaveBeenCalledTimes(1);
    click('Remove Family call'); expect(JSON.parse(mockSavedMeetings!)).toEqual([]);
  });
  it('rejects invalid codes and keeps the service address from a complete invitation', async () => {
    await render(); input('Meeting code', 'bad'); click('Join');
    expect(router.push).not.toHaveBeenCalled(); expect(container.textContent).toContain('valid 12-character code');
    input('Meeting code', 'signbridge:///call?code=ABCDEFGHJKLM&service=wss%3A%2F%2Fcall.example.com%2Fcalls'); click('Join');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/call', params: { code: 'ABCDEFGHJKLM', service: 'wss://call.example.com/calls' } });
  });
  it('reports a storage failure without claiming the meeting was saved', async () => {
    await render(); click('Next week'); click('New'); click('Create a Meeting for Later'); input('Meeting title', 'Family call');
    mockStorageFails = true; click('Save meeting');
    expect(container.textContent).toContain('Could not save your calendar'); expect(mockSavedMeetings).toBeNull();
  });
});

afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
