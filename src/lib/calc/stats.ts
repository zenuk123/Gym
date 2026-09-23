import type { ISODate } from '../../db/types';
import { daysBetween } from '../dates';

export interface DatedValue {
  date: ISODate;
  value: number;
}

/**
 * Least-squares slope in units per week. Needs ≥ `minPoints` points spanning ≥ 7 days,
 * otherwise null — two data points a day apart are not a trend.
 */
export function ratePerWeek(points: DatedValue[], minPoints = 3): number | null {
  if (points.length < minPoints) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted[0].date;
  if (daysBetween(t0, sorted[sorted.length - 1].date) < 7) return null;
  const xs = sorted.map((p) => daysBetween(t0, p.date));
  const ys = sorted.map((p) => p.value);
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

/** Evenly spaced, human-friendly axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
