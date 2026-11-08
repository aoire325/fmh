import { readVoicePreferences, videoMimeType, voiceServiceUrl } from '../../src/voice/types';

describe('voice settings and service selection', () => {
  it('keeps device speech usable without credentials and validates stored preferences', () => {
    expect(readVoicePreferences(null)).toEqual({ voice: 'device', autoSpeak: false, rate: 1 });
    expect(readVoicePreferences({ voice: 'personal', autoSpeak: true, rate: 0.8 })).toEqual({ voice: 'personal', autoSpeak: true, rate: 0.8 });
    expect(readVoicePreferences({ voice: 'other', autoSpeak: 'true', rate: NaN })).toEqual({ voice: 'device', autoSpeak: false, rate: 1 });
  });
  it('discovers the same local service as calls and uses its secure origin in production', () => {
    expect(voiceServiceUrl(undefined, undefined, true, '192.168.1.5:8081')).toBe('http://192.168.1.5:8787');
    expect(voiceServiceUrl(undefined, undefined, true, 'localhost:8081')).toBe('http://127.0.0.1:8787');
    expect(voiceServiceUrl(undefined, 'wss://calls.example.com/calls', false)).toBe('https://calls.example.com');
    expect(voiceServiceUrl('https://voice.example.com/', 'wss://other.example.com/calls', false)).toBe('https://voice.example.com');
  });
  it('rejects plaintext production, embedded credentials, URL parameters, and remote Metro hosts', () => {
    for (const value of ['http://voice.example.com', 'https://user:password@voice.example.com', 'https://voice.example.com/voice', 'https://voice.example.com?key=private']) {
      expect(() => voiceServiceUrl(value, undefined, false)).toThrow();
    }
    expect(() => voiceServiceUrl(undefined, undefined, true, 'untrusted.example.com:8081')).toThrow();
    expect(() => voiceServiceUrl(undefined, undefined, false, '192.168.1.5:8081')).toThrow();
  });
  it('recovers common video MIME types when the file picker only supplies a filename', () => {
    expect(videoMimeType('archive.MOV', 'application/octet-stream')).toBe('video/quicktime');
    expect(videoMimeType('me.mp4')).toBe('video/mp4');
    expect(videoMimeType('sample.txt')).toBeUndefined();
  });
});
