import { MeetingAudioPlayer } from '../../src/calls/meeting-audio-player';

let mockStatus: (value: { error?: string; didJustFinish?: boolean; playing?: boolean }) => void;
const mockFiles: { delete: jest.Mock; writeSync: jest.Mock }[] = [];
const mockPlayer = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), replace: jest.fn(),
  addListener: jest.fn((_event: string, listener: typeof mockStatus) => { mockStatus = listener; return { remove: jest.fn() }; }) };
const mockCreate = jest.fn((..._args: unknown[]) => mockPlayer); const mockMode = jest.fn();
jest.mock('../../src/voice/native-support', () => ({ requireVoiceNativeSupport: jest.fn() }));
jest.mock('expo-audio', () => ({ createAudioPlayer: (...args: unknown[]) => mockCreate(...args), setAudioModeAsync: (...args: unknown[]) => mockMode(...args) }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class {
  exists = true; uri = 'file:///cache/meeting.mp3'; delete = jest.fn(); writeSync = jest.fn();
  constructor() { mockFiles.push(this); }
} }));
describe('meeting audio alongside live call audio', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFiles.length = 0; });
  it('retains the audio session between messages without changing the WebRTC microphone category', async () => {
    const player = new MeetingAudioPlayer();
    for (let index = 0; index < 2; index++) {
      const pending = player.play(new Uint8Array([1, 2, 3]), new AbortController().signal, jest.fn());
      mockStatus({ playing: true }); mockStatus({ didJustFinish: true }); await pending;
    }
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(null, expect.objectContaining({ keepAudioSessionActive: true }));
    expect(mockMode).not.toHaveBeenCalled(); expect(mockPlayer.remove).not.toHaveBeenCalled();
    expect(mockFiles.every((file) => file.delete.mock.calls.length === 1)).toBe(true);
    player.dispose(); expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });
  it('stops playback and deletes transient audio when the meeting ends', async () => {
    const player = new MeetingAudioPlayer();
    const pending = player.play(new Uint8Array([1]), new AbortController().signal, jest.fn());
    player.dispose(); await pending;
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1); expect(mockFiles[0].delete).toHaveBeenCalledTimes(1);
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });
});
