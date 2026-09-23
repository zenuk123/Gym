import type { ISODate, WeightEntry } from '../../db/types';
import { addDays, daysBetween } from '../dates';

// Body weight fluctuates 1–2 kg day to day (water, food, salt), so everything
// here favours averages and trends over individual weigh-ins.

export interface DailyWeight {
  date: ISODate;
  weightKg: number;
}

/** One value per day (mean of that day's weigh-ins), oldest first. */
export function dailySeries(entries: Pick<WeightEntry, 'date' | 'weightKg'>[]): DailyWeight[] {
  const byDate = new Map<ISODate, number[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e.weightKg]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ws]) => ({ date, weightKg: ws.reduce((s, w) => s + w, 0) / ws.length }));
}

/** Mean of weigh-ins in the `days`-day window ending on `endDate` (inclusive). */
export function windowAverage(series: DailyWeight[], endDate: ISODate, days: number): number | null {
  const start = addDays(endDate, -(days - 1));
  const inWindow = series.filter((d) => d.date >= start && d.date <= endDate);
  if (inWindow.length === 0) return null;
  return inWindow.reduce((s, d) => s + d.weightKg, 0) / inWindow.length;
}

/**
 * Least-squares slope over the last `days` days, in kg per week.
 * Needs at least `minPoints` weigh-ins spanning ≥ 7 days, otherwise null.
 */
export function weeklyRate(series: DailyWeight[], endDate: ISODate, days = 21, minPoints = 4): number | null {
  const start = addDays(endDate, -(days - 1));
  const pts = series.filter((d) => d.date >= start && d.date <= endDate);
  if (pts.length < minPoints || daysBetween(pts[0].date, pts[pts.length - 1].date) < 7) return null;
  const xs = pts.map((p) => daysBetween(start, p.date));
  const ys = pts.map((p) => p.weightKg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : (num / den) * 7;
}

/** Trailing 7-day average for every logged day — the line we chart. */
export function movingAverage(series: DailyWeight[], days = 7): DailyWeight[] {
  return series.map((d) => ({ date: d.date, weightKg: windowAverage(series, d.date, days)! }));
}

export interface WeightSummary {
  latest: DailyWeight | null;
  /** 7-day average ending at the latest weigh-in. */
  average7: number | null;
  /** kg/week over the last 3 weeks. */
  rate: number | null;
  startKg: number;
  /** Trend (7-day avg) change since the start weight. */
  changeKg: number | null;
  targetKg: number | null;
  remainingKg: number | null;
  /** 0–1 progress from start → target along the goal direction. */
  progress: number | null;
}

export function summariseWeight(
  entries: Pick<WeightEntry, 'date' | 'weightKg'>[],
  startKg: number,
  targetKg: number | null,
): WeightSummary {
  const series = dailySeries(entries);
  const latest = series.at(-1) ?? null;
  const average7 = latest ? windowAverage(series, latest.date, 7) : null;
  const rate = latest ? weeklyRate(series, latest.date) : null;
  const current = average7 ?? latest?.weightKg ?? null;
  const changeKg = current === null ? null : current - startKg;
  let remainingKg: number | null = null;
  let progress: number | null = null;
  if (targetKg !== null && current !== null) {
    remainingKg = targetKg - current;
    const total = targetKg - startKg;
    progress = total === 0 ? 1 : Math.min(1, Math.max(0, (current - startKg) / total));
  }
  return { latest, average7, rate, startKg, changeKg, targetKg, remainingKg, progress };
}

/** Calendar-month averages (YYYY-MM), newest first. */
export function monthlyAverages(series: DailyWeight[]): { month: string; avg: number; n: number }[] {
  const months = new Map<string, number[]>();
  for (const d of series) months.set(d.date.slice(0, 7), [...(months.get(d.date.slice(0, 7)) ?? []), d.weightKg]);
  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, ws]) => ({ month, avg: ws.reduce((s, w) => s + w, 0) / ws.length, n: ws.length }));
}
