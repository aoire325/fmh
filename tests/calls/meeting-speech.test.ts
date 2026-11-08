import { fromByteArray } from 'base64-js';
import { MeetingSpeechTransport, MAX_MEETING_AUDIO, type MeetingAudio } from '../../src/calls/meeting-speech';

function pair() {
  const leftAudio: (MeetingAudio | null)[] = []; const rightAudio: (MeetingAudio | null)[] = [];
  const leftWire = { readyState: 'open', bufferedAmount: 0, send: jest.fn((raw: string) => { right.receive(raw); }) };
  const rightWire = { readyState: 'open', bufferedAmount: 0, send: jest.fn((raw: string) => { left.receive(raw); }) };
  const left = new MeetingSpeechTransport(leftWire, jest.fn(), (audio) => leftAudio.push(audio));
  const right = new MeetingSpeechTransport(rightWire, jest.fn(), (audio) => rightAudio.push(audio));
  left.advertise(); right.advertise();
  return { left, right, leftWire, rightWire, leftAudio, rightAudio };
}
describe('private meeting audio transport', () => {
  it('sends distinct audio to the other participant in bounded chunks without sharing a voice credential', async () => {
    const t = pair(); const audio = Uint8Array.from({ length: 10123 }, (_, index) => index % 256);
    await t.left.sendAudio(audio, 'I need help.', 'typed', new AbortController().signal);
    expect(t.rightAudio).toEqual([{ id: 1, text: 'I need help.', kind: 'typed', bytes: audio }]);
    expect(t.leftWire.send.mock.calls.every(([raw]) => raw.length < 8192)).toBe(true);
    expect(t.leftWire.send.mock.calls.map(([raw]) => raw).join('')).not.toMatch(/voice_id|Authorization|xi-api-key/);
    await t.right.sendAudio(new Uint8Array([1, 2, 3]), 'Yes.', 'reviewed', new AbortController().signal);
    expect(t.leftAudio[0]?.text).toBe('Yes.');
  });
  it('honors the guest playback switch and propagates Stop', async () => {
    const t = pair(); t.right.setEnabled(false); expect(t.left.peer).toBe('muted');
    await expect(t.left.sendAudio(new Uint8Array([1]), 'Hi', 'typed', new AbortController().signal)).rejects.toThrow(/turned off/);
    t.right.setEnabled(true); expect(t.left.peer).toBe('ready');
    t.left.stopSending(); expect(t.rightAudio.at(-1)).toBeNull();
  });
  it('answers the first capability announcement so an early lost handshake recovers', () => {
    const wire = { readyState: 'open', bufferedAmount: 0, send: jest.fn() };
    const transport = new MeetingSpeechTransport(wire, jest.fn(), jest.fn());
    const announcement = JSON.stringify({ type: 'speech-support', version: 1, enabled: true });
    transport.receive(announcement); transport.receive(announcement);
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(wire.send).toHaveBeenCalledWith(announcement);
  });
  it('rejects invalid, replayed, unfinished, or out-of-order audio without calling the player', async () => {
    const t = pair(); const receive = (value: object) => t.right.receive(JSON.stringify(value));
    for (const value of [{ type: 'speech-end' }, { type: 'speech-chunk' },
      { type: 'speech-start', id: 1, size: MAX_MEETING_AUDIO + 1, text: 'Hi', kind: 'typed' },
      { type: 'speech-start', id: 1, size: 3, text: 'Hi', kind: 'ai' }]) receive(value);
    expect(t.rightAudio).toEqual([]);
    receive({ type: 'speech-start', id: 1, size: 3, text: 'Hi', kind: 'typed' });
    receive({ type: 'speech-chunk', id: 1, index: 1, data: 'AQID' }); receive({ type: 'speech-end', id: 1 });
    expect(t.rightAudio).toEqual([]);
    receive({ type: 'speech-start', id: 1, size: 3, text: 'Replay', kind: 'typed' });
    receive({ type: 'speech-chunk', id: 1, index: 0, data: 'AQID' }); receive({ type: 'speech-end', id: 1 });
    expect(t.rightAudio).toEqual([]);
    receive({ type: 'speech-start', id: 2, size: 3, text: 'Invalid', kind: 'typed' });
    receive({ type: 'speech-chunk', id: 2, index: 0, data: '***=' }); receive({ type: 'speech-end', id: 2 });
    receive({ type: 'speech-start', id: 3, size: 3, text: 'Incomplete', kind: 'typed' }); receive({ type: 'speech-end', id: 3 });
    expect(t.rightAudio).toEqual([]);
    await t.left.sendAudio(new Uint8Array([1]), 'One', 'typed', new AbortController().signal); // Receiver rejects old id 1.
    expect(t.rightAudio).toEqual([]);
  });
  it('bounds per-chunk memory overhead and discards expired transfers', () => {
    let now = 0; const output = jest.fn();
    const transport = new MeetingSpeechTransport({ readyState: 'open', bufferedAmount: 0, send() {} }, jest.fn(), output, () => now);
    const receive = (value: object) => transport.receive(JSON.stringify(value));
    receive({ type: 'speech-start', id: 1, size: 5000, text: 'Hi', kind: 'typed' });
    receive({ type: 'speech-chunk', id: 1, index: 0, data: 'AQ==' }); receive({ type: 'speech-end', id: 1 });
    expect(output).not.toHaveBeenCalled();
    receive({ type: 'speech-start', id: 2, size: 3, text: 'Hi', kind: 'typed' }); now = 16000;
    receive({ type: 'speech-chunk', id: 2, index: 0, data: 'AQID' }); receive({ type: 'speech-end', id: 2 });
    expect(output).not.toHaveBeenCalled();
  });
  it('cancels a blocked transfer on Stop or hang-up without sending a late utterance', async () => {
    const t = pair(); t.leftWire.bufferedAmount = 40000;
    const controller = new AbortController();
    const sending = t.left.sendAudio(new Uint8Array([1, 2]), 'Hi', 'typed', controller.signal);
    controller.abort(); await expect(sending).rejects.toThrow(/stopped/);
    expect(t.rightAudio.filter(Boolean)).toEqual([]);
    t.leftWire.bufferedAmount = 0;
    const second = t.left.sendAudio(new Uint8Array(7000), 'Another', 'typed', new AbortController().signal);
    t.left.dispose(); t.leftWire.readyState = 'closed'; await expect(second).rejects.toThrow(/stopped/);
    expect(t.rightAudio.filter(Boolean)).toEqual([]);
  });
  it('does not send unreviewed guesses or speech to legacy clients', async () => {
    const t = pair();
    await expect(t.left.sendAudio(new Uint8Array([1]), 'Guess', 'ai', new AbortController().signal)).rejects.toThrow(/reviewed/);
    const unknown = new MeetingSpeechTransport(t.leftWire, jest.fn(), jest.fn());
    await expect(unknown.sendAudio(new Uint8Array([1]), 'Hi', 'typed', new AbortController().signal)).rejects.toThrow(/updated/);
    expect(t.right.receive(JSON.stringify({ type: 'caption', sequence: 1, text: 'Hello', kind: 'typed' }))).toBe(false);
    expect(t.right.receive('invalid')).toBe(false);
    expect(t.right.receive(JSON.stringify({ type: 'speech-chunk', id: 1, index: 0, data: fromByteArray(new Uint8Array(7000)) }))).toBe(false);
  });
});
