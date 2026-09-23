import type { ISODate, Measurement, Profile, UserGoal, Workout } from '../../db/types';
import { addDays, daysBetween, startOfWeek } from '../dates';
import { siteSeries } from './measurements';
import { ratePerWeek, type DatedValue } from './stats';
import { e1rm, finishedWorkoutsInWeek, type TrainingHistory } from './training';
import type { WeightSummary } from './weight';

/**
 * Every goal — the profile's body-weight and weekly-training targets plus the
 * user's lift/measurement goals — evaluated the same way: start → current → target,
 * progress, achieved, and a projected finish at the current rate (a calculation,
 * not a promise).
 */

export type GoalStatusKind = 'bodyweight' | 'frequency' | 'lift' | 'measurement';

export interface GoalStatus {
  /** Stable key: 'bodyweight' | 'frequency' | the UserGoal id. */
  id: string;
  kind: GoalStatusKind;
  goal: UserGoal | null;
  start: number;
  current: number | null;
  target: number;
  /** 0–1 along the start → target direction. */
  progress: number;
  achieved: boolean;
  /** First date the target was reached (lift/measurement), if known. */
  achievedOn: ISODate | null;
  /** Rate in units/week in the goal's direction (positive = moving toward it). */
  ratePerWeek: number | null;
  /** Projected date at the current rate, if moving toward the target. */
  eta: ISODate | null;
  targetDate: ISODate | null;
  /** Needed rate/week to hit targetDate from today. */
  requiredPerWeek: number | null;
}

function progressOf(start: number, current: number, target: number): number {
  const total = target - start;
  if (total === 0) return current === target ? 1 : 0;
  return Math.min(1, Math.max(0, (current - start) / total));
}

function reached(current: number, start: number, target: number): boolean {
  return target >= start ? current >= target - 1e-9 : current <= target + 1e-9;
}

function projection(
  start: number,
  current: number | null,
  target: number,
  rate: number | null,
  today: ISODate,
  targetDate: ISODate | null,
) {
  const dir = Math.sign(target - start) || 1;
  const toward = rate === null ? null : rate * dir;
  let eta: ISODate | null = null;
  if (current !== null && toward !== null && toward > 1e-6 && !reached(current, start, target)) {
    const weeks = Math.abs(target - current) / toward;
    if (weeks < 520) eta = addDays(today, Math.ceil(weeks * 7));
  }
  let requiredPerWeek: number | null = null;
  if (current !== null && targetDate && targetDate > today) {
    requiredPerWeek = Math.abs(target - current) / (daysBetween(today, targetDate) / 7);
  }
  return { ratePerWeek: toward, eta, requiredPerWeek };
}

export function bodyweightGoal(profile: Profile, weight: WeightSummary, today: ISODate): GoalStatus | null {
  if (profile.targetWeightKg === null) return null;
  const current = weight.average7 ?? weight.latest?.weightKg ?? null;
  const start = profile.startWeightKg;
  const target = profile.targetWeightKg;
  return {
    id: 'bodyweight',
    kind: 'bodyweight',
    goal: null,
    start,
    current,
    target,
    progress: current === null ? 0 : progressOf(start, current, target),
    achieved: current !== null && reached(current, start, target),
    achievedOn: null,
    ...projection(start, current, target, weight.rate, today, null),
    targetDate: null,
  };
}

export function frequencyGoal(profile: Profile, finished: Workout[], today: ISODate): GoalStatus {
  const done = finishedWorkoutsInWeek(finished, startOfWeek(today)).length;
  const target = profile.workoutsPerWeek;
  return {
    id: 'frequency',
    kind: 'frequency',
    goal: null,
    start: 0,
    current: done,
    target,
    progress: Math.min(1, done / target),
    achieved: done >= target,
    achievedOn: null,
    ratePerWeek: null,
    eta: null,
    targetDate: null,
    requiredPerWeek: null,
  };
}

/** Best value per session for a lift goal's metric. */
function liftSeries(history: TrainingHistory, g: UserGoal): DatedValue[] {
  return (history.get(g.exerciseId ?? '') ?? []).map((s) => ({
    date: s.date,
    value: g.metric === 'e1rm' ? s.bestE1rm : Math.max(...s.sets.map((x) => x.weightKg)),
  }));
}

export function evaluateGoal(
  g: UserGoal,
  ctx: { history: TrainingHistory; measurements: Measurement[]; today: ISODate },
): GoalStatus {
  const series = g.kind === 'lift' ? liftSeries(ctx.history, g) : g.site ? siteSeries(ctx.measurements, g.site) : [];
  const since = series.filter((p) => p.date >= g.startDate);
  // Lifts: best ever counts (a PB doesn't un-happen). Measurements: the latest reading.
  const current =
    g.kind === 'lift'
      ? series.length
        ? Math.max(...series.map((p) => p.value))
        : null
      : (series.at(-1)?.value ?? null);
  const hit = since.find((p) => reached(p.value, g.startValue, g.targetValue));
  const recent = series.filter((p) => p.date >= addDays(ctx.today, -83)); // ~12 weeks
  const rate = ratePerWeek(recent);
  return {
    id: g.id,
    kind: g.kind,
    goal: g,
    start: g.startValue,
    current,
    target: g.targetValue,
    progress: current === null ? 0 : progressOf(g.startValue, current, g.targetValue),
    achieved: current !== null && reached(current, g.startValue, g.targetValue),
    achievedOn: hit?.date ?? null,
    ...projection(g.startValue, current, g.targetValue, rate, ctx.today, g.targetDate),
    targetDate: g.targetDate,
  };
}

/** Current best for a lift (used as a new goal's start value). */
export function currentLiftBest(history: TrainingHistory, exerciseId: string, metric: 'weight' | 'e1rm'): number | null {
  const sessions = history.get(exerciseId) ?? [];
  if (!sessions.length) return null;
  return Math.max(...sessions.flatMap((s) => s.sets.map((x) => (metric === 'e1rm' ? e1rm(x.weightKg, x.reps) : x.weightKg))));
}
