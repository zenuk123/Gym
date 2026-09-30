// Reminders — shared by the app (settings UI, on-device notifications in the native app) and the
// `push` Edge Function (Web Push for the installed PWA). Pure, no imports.

export type ReminderId = 'weigh-in' | 'workout' | 'food' | 'review';

export interface Reminder {
  id: ReminderId;
  enabled: boolean;
  /** Local "HH:MM". */
  time: string;
  /** Weekdays it fires on, 0 = Sunday … 6 = Saturday. */
  days: number[];
}

export const REMINDER_TEXT: Record<ReminderId, { label: string; title: string; body: string; url: string }> = {
  'weigh-in': { label: 'Morning weigh-in', title: 'Morning weigh-in', body: 'Step on the scale before breakfast — it keeps your trend honest.', url: '/progress/body' },
  workout: { label: 'Training days', title: 'Training day', body: 'Your next session is ready in Fitness OS.', url: '/workout' },
  food: { label: 'Log today’s food', title: 'Log today’s food', body: 'A minute now keeps your calories and protein on track.', url: '/nutrition' },
  review: { label: 'Weekly review', title: 'Your weekly review', body: 'See how the week went and set up the next one.', url: '/more/review' },
};

export const DEFAULT_REMINDERS: Reminder[] = [
  { id: 'weigh-in', enabled: false, time: '07:30', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'workout', enabled: false, time: '17:30', days: [1, 3, 5] },
  { id: 'food', enabled: false, time: '20:00', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'review', enabled: false, time: '18:00', days: [0] },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Cleans reminders that came from a device (the server stores what phones send it). */
export function sanitiseReminders(input: unknown): Reminder[] {
  if (!Array.isArray(input)) return [];
  const out: Reminder[] = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.id !== 'string' || !(x.id in REMINDER_TEXT) || out.some((o) => o.id === x.id)) continue;
    if (typeof x.time !== 'string' || !TIME.test(x.time)) continue;
    const days = Array.isArray(x.days) ? [...new Set(x.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    out.push({ id: x.id as ReminderId, enabled: x.enabled === true, time: x.time, days });
  }
  return out;
}

/** Merge saved settings over the defaults (so new reminder types appear switched off). */
export function withDefaults(saved: Reminder[] | undefined | null): Reminder[] {
  return DEFAULT_REMINDERS.map((d) => ({ ...d, ...(saved?.find((s) => s.id === d.id) ?? {}) }));
}

/** Local date, weekday and minutes-since-midnight in an IANA time zone. */
export function localNow(now: Date, tz: string): { date: string; weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' };
  try {
    parts = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).formatToParts(now);
  }
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p('weekday'));
  return { date: `${p('year')}-${p('month')}-${p('day')}`, weekday, minutes: Number(p('hour')) * 60 + Number(p('minute')) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Reminders that should go out now: enabled, today is one of its days, its time has passed within
 * the last `windowMin` minutes (so a late cron run still sends it, but never hours late), and it
 * hasn't already been sent today. `lastSent` maps reminder id → local date it was last sent.
 */
export function dueReminders(reminders: Reminder[], lastSent: Record<string, string>, now: Date, tz: string, windowMin = 60): Reminder[] {
  const local = localNow(now, tz);
  return reminders.filter((r) => {
    if (!r.enabled || !r.days.includes(local.weekday) || lastSent[r.id] === local.date) return false;
    const late = local.minutes - toMinutes(r.time);
    return late >= 0 && late < windowMin;
  });
}
