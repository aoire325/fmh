import React, { act } from 'react';
import { useMeetingVoice } from '../../src/calls/use-meeting-voice';
import { initialCallState, type CallPhase } from '../../src/calls/call-session';
import type { MeetingAudio } from '../../src/calls/meeting-speech';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockCloud = jest.fn();
const mockPlay = jest.fn(async () => {}); const mockDispose = jest.fn();
const mockSend = jest.fn(async (..._args: unknown[]) => {}); const mockStop = jest.fn(); const mockListen = jest.fn();
let mockIncoming: (audio: MeetingAudio | null) => void;
const mockSubscribe = (listener: typeof mockIncoming) => { mockIncoming = listener; return () => { mockIncoming = () => {}; }; };
const mockSettings = { preferences: { voice: 'male', rate: 1 }, service: { configured: true }, profile: null,
  refresh: jest.fn(async () => {}), stop: jest.fn(), defaults: { male: 'Roger', female: 'Bella' } };
jest.mock('../../src/state/voice-settings', () => ({ useVoiceSettings: () => mockSettings }));
jest.mock('../../src/voice/voice-client', () => ({ VoiceClient: { speech: (...args: unknown[]) => mockCloud(...args) } }));
jest.mock('../../src/calls/meeting-audio-player', () => ({ MeetingAudioPlayer: class { play = mockPlay; dispose = mockDispose; } }));
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

describe('meeting text and sign speech', () => {
  let root: { render: (node: React.ReactNode) => void; unmount: () => void }; let container: HTMLDivElement;
  let voice: ReturnType<typeof useMeetingVoice>;
  let phase: CallPhase; let peer: 'ready' | 'unknown' | 'muted';
  const call = () => ({ ...initialCallState(), phase, peerSpeech: peer, channelReady: true,
    sendSpeech: mockSend, stopSpeech: mockStop, setSpeechEnabled: mockListen, subscribeSpeech: mockSubscribe });
  function Pilot() { voice = useMeetingVoice(call() as unknown as Parameters<typeof useMeetingVoice>[0]); return null; }
  const render = () => act(() => root.render(React.createElement(Pilot)));
  const file = () => ({ exists: true, bytes: jest.fn(async () => new Uint8Array([1, 2, 3])), delete: jest.fn() });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); jest.clearAllMocks();
    mockCloud.mockReset().mockImplementation(async () => file()); mockSettings.service.configured = true; phase = 'connected'; peer = 'ready';
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); render();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });
  it.each(['male', 'female'] as const)('sends %s AI audio to the guest and cleans up its synthesis file', async (choice) => {
    const sample = file(); mockCloud.mockResolvedValueOnce(sample);
    act(() => voice.chooseVoice(choice));
    await act(async () => { expect(voice.speak('I need help.')).toBe(true); await flush(); });
    expect(mockCloud).toHaveBeenCalledWith('I need help.', choice, 1, expect.anything());
    expect(mockSend).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'I need help.', 'typed', expect.anything());
    expect(sample.delete).toHaveBeenCalledTimes(1); expect(voice.notice).toMatch(/sent/);
  });
  it('speaks each reviewed word once when enabled and never speaks raw guesses', async () => {
    act(() => voice.speakReviewed('HELLO')); expect(mockCloud).not.toHaveBeenCalled();
    act(() => voice.setAutomatic(true));
    await act(async () => { voice.speakReviewed('HELLO'); voice.speakReviewed('FRIEND'); await flush(); });
    expect(mockCloud.mock.calls.map((args) => args[0])).toEqual(['HELLO', 'FRIEND']);
    expect(voice.speak('Unreviewed guess', 'ai')).toBe(false);
  });
  it('rejects speech while disconnected, for legacy/muted guests, or without online voices', () => {
    for (const value of ['unknown', 'muted'] as const) {
      peer = value; render(); act(() => { expect(voice.speak('Hello')).toBe(false); });
    }
    peer = 'ready'; phase = 'waiting'; render(); act(() => { expect(voice.speak('Hello')).toBe(false); });
    phase = 'connected'; mockSettings.service.configured = false; render(); act(() => { expect(voice.speak('Hello')).toBe(false); });
    expect(mockCloud).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled();
  });
  it('cancels generation on hang-up and deletes a late response without sending stale speech', async () => {
    let resolve!: (value: ReturnType<typeof file>) => void;
    mockCloud.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    act(() => { voice.speak('Cancelled message'); }); await act(flush);
    const signal = mockCloud.mock.calls[0][3] as AbortSignal;
    phase = 'ended'; render(); expect(signal.aborted).toBe(true);
    const sample = file(); await act(async () => { resolve(sample); await flush(); });
    expect(mockSend).not.toHaveBeenCalled(); expect(sample.delete).toHaveBeenCalledTimes(1);
  });
  it('keeps the call audio session available through a temporary reconnection', () => {
    mockDispose.mockClear(); phase = 'reconnecting'; render();
    expect(mockDispose).not.toHaveBeenCalled();
    phase = 'ended'; render(); expect(mockDispose).toHaveBeenCalledTimes(1);
  });
  it('receives and plays guest audio without using local provider credentials, and honors mute and Stop', async () => {
    const audio: MeetingAudio = { id: 1, text: 'Hello', kind: 'typed', bytes: new Uint8Array([1, 2]) };
    await act(async () => { mockIncoming(audio); await flush(); });
    expect(mockPlay).toHaveBeenCalledWith(audio.bytes, expect.anything(), expect.anything()); expect(mockCloud).not.toHaveBeenCalled();
    act(() => voice.setListen(false)); expect(mockListen).toHaveBeenLastCalledWith(false);
    await act(async () => { mockIncoming({ ...audio, id: 2 }); await flush(); }); expect(mockPlay).toHaveBeenCalledTimes(1);
    act(() => voice.stop()); expect(mockStop).toHaveBeenCalled();
  });
});
