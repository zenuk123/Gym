import type { ISODate, SleepLog, Workout } from '../../db/types';
import { mean } from './stats';
import { e1rm, workingSets } from './training';

// Sleep maths: durations, consistency and the sleep ↔ training relationship. Pure + tested.

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes between bedtime and wake time, crossing midnight when needed. */
export function sleepDuration(bedTime: string, wakeTime: string): number {
  const d = toMin(wakeTime) - toMin(bedTime);
  return d <= 0 ? d + 24 * 60 : d;
}

export const formatDuration = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

export interface SleepSummary {
  nights: number;
  avgMin: number | null;
  avgQuality: number | null;
  /** Spread of bedtimes (minutes, standard deviation) — lower is more consistent. */
  bedtimeSpreadMin: number | null;
  shortNights: number;
}

export function summariseSleep(logs: SleepLog[], from: ISODate, to: ISODate, shortUnderMin = 7 * 60): SleepSummary {
  const xs = logs.filter((l) => l.deletedAt === null && l.date >= from && l.date <= to);
  // Bedtimes around midnight: treat times before noon as "after midnight" (+24h) so 23:30 and 00:30 are close.
  const beds = xs.map((l) => {
    const m = toMin(l.bedTime);
    return m < 12 * 60 ? m + 24 * 60 : m;
  });
  const avgBed = mean(beds);
  const spread = avgBed === null || beds.length < 3 ? null : Math.sqrt(beds.reduce((s, b) => s + (b - avgBed) ** 2, 0) / beds.length);
  return {
    nights: xs.length,
    avgMin: mean(xs.map((l) => l.durationMin)),
    avgQuality: mean(xs.map((l) => l.quality)),
    bedtimeSpreadMin: spread,
    shortNights: xs.filter((l) => l.durationMin < shortUnderMin).length,
  };
}

export interface SleepTrainingLink {
  wellRested: { sessions: number; performance: number };
  short: { sessions: number; performance: number };
  /** Percentage difference in performance (well-rested vs short). */
  differencePct: number;
}

/**
 * Does sleep relate to how you lift? For every workout with a logged night before it,
 * each exercise's best e1RM is compared with that exercise's median over its previous
 * 5 sessions (1.00 = a typical day). Sessions are split by ≥ / < `thresholdMin` of sleep.
 * Needs ≥ 3 sessions in each group — otherwise null (not enough evidence).
 */
export function sleepVsTraining(logs: SleepLog[], workouts: Workout[], thresholdMin = 7 * 60): SleepTrainingLink | null {
  const sleepByDate = new Map(logs.filter((l) => l.deletedAt === null).map((l) => [l.date, l.durationMin]));
  const finished = workouts.filter((w) => w.endedAt !== null && w.deletedAt === null).sort((a, b) => a.startedAt - b.startedAt);
  const past = new Map<string, number[]>();
  const good: number[] = [];
  const bad: number[] = [];
  for (const w of finished) {
    const ratios: number[] = [];
    for (const ex of w.exercises) {
      const sets = workingSets(ex);
      if (!sets.length) continue;
      const best = Math.max(...sets.map((s) => e1rm(s.weightKg, s.reps)));
      const hist = past.get(ex.exerciseId) ?? [];
      if (hist.length >= 2 && best > 0) {
        const recent = [...hist.slice(-5)].sort((a, b) => a - b);
        const median = recent[Math.floor(recent.length / 2)];
        if (median > 0) ratios.push(best / median);
      }
      if (best > 0) past.set(ex.exerciseId, [...hist, best]);
    }
    const slept = sleepByDate.get(w.date);
    if (slept === undefined || ratios.length === 0) continue;
    const perf = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    (slept >= thresholdMin ? good : bad).push(perf);
  }
  if (good.length < 3 || bad.length < 3) return null;
  const g = mean(good)!;
  const b = mean(bad)!;
  return { wellRested: { sessions: good.length, performance: g }, short: { sessions: bad.length, performance: b }, differencePct: ((g - b) / b) * 100 };
}

/** Last night's sleep = the log filed under today's (wake-up) date. */
export const lastNight = (logs: SleepLog[], today: ISODate) => logs.find((l) => l.deletedAt === null && l.date === today) ?? null;
