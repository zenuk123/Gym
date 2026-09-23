import type { ISODate } from '../db/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date (not UTC — a late-night meal belongs to today). */
export function toISODate(d: Date = new Date()): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayISO = () => toISODate(new Date());

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Monday of the week containing `s`. */
export function startOfWeek(s: ISODate): ISODate {
  const d = parseISODate(s);
  const offset = (d.getDay() + 6) % 7;
  return addDays(s, -offset);
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatDateLong(s: ISODate): string {
  return parseISODate(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDateShort(s: ISODate): string {
  return parseISODate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function relativeDay(s: ISODate, today: ISODate = todayISO()): string {
  const diff = daysBetween(s, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return parseISODate(s).toLocaleDateString('en-GB', { weekday: 'long' });
  return formatDateShort(s);
}
