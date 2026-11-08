import type { SpeechOptions } from 'expo-speech';
import { playSpeech } from '../../src/voice/play-speech';
import type { VoicePreferences } from '../../src/voice/types';

const mockMode = jest.fn(() => Promise.resolve());
const mockSupport = jest.fn();
const mockCloud = jest.fn();
const mockDeviceSpeak = jest.fn((_text: string, _options?: SpeechOptions) => {});
const mockDeviceStop = jest.fn(() => Promise.resolve());
let mockStatus: (status: { error?: string; didJustFinish?: boolean; playing?: boolean }) => void;
const mockListenerRemove = jest.fn();
const mockPlayer = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(),
  addListener: jest.fn((_event: string, listener: typeof mockStatus) => { mockStatus = listener; return { remove: mockListenerRemove }; }) };
const mockCreatePlayer = jest.fn((..._args: unknown[]) => mockPlayer);
jest.mock('../../src/voice/native-support', () => ({ requireVoiceNativeSupport: (...names: string[]) => mockSupport(...names) }));
jest.mock('../../src/voice/voice-client', () => ({ VoiceClient: { speech: (...args: unknown[]) => mockCloud(...args) } }));
jest.mock('expo-audio', () => ({ createAudioPlayer: (...args: unknown[]) => mockCreatePlayer(...args), setAudioModeAsync: () => mockMode() }));
jest.mock('expo-speech', () => ({ speak: (text: string, options: SpeechOptions) => mockDeviceSpeak(text, options), stop: () => mockDeviceStop() }));

const settle = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); };
const options = (voice: VoicePreferences['voice']): VoicePreferences => ({ voice, rate: 1, autoSpeak: false });
describe('native speech playback lifecycle', () => {
  beforeEach(() => { jest.clearAllMocks(); mockSupport.mockReset(); mockMode.mockReset().mockResolvedValue(); mockCloud.mockReset(); });

  it('uses device speech without sending text to the cloud and finishes from the native callback', async () => {
    const speaking = jest.fn();
    const pending = playSpeech({ text: 'Please help me.', options: options('device') }, new AbortController().signal, speaking);
    await settle();
    expect(mockDeviceSpeak).toHaveBeenCalledWith('Please help me.', expect.objectContaining({ rate: 1, language: 'en-US' }));
    const callbacks = mockDeviceSpeak.mock.calls[0][1]!;
    callbacks.onStart?.(); expect(speaking).toHaveBeenCalledTimes(1);
    callbacks.onDone?.(); await pending;
    expect(mockCloud).not.toHaveBeenCalled(); expect(mockCreatePlayer).not.toHaveBeenCalled();
  });
  it('stops device speech promptly on cancellation', async () => {
    const controller = new AbortController();
    const pending = playSpeech({ text: 'A sentence', options: options('device') }, controller.signal, jest.fn());
    await settle(); controller.abort(); await pending;
    expect(mockDeviceStop).toHaveBeenCalledTimes(1);
  });
  it('never starts device speech if cancelled while the audio session is preparing', async () => {
    let ready!: () => void;
    mockMode.mockImplementationOnce(() => new Promise<void>((resolve) => { ready = resolve; }));
    const controller = new AbortController();
    const pending = playSpeech({ text: 'Stale text', options: options('device') }, controller.signal, jest.fn());
    await settle(); controller.abort(); ready(); await pending;
    expect(mockDeviceSpeak).not.toHaveBeenCalled();
  });
  it('plays generated audio and releases the player, listener, and temporary file', async () => {
    const file = { uri: 'file:///cache/speech.mp3', exists: true, delete: jest.fn() }; mockCloud.mockResolvedValue(file);
    const speaking = jest.fn();
    const pending = playSpeech({ text: 'Hello', options: options('female') }, new AbortController().signal, speaking);
    await settle();
    expect(mockCloud).toHaveBeenCalledWith('Hello', 'female', 1, expect.anything()); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    mockStatus({ playing: true }); expect(speaking).toHaveBeenCalledTimes(1);
    mockStatus({ didJustFinish: true }); await pending;
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1); expect(mockListenerRemove).toHaveBeenCalledTimes(1); expect(file.delete).toHaveBeenCalledTimes(1);
  });
  it('deletes a late cloud response after Stop without ever starting playback', async () => {
    let complete!: (file: unknown) => void;
    mockCloud.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const controller = new AbortController(); const file = { uri: 'file:///cache/late.mp3', exists: true, delete: jest.fn() };
    const pending = playSpeech({ text: 'Cancelled', options: options('personal') }, controller.signal, jest.fn());
    await settle(); controller.abort(); complete(file); await pending;
    expect(mockCloud.mock.calls[0][3].aborted).toBe(true); expect(mockCreatePlayer).not.toHaveBeenCalled(); expect(file.delete).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'playback error'])('cleans up generated audio after %s', async (action) => {
    const file = { uri: 'file:///cache/speech.mp3', exists: true, delete: jest.fn() }; mockCloud.mockResolvedValue(file);
    const controller = new AbortController();
    const pending = playSpeech({ text: 'A sentence', options: options('male') }, controller.signal, jest.fn());
    await settle();
    if (action === 'cancel') { controller.abort(); await pending; expect(mockPlayer.pause).toHaveBeenCalledTimes(1); }
    else { mockStatus({ error: 'Decoder failed' }); await expect(pending).rejects.toThrow(/could not play/); }
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1); expect(file.delete).toHaveBeenCalledTimes(1);
  });
  it('reports missing native modules as a rebuild requirement before requesting speech', async () => {
    mockSupport.mockImplementationOnce(() => { throw new Error('Rebuild and reopen TalkBridge.'); });
    await expect(playSpeech({ text: 'Hello', options: options('male') }, new AbortController().signal, jest.fn())).rejects.toThrow(/Rebuild/);
    expect(mockCloud).not.toHaveBeenCalled(); expect(mockDeviceSpeak).not.toHaveBeenCalled();
  });
});
