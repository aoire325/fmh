import React, { act, type ReactNode } from 'react';
import CallScreen from '../../src/app/call';
import { initialCallState } from '../../src/calls/call-session';
import { createInvite } from '../../src/calls/protocol';
import * as Clipboard from 'expo-clipboard';

const { JSDOM } = jest.requireActual('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const originalWindow = globalThis.window;
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { createRoot } = jest.requireActual('react-dom/client');
const mockActions = { start: jest.fn(), end: jest.fn(), toggleCamera: jest.fn(), toggleMicrophone: jest.fn(), switchCamera: jest.fn(),
  setCaptions: jest.fn(), sendCaption: jest.fn(() => true) };
const mockMeetingSpeak = jest.fn(() => true);
jest.mock('../../src/calls/use-meeting-voice', () => ({ useMeetingVoice: () => ({
  voice: 'male', chooseVoice: jest.fn(), automatic: false, setAutomatic: jest.fn(), listen: true, setListen: jest.fn(),
  speak: mockMeetingSpeak, speakReviewed: jest.fn(), stop: jest.fn(), canSpeak: true, connected: true, peerSpeech: 'ready',
  outgoing: { phase: 'idle' }, incoming: { phase: 'idle' }, notice: '',
  settings: { service: { configured: true }, defaults: { male: 'Roger', female: 'Bella' }, profile: null },
}) }));
let mockState = initialCallState();
let mockComposerMounts = 0;
let mockComposerCleanups = 0;
let mockFontScale = 1;
let mockParams: { code?: string; service?: string } = {};
jest.mock('../../src/calls/use-video-call', () => ({ useVideoCall: () => ({ ...mockState, ...mockActions }) }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-symbols', () => ({ SymbolView: () => jest.requireActual('react').createElement('span', { 'data-symbol': true }) }));
jest.mock('../../src/state/accessibility-settings', () => ({ useAccessibilitySettings: () => ({ largeText: false, highContrast: false }) }));
jest.mock('../../src/calls/native-webrtc', () => ({ getWebRTC: () => ({ RTCView: ({ streamURL }: { streamURL: string }) =>
  jest.requireActual('react').createElement('div', { 'data-stream': streamURL }) }) }));
jest.mock('../../src/components/call-caption-composer', () => ({ CallCaptionComposer: ({ compact }: { compact: boolean }) => {
  const React = jest.requireActual('react');
  React.useEffect(() => { mockComposerMounts++; return () => { mockComposerCleanups++; }; }, []);
  return React.createElement('div', { 'data-composer': compact ? 'compact' : 'full' });
} }));
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  const container = ({ children }: { children?: ReactNode }) => React.createElement('div', null, children);
  return { View: container, Text: container, KeyboardAvoidingView: container, Platform: { OS: 'android' },
    Modal: ({ visible, children }: { visible: boolean; children?: ReactNode }) => visible ? React.createElement('div', null, children) : null,
    Keyboard: { dismiss: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: mockFontScale }),
    ScrollView: ({ children, scrollEnabled = true }: { children?: ReactNode; scrollEnabled?: boolean }) =>
      React.createElement('div', { 'data-scroll-enabled': String(scrollEnabled) }, children),
    TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (value: string) => void; accessibilityLabel: string }) =>
      React.createElement('input', { 'aria-label': accessibilityLabel, value, onChange: () => {}, onInput: (event: { currentTarget: HTMLInputElement }) => onChangeText(event.currentTarget.value) }),
    Switch: ({ accessibilityLabel, value, onValueChange }: { accessibilityLabel: string; value: boolean; onValueChange: (value: boolean) => void }) =>
      React.createElement('button', { 'aria-label': accessibilityLabel, onClick: () => onValueChange(!value) }, String(value)),
    Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityState }: { children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityState?: { selected?: boolean } }) =>
      React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected }, children) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => jest.requireActual('react').createElement('div', null, children) }));

describe('focus call controls', () => {
  let root: { render: (node: ReactNode) => void; unmount: () => void };
  let container: HTMLDivElement;
  const render = () => act(() => root.render(React.createElement(CallScreen)));
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = (label: string) => act(() => { const target = button(label); if (!target) throw new Error(`Missing ${label}`); target.click(); });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); jest.clearAllMocks();
    mockComposerMounts = 0; mockComposerCleanups = 0; mockFontScale = 1; mockParams = {};
    mockState = { ...initialCallState(), phase: 'connected', peerName: 'Alex', channelReady: true, captions: true,
      localStream: { toURL: () => 'local-video' } as NonNullable<typeof mockState.localStream>,
      remoteStream: { toURL: () => 'guest-video' } as NonNullable<typeof mockState.remoteStream>,
      remoteCaption: { type: 'caption', sequence: 1, kind: 'typed', text: 'Good to see you' } };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); render();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  afterAll(() => { dom.window.close(); Object.assign(globalThis, { window: originalWindow }); });

  it('shows video and caption with icon-only controls and hides the full-page forms', () => {
    click('Focus call');
    for (const label of ['Turn on mic', 'Camera off', 'Flip camera', 'Turn off AI sign captions', 'End call']) {
      expect(button(label)).not.toBeNull(); expect(button(label)!.textContent).toBe('');
      expect(button(label)!.querySelector('[data-symbol]')).not.toBeNull();
    }
    expect(container.querySelector('[data-stream="guest-video"]')).not.toBeNull(); expect(container.textContent).toContain('Good to see you');
    expect(container.querySelector('[aria-label="Type a caption"]')).toBeNull(); expect(container.textContent).not.toContain('Say it with text');
    expect(container.querySelector('[data-composer="compact"]')).not.toBeNull();
    for (const text of ['TYPED CAPTION', 'CAPTIONS', 'Their shared words will appear here.', 'Your shared words will appear here.', 'Mic on', 'Muted', 'Alex']) {
      expect(container.textContent).not.toContain(text);
    }
  });
  it('keeps unreviewed AI captions identified while removing routine caption labels', () => {
    mockState.remoteCaption = { type: 'caption', sequence: 1, kind: 'ai', text: 'Hello there' }; render(); click('Focus call');
    expect(container.textContent).toContain('Hello there'); expect(container.textContent).toContain('AI · UNREVIEWED');
    click('Exit focus view'); expect(container.textContent).toContain('AI GUESS · UNREVIEWED');
  });
  it('lets a caller type and speak to the guest without enabling the microphone', () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Type a caption"]')!;
    expect(button('Speak to meeting')!.disabled).toBe(true);
    expect(container.textContent).toContain('Type a message to enable Speak to meeting');
    act(() => { input.value = 'I need some water.'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    expect(button('Speak to meeting')!.disabled).toBe(false);
    click('Speak to meeting');
    expect(mockMeetingSpeak).toHaveBeenCalledWith('I need some water.');
    expect(mockActions.sendCaption).toHaveBeenCalledWith('I need some water.', 'typed');
    expect(mockActions.toggleMicrophone).not.toHaveBeenCalled();
  });
  it('retains the typed message without starting speech when the call cannot send its caption', () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Type a caption"]')!;
    act(() => { input.value = 'Please wait.'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    mockActions.sendCaption.mockReturnValueOnce(false); click('Speak to meeting');
    expect(mockMeetingSpeak).not.toHaveBeenCalled(); expect(input.value).toBe('Please wait.');
    expect(container.textContent).toContain('Message could not be sent');
  });
  it('keeps typed speech accessible in focus view without ending the meeting', () => {
    click('Focus call'); click('Meeting voice and typed speech');
    expect(container.querySelector('[aria-label="Type a caption"]')).not.toBeNull();
    expect(button('Speak to meeting')).not.toBeNull(); click('Close meeting voice');
    expect(container.querySelector('[aria-label="Type a caption"]')).toBeNull(); expect(mockActions.end).not.toHaveBeenCalled();
  });
  it('wires mic, camera, flip, AI, and hang-up to the existing call', () => {
    click('Focus call'); click('Turn on mic'); click('Camera off'); click('Flip camera'); click('Turn off AI sign captions'); click('End call');
    expect(mockActions.toggleMicrophone).toHaveBeenCalledTimes(1); expect(mockActions.toggleCamera).toHaveBeenCalledTimes(1);
    expect(mockActions.switchCamera).toHaveBeenCalledTimes(1); expect(mockActions.setCaptions).toHaveBeenCalledWith(false); expect(mockActions.end).toHaveBeenCalledTimes(1);
  });
  it('keeps caption recognition mounted when entering and leaving focus', () => {
    expect(mockComposerMounts).toBe(1); click('Focus call'); click('Exit focus view');
    expect(mockComposerMounts).toBe(1); expect(mockComposerCleanups).toBe(0);
    expect(mockActions.end).not.toHaveBeenCalled(); expect(mockActions.start).not.toHaveBeenCalled();
    expect(container.querySelector('[data-composer="full"]')).not.toBeNull();
  });
  it('disables camera flipping while the camera is off and reflects muted states', () => {
    mockState.camera = false; mockState.microphone = true; render(); click('Focus call');
    expect(button('Flip camera')!.disabled).toBe(true); expect(button('Camera on')).not.toBeNull(); expect(button('Mute mic')!.getAttribute('aria-pressed')).toBe('true');
  });
  it('enlarges each video without changing the call session', () => {
    click('Focus call'); click('Enlarge guest video'); expect(container.querySelector('[data-stream="local-video"]')).toBeNull();
    click('Enlarge my video'); expect(container.querySelector('[data-stream="guest-video"]')).toBeNull();
    click('Show both videos'); expect(container.querySelectorAll('[data-stream]').length).toBe(2); expect(mockActions.end).not.toHaveBeenCalled();
  });
  it('offers focus before joining and returns to the lobby after hang-up', () => {
    mockState.phase = 'idle'; mockState.localStream = null; render(); click('Start in focus call view');
    mockState.phase = 'waiting'; mockState.code = 'ABCDEFGHJKLM'; render(); expect(button('Exit focus view')).not.toBeNull(); expect(button('Copy private call invite')).not.toBeNull();
    mockState.phase = 'ended'; render(); expect(button('Exit focus view')).toBeNull(); expect(button('Start a new call')).not.toBeNull();
  });
  it('allows scrolling for large system text so controls stay reachable', () => {
    mockFontScale = 1.8; render(); click('Focus call'); expect(container.querySelector('[data-scroll-enabled="true"]')).not.toBeNull();
    expect(button('End call')!.closest('[data-scroll-enabled]')).toBeNull();
  });
  it('copies the host’s actual call-service address with the code', async () => {
    mockState.phase = 'waiting'; mockState.code = 'ABCDEFGHJKLM'; mockState.serviceUrl = 'wss://host-calls.example.com/calls'; render();
    await act(async () => button('Copy invite')!.click());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(createInvite(mockState.code, mockState.serviceUrl));
  });
  it('copies a reachable LAN invite when the host is connected over Android USB', async () => {
    mockState.phase = 'waiting'; mockState.code = 'ABCDEFGHJKLM'; mockState.serviceUrl = 'ws://127.0.0.1:8787/calls';
    mockState.inviteServiceUrl = 'ws://192.168.1.10:8787/calls'; render();
    await act(async () => button('Copy invite')!.click());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(createInvite(mockState.code, mockState.inviteServiceUrl));
  });
  it('prefills a complete invite when opened from a shared link and waits for Join', () => {
    mockState.phase = 'idle'; mockState.localStream = null;
    mockParams = { code: 'ABCDEFGHJKLM', service: 'wss://host-calls.example.com/calls' }; render();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Call invite code"]')!.value).toBe(createInvite(mockParams.code!, mockParams.service!));
    expect(mockActions.start).not.toHaveBeenCalled();
  });
  it('prefills a plain code from the homepage and waits for Join', () => {
    mockState.phase = 'idle'; mockState.localStream = null;
    mockParams = { code: 'ABCDEFGHJKLM' }; render();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Call invite code"]')!.value).toBe('ABCDEFGHJKLM');
    expect(mockActions.start).not.toHaveBeenCalled();
  });
});
