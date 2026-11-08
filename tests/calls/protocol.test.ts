import { createInvite, displayInvite, normalizeInvite, parseCallMessage, parseInvite, resolveCallTarget, signalingUrl, validInvite } from '../../src/calls/protocol';

describe('call messages and invitations', () => {
  it('accepts formatted codes and rejects ambiguous or short codes', () => {
    expect(normalizeInvite('abcd - efgh - jklm')).toBe('ABCDEFGHJKLM');
    expect(validInvite('abcd - efgh - jklm')).toBe(true);
    expect(normalizeInvite('abcd\u00a0–\u00a0efgh\u00a0–\u00a0jklm')).toBe('ABCDEFGHJKLM');
    expect(displayInvite('ABCDEFGHJKLM')).toBe('ABCD - EFGH - JKLM');
    for (const code of ['123456', 'ABCDEFGHIJKL', 'AAAA0000AAAA', '', 'A'.repeat(13)]) expect(validInvite(code)).toBe(false);
  });
  it('bounds untrusted captions and preserves their provenance', () => {
    expect(parseCallMessage(JSON.stringify({ type: 'caption', sequence: 1, text: ' HELLO\nFRIEND ', kind: 'ai' })))
      .toEqual({ type: 'caption', sequence: 1, text: 'HELLO FRIEND', kind: 'ai' });
    for (const value of [{ type: 'caption', sequence: -1, text: 'hi', kind: 'typed' },
      { type: 'caption', sequence: 1, text: 'a'.repeat(281), kind: 'typed' },
      { type: 'caption', sequence: 1, text: 'hi', kind: 'verified' }, { type: 'media', camera: 'true' }]) {
      expect(parseCallMessage(JSON.stringify(value))).toBeNull();
    }
    expect(parseCallMessage('not json')).toBeNull();
    expect(parseCallMessage(new ArrayBuffer(3))).toBeNull();
  });
  it('allows clearing a caption and validates media states', () => {
    expect(parseCallMessage('{"type":"caption","sequence":2,"text":"","kind":"typed"}')?.type).toBe('caption');
    expect(parseCallMessage('{"type":"media","camera":false,"microphone":true,"captions":false}'))
      .toEqual({ type: 'media', camera: false, microphone: true, captions: false });
  });
  it('requires secure signaling in packaged builds', () => {
    expect(signalingUrl('wss://calls.example.com/calls', false)).toBe('wss://calls.example.com/calls');
    expect(signalingUrl('ws://192.168.1.2:8787/calls', true)).toContain('ws:');
    for (const url of [undefined, 'ws://host/calls', 'https://host/calls', 'wss://user:pass@host/calls', 'wss://host/calls?secret=x']) {
      expect(() => signalingUrl(url, false)).toThrow();
    }
  });
  it('finds the shared call service when a development bundle has no environment setting', () => {
    expect(signalingUrl(undefined, true, '10.67.169.106:8081')).toBe('ws://10.67.169.106:8081/_expo/plugins/signbridge-tracker/calls');
    expect(signalingUrl('', true, '192.168.1.10:8082')).toBe('ws://192.168.1.10:8082/_expo/plugins/signbridge-tracker/calls');
    expect(signalingUrl('  ', true, '172.20.10.2:8081')).toBe('ws://172.20.10.2:8081/_expo/plugins/signbridge-tracker/calls');
    expect(signalingUrl(undefined, true, 'macbook.local:8081')).toBe('ws://macbook.local:8081/_expo/plugins/signbridge-tracker/calls');
  });
  it('supports USB forwarding and the iOS simulator without changing the other phone’s address', () => {
    expect(signalingUrl(undefined, true, '127.0.0.1:8081')).toBe('ws://127.0.0.1:8081/_expo/plugins/signbridge-tracker/calls');
    expect(signalingUrl(undefined, true, '[::1]:8082')).toBe('ws://127.0.0.1:8082/_expo/plugins/signbridge-tracker/calls');
  });
  it('always honors an explicitly configured shared service', () => {
    expect(signalingUrl(' wss://calls.example.com/calls ', true, '127.0.0.1:8081')).toBe('wss://calls.example.com/calls');
    expect(() => signalingUrl('https://wrong.example.com', true, '192.168.1.10:8081')).toThrow();
  });
  it('never invents a production or tunnel call service', () => {
    expect(() => signalingUrl(undefined, false, '192.168.1.10:8081')).toThrow('updated build');
    for (const host of [undefined, '', 'not a host', 'project.exp.direct:80', 'user:pass@192.168.1.10:8081', '192.168.1.10:8081/path']) {
      expect(() => signalingUrl(undefined, true, host)).toThrow('same computer');
    }
  });
  it('routes a copied invite to the host’s service even when the guest has a different default', () => {
    const link = createInvite('abcd - efgh - jklm', 'wss://host-calls.example.com/calls');
    expect(parseInvite(link)).toEqual({ code: 'ABCDEFGHJKLM', serviceUrl: 'wss://host-calls.example.com/calls' });
    expect(resolveCallTarget(link, 'wss://wrong-server.example.com/calls', false))
      .toEqual({ url: 'wss://host-calls.example.com/calls', code: 'ABCDEFGHJKLM' });
    expect(resolveCallTarget(link, undefined, false)).toEqual({ url: 'wss://host-calls.example.com/calls', code: 'ABCDEFGHJKLM' });
  });
  it('keeps manually entered codes and creating calls on the configured shared service', () => {
    expect(resolveCallTarget('abcd – efgh – jklm', 'wss://calls.example.com/calls', false))
      .toEqual({ url: 'wss://calls.example.com/calls', code: 'ABCDEFGHJKLM' });
    expect(resolveCallTarget(undefined, 'wss://calls.example.com/calls', false))
      .toEqual({ url: 'wss://calls.example.com/calls', code: undefined });
    expect(() => resolveCallTarget('', 'wss://calls.example.com/calls', false)).toThrow('complete invite');
  });
  it('accepts LAN invites during development and still enforces secure release connections', () => {
    const link = createInvite('ABCDEFGHJKLM', 'ws://192.168.1.10:8787/calls');
    expect(resolveCallTarget(link, undefined, true).url).toBe('ws://192.168.1.10:8787/calls');
    expect(() => resolveCallTarget(link, undefined, false)).toThrow('secure');
  });
  it('rejects malformed invite links instead of silently falling back to the wrong server', () => {
    const link = createInvite('ABCDEFGHJKLM', 'wss://calls.example.com/calls');
    for (const invalid of [link + '&code=PPPPPPPPPPPP', link + '#fragment', link.replace('signbridge:', 'https:'),
      link.replace('wss%3A', 'https%3A'), link.replace('ABCDEFGHJKLM', 'short'), 'x'.repeat(2049)]) {
      expect(parseInvite(invalid)).toBeNull();
      expect(() => resolveCallTarget(invalid, 'wss://default.example.com/calls', false)).toThrow();
    }
  });
});
