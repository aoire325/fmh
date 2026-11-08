import { dayKey, meetingTime, parseMeetings, weekDays } from '../../src/calls/meeting-schedule';

it('shows a Monday-to-Sunday week across month and year boundaries', () => {
  expect(weekDays(new Date(2027, 0, 1)).map(dayKey)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});
it('stores local calendar times and refuses past or malformed times', () => {
  const day = new Date(2030, 4, 2), now = new Date(2030, 4, 1);
  const date = meetingTime(day, '14:30', now);
  expect(dayKey(date)).toBe('2030-05-02'); expect(date.getHours()).toBe(14); expect(date.getMinutes()).toBe(30);
  for (const time of ['25:00', '9:30', '14:65', 'bad']) expect(() => meetingTime(day, time, now)).toThrow();
  expect(() => meetingTime(now, '00:00', day)).toThrow('future');
});
it('rejects corrupted calendar records instead of silently overwriting them', () => {
  expect(parseMeetings('[]')).toEqual([]);
  expect(() => parseMeetings('{"meetings":[]}')).toThrow();
  expect(() => parseMeetings('[{"id":"1","title":"Call","startsAt":"invalid"}]')).toThrow();
});
