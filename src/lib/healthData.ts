import type { ISODate } from '../db/types';
import { toISODate } from './dates';
import { nightsFrom, type HealthNight, type HealthWeight, type Segment } from './healthImport';

// Shared shape for every health source: the Health export file, live HealthKit / Health Connect
// (native app) and wearables (server). Each source turns its data into weigh-ins + nights;
// `freshOnly` then keeps only days you haven't logged, so nothing is ever overwritten. Pure + tested.

export interface HealthData {
  weights: HealthWeight[];
  nights: HealthNight[];
}

/** A sample as the native Health plugin returns it (HealthKit on iOS, Health Connect on Android). */
export interface NativeSample {
  value: number;
  unit?: string;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sleepState?: string;
  stages?: { startDate: string; endDate: string; stage: string }[];
}

const NOT_ASLEEP = new Set(['inBed', 'awake']);
const MAX_SEGMENT = 16 * 3_600_000;

/** One weigh-in per day — the earliest reading, like the file import. */
export function weightsFrom(readings: { at: Date; kg: number }[]): HealthWeight[] {
  const byDay = new Map<ISODate, { at: number; kg: number }>();
  for (const r of readings) {
    if (!(r.kg > 20 && r.kg < 400) || Number.isNaN(r.at.getTime())) continue;
    const date = toISODate(r.at);
    const prev = byDay.get(date);
    if (!prev || r.at.getTime() < prev.at) byDay.set(date, { at: r.at.getTime(), kg: r.kg });
  }
  return [...byDay.entries()].map(([date, w]) => ({ date, weightKg: Math.round(w.kg * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Native samples → weigh-ins + nights. iOS sends one sample per sleep stage; Android sends one
 * sample per session, with stages when the tracker recorded them (a session without stages
 * counts as asleep). Awake segments are dropped; "in bed" only counts when nothing else exists.
 */
export function fromNativeSamples(weight: NativeSample[], sleep: NativeSample[]): HealthData {
  const weights = weightsFrom(weight.filter((s) => !s.unit || s.unit === 'kilogram').map((s) => ({ at: new Date(s.startDate), kg: s.value })));
  const segments: Segment[] = [];
  const push = (start: string, end: string, state: string | undefined, source: string) => {
    const a = new Date(start);
    const b = new Date(end);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a || b.getTime() - a.getTime() > MAX_SEGMENT) return;
    if (state === 'awake') return;
    segments.push({ start: a, end: b, asleep: !state || !NOT_ASLEEP.has(state), source });
  };
  for (const s of sleep) {
    const source = s.sourceName || 'Health';
    if (s.stages?.length) for (const st of s.stages) push(st.startDate, st.endDate, st.stage, source);
    else push(s.startDate, s.endDate, s.sleepState, source);
  }
  return { weights, nights: nightsFrom(segments) };
}

/** Only the days you haven't logged yet (and not before `from`). */
export function freshOnly(found: HealthData, have: { weights: Iterable<ISODate>; nights: Iterable<ISODate> }, from: ISODate = '0000-00-00'): HealthData {
  const w = new Set(have.weights);
  const n = new Set(have.nights);
  return {
    weights: found.weights.filter((x) => x.date >= from && !w.has(x.date)),
    nights: found.nights.filter((x) => x.date >= from && !n.has(x.date)),
  };
}
