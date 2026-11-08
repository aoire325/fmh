export type ScheduledMeeting = { id: string; title: string; startsAt: string };

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function weekDays(selected: Date): Date[] {
  const start = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 12);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start); date.setDate(date.getDate() + offset); return date;
  });
}

export function meetingTime(day: Date, time: string, now = new Date()): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a time in 24-hour format, such as 14:30.');
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  if (date.getHours() !== hours || date.getMinutes() !== minutes) throw new Error('That time is unavailable on this date. Choose another time.');
  if (date <= now) throw new Error('Choose a date and time in the future.');
  return date;
}

export function parseMeetings(raw: string): ScheduledMeeting[] {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 1000 || !values.every((v) => v && typeof v.id === 'string'
    && typeof v.title === 'string' && v.title.length <= 80 && typeof v.startsAt === 'string'
    && Number.isFinite(Date.parse(v.startsAt)))) throw new Error('The saved calendar could not be read.');
  return values as ScheduledMeeting[];
}
