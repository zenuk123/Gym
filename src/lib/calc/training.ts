import type { Exercise, ISODate, Routine, WeightUnit, Workout, WorkoutExercise, WorkoutSet } from '../../db/types';
import { addDays, startOfWeek } from '../dates';
import { kgToLb, lbToKg } from '../units';

// Pure training maths: no React, no database. Everything here is unit-tested.

const EPS = 1e-6;

/** Estimated one-rep max (Epley). A single rep is the lift itself. */
export function e1rm(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Completed sets that count as real work (warm-ups excluded). */
export function workingSets(ex: Pick<WorkoutExercise, 'sets'>): WorkoutSet[] {
  return ex.sets.filter((s) => s.done && s.kind !== 'warmup' && s.reps > 0);
}

export function volumeOf(sets: Pick<WorkoutSet, 'weightKg' | 'reps'>[]): number {
  return sets.reduce((v, s) => v + s.weightKg * s.reps, 0);
}

export interface WorkoutStats {
  sets: number;
  reps: number;
  volumeKg: number;
  exercises: number;
  durationMin: number | null;
}

export function workoutStats(w: Workout, now = Date.now()): WorkoutStats {
  const working = w.exercises.map(workingSets);
  const all = working.flat();
  return {
    sets: all.length,
    reps: all.reduce((n, s) => n + s.reps, 0),
    volumeKg: volumeOf(all),
    exercises: working.filter((s) => s.length > 0).length,
    durationMin: Math.max(1, Math.round(((w.endedAt ?? now) - w.startedAt) / 60_000)),
  };
}

// ── History ──────────────────────────────────────────────────────────────

export interface ExerciseSession {
  workoutId: string;
  date: ISODate;
  startedAt: number;
  sets: WorkoutSet[];
  topSet: WorkoutSet;
  bestE1rm: number;
  volumeKg: number;
}

/** exerciseId → sessions (oldest first). Only finished, non-deleted workouts count. */
export type TrainingHistory = Map<string, ExerciseSession[]>;

export function buildHistory(workouts: Workout[]): TrainingHistory {
  const history: TrainingHistory = new Map();
  const finished = workouts
    .filter((w) => w.endedAt !== null && w.deletedAt === null)
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const w of finished) {
    // The same exercise can appear twice in one workout; merge its sets.
    const byExercise = new Map<string, WorkoutSet[]>();
    for (const ex of w.exercises) {
      const sets = workingSets(ex);
      if (sets.length) byExercise.set(ex.exerciseId, [...(byExercise.get(ex.exerciseId) ?? []), ...sets]);
    }
    for (const [exerciseId, sets] of byExercise) {
      const topSet = sets.reduce((a, b) => (b.weightKg > a.weightKg + EPS || (Math.abs(b.weightKg - a.weightKg) < EPS && b.reps > a.reps) ? b : a));
      const session: ExerciseSession = {
        workoutId: w.id,
        date: w.date,
        startedAt: w.startedAt,
        sets,
        topSet,
        bestE1rm: Math.max(...sets.map((s) => e1rm(s.weightKg, s.reps))),
        volumeKg: volumeOf(sets),
      };
      history.set(exerciseId, [...(history.get(exerciseId) ?? []), session]);
    }
  }
  return history;
}

/** Most recent session of an exercise, optionally ignoring one workout (e.g. the one in progress). */
export function lastSession(history: TrainingHistory, exerciseId: string, excludeWorkoutId?: string): ExerciseSession | null {
  const sessions = (history.get(exerciseId) ?? []).filter((s) => s.workoutId !== excludeWorkoutId);
  return sessions.at(-1) ?? null;
}

// ── Personal bests ───────────────────────────────────────────────────────

export type PBKind = 'weight' | 'e1rm' | 'reps' | 'volume';

export interface PersonalBest {
  kind: PBKind;
  exerciseId: string;
  workoutId: string;
  date: ISODate;
  startedAt: number;
  weightKg: number;
  reps: number;
  /** The compared value: kg for weight/e1rm/volume, reps for reps. */
  value: number;
  previous: { weightKg: number; reps: number; value: number };
}

export const PB_LABEL: Record<PBKind, string> = {
  weight: 'Heaviest weight',
  e1rm: 'Estimated 1RM',
  reps: 'Most reps',
  volume: 'Session volume',
};

/**
 * Walk each exercise's history in order and record every time a best was beaten.
 * The first session only sets the baseline — nothing counts as a PB without a previous best.
 * Per session: at most one PB of each kind, and a set that's already a weight PB isn't
 * reported again as a rep or e1RM PB.
 */
export function detectPBs(history: TrainingHistory, exercises?: Map<string, Pick<Exercise, 'bodyweight'>>): PersonalBest[] {
  const out: PersonalBest[] = [];
  for (const [exerciseId, sessions] of history) {
    const bodyweight = exercises?.get(exerciseId)?.bodyweight ?? false;
    const prior: WorkoutSet[] = [];
    let bestWeight: WorkoutSet | null = null;
    let bestE1rm: { set: WorkoutSet; value: number } | null = null;
    let bestVolume: { value: number; set: WorkoutSet } | null = null;

    for (const s of sessions) {
      const base = { exerciseId, workoutId: s.workoutId, date: s.date, startedAt: s.startedAt };
      if (prior.length > 0) {
        let weightPbSet: WorkoutSet | null = null;
        // Weight PB (bodyweight moves only count once there's added load)
        if (bestWeight && s.topSet.weightKg > bestWeight.weightKg + EPS && (!bodyweight || s.topSet.weightKg > 0)) {
          weightPbSet = s.topSet;
          out.push({
            ...base,
            kind: 'weight',
            weightKg: s.topSet.weightKg,
            reps: s.topSet.reps,
            value: s.topSet.weightKg,
            previous: { weightKg: bestWeight.weightKg, reps: bestWeight.reps, value: bestWeight.weightKg },
          });
        }
        // e1RM PB
        if (!bodyweight && !weightPbSet && bestE1rm) {
          const top = s.sets.reduce((a, b) => (e1rm(b.weightKg, b.reps) > e1rm(a.weightKg, a.reps) ? b : a));
          const v = e1rm(top.weightKg, top.reps);
          if (v > bestE1rm.value + EPS) {
            out.push({
              ...base,
              kind: 'e1rm',
              weightKg: top.weightKg,
              reps: top.reps,
              value: v,
              previous: { weightKg: bestE1rm.set.weightKg, reps: bestE1rm.set.reps, value: bestE1rm.value },
            });
          }
        }
        // Rep PB: more reps than ever at this weight or heavier. Report the heaviest such set.
        let repPb: { set: WorkoutSet; prev: WorkoutSet } | null = null;
        for (const set of s.sets) {
          if (set === weightPbSet) continue;
          const comparable = prior.filter((p) => p.weightKg >= set.weightKg - EPS);
          if (comparable.length === 0) continue;
          const prev = comparable.reduce((a, b) => (b.reps > a.reps ? b : a));
          if (set.reps > prev.reps && (!repPb || set.weightKg > repPb.set.weightKg + EPS)) repPb = { set, prev };
        }
        if (repPb) {
          out.push({
            ...base,
            kind: 'reps',
            weightKg: repPb.set.weightKg,
            reps: repPb.set.reps,
            value: repPb.set.reps,
            previous: { weightKg: repPb.prev.weightKg, reps: repPb.prev.reps, value: repPb.prev.reps },
          });
        }
        // Session volume PB (weighted moves only)
        if (!bodyweight && bestVolume && s.volumeKg > bestVolume.value + EPS) {
          out.push({
            ...base,
            kind: 'volume',
            weightKg: s.topSet.weightKg,
            reps: s.topSet.reps,
            value: s.volumeKg,
            previous: { weightKg: bestVolume.set.weightKg, reps: bestVolume.set.reps, value: bestVolume.value },
          });
        }
      }
      // Update running bests with this session.
      if (!bestWeight || s.topSet.weightKg > bestWeight.weightKg + EPS) bestWeight = s.topSet;
      for (const set of s.sets) {
        const v = e1rm(set.weightKg, set.reps);
        if (!bestE1rm || v > bestE1rm.value + EPS) bestE1rm = { set, value: v };
      }
      if (!bestVolume || s.volumeKg > bestVolume.value + EPS) bestVolume = { value: s.volumeKg, set: s.topSet };
      prior.push(...s.sets);
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Live PB check for a set just completed in Gym Mode, against every earlier working set
 * (past sessions plus earlier sets today). Returns the most impressive PB, or null.
 */
export function checkSetPB(
  set: Pick<WorkoutSet, 'weightKg' | 'reps'>,
  earlier: Pick<WorkoutSet, 'weightKg' | 'reps'>[],
  bodyweight = false,
): { kind: Exclude<PBKind, 'volume'>; previous: { weightKg: number; reps: number } } | null {
  if (earlier.length === 0 || set.reps <= 0) return null;
  const heaviest = earlier.reduce((a, b) => (b.weightKg > a.weightKg + EPS || (Math.abs(b.weightKg - a.weightKg) < EPS && b.reps > a.reps) ? b : a));
  if (set.weightKg > heaviest.weightKg + EPS && (!bodyweight || set.weightKg > 0)) {
    return { kind: 'weight', previous: { weightKg: heaviest.weightKg, reps: heaviest.reps } };
  }
  const comparable = earlier.filter((p) => p.weightKg >= set.weightKg - EPS);
  if (comparable.length) {
    const most = comparable.reduce((a, b) => (b.reps > a.reps ? b : a));
    if (set.reps > most.reps) return { kind: 'reps', previous: { weightKg: most.weightKg, reps: most.reps } };
  }
  if (!bodyweight) {
    const best = earlier.reduce((a, b) => (e1rm(b.weightKg, b.reps) > e1rm(a.weightKg, a.reps) ? b : a));
    if (e1rm(set.weightKg, set.reps) > e1rm(best.weightKg, best.reps) + EPS) {
      return { kind: 'e1rm', previous: { weightKg: best.weightKg, reps: best.reps } };
    }
  }
  return null;
}

// ── Progressive overload ─────────────────────────────────────────────────

/** Load step in the user's unit: kg uses the exercise increment, lb rounds it to 2.5 lb steps. */
export function displayIncrement(incrementKg: number, unit: WeightUnit): number {
  return unit === 'kg' ? incrementKg : Math.max(2.5, Math.round(kgToLb(incrementKg) / 2.5) * 2.5);
}

/** Add n load steps, working in the unit the user sees so numbers stay clean (e.g. 150 → 155 lb). */
export function stepWeight(kg: number, n: number, incrementKg: number, unit: WeightUnit): number {
  const step = displayIncrement(incrementKg, unit);
  if (unit === 'kg') return Math.max(0, Math.round((kg + n * step) * 1000) / 1000);
  const lb = Math.round(kgToLb(kg) * 2) / 2 + n * step;
  return Math.max(0, lbToKg(lb));
}

/** Round to the nearest loadable weight (multiple of the step). */
export function roundToStep(kg: number, incrementKg: number, unit: WeightUnit): number {
  const step = displayIncrement(incrementKg, unit);
  if (unit === 'kg') return Math.round(kg / step) * step;
  return lbToKg(Math.round(kgToLb(kg) / step) * step);
}

export type SuggestionKind = 'new' | 'increase' | 'reps' | 'repeat' | 'deload';

export interface Suggestion {
  kind: SuggestionKind;
  weightKg: number | null;
  repMin: number;
  repMax: number;
  reason: string;
}

export interface SuggestInput {
  sessions: ExerciseSession[];
  repMin: number;
  repMax: number;
  incrementKg: number;
  unit: WeightUnit;
  /** Formats a kg value for the reason text. */
  fmt: (kg: number) => string;
}

/**
 * Double progression:
 *  - every working set at the top weight reached the top of the rep range (and RPE ≤ 9) → add one step
 *  - in range → same weight, beat last time's reps
 *  - below the range → repeat the weight; below it two sessions running → drop ~10%
 * Only ever a suggestion: it pre-fills today's target, the routine itself never changes.
 */
export function suggestNext({ sessions, repMin, repMax, incrementKg, unit, fmt }: SuggestInput): Suggestion {
  const last = sessions.at(-1);
  if (!last) {
    return { kind: 'new', weightKg: null, repMin, repMax, reason: 'First time — pick a weight you could lift for a couple more reps than the target.' };
  }
  const main = last.sets.filter((s) => s.kind !== 'drop');
  const sets = main.length ? main : last.sets;
  const top = Math.max(...sets.map((s) => s.weightKg));
  const atTop = sets.filter((s) => Math.abs(s.weightKg - top) < EPS);
  const repsText = atTop.map((s) => s.reps).join(', ');
  const rpes = atTop.map((s) => s.rpe).filter((r): r is number => r !== null);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;

  if (atTop.every((s) => s.reps >= repMax)) {
    if (avgRpe !== null && avgRpe > 9) {
      return {
        kind: 'repeat',
        weightKg: top,
        repMin,
        repMax,
        reason: `You hit ${repsText} at ${fmt(top)} but it was a grind (RPE ${avgRpe.toFixed(1)}). Repeat it and own it before adding weight.`,
      };
    }
    const next = stepWeight(top, 1, incrementKg, unit);
    return {
      kind: 'increase',
      weightKg: next,
      repMin,
      repMax,
      reason: `You hit ${repsText} at ${fmt(top)} — the top of your ${repMin}–${repMax} range. Try ${fmt(next)}.`,
    };
  }

  if (atTop.some((s) => s.reps < repMin)) {
    const prev = sessions.at(-2);
    const prevAtSame = prev?.sets.filter((s) => s.kind !== 'drop' && Math.abs(s.weightKg - top) < EPS) ?? [];
    if (prevAtSame.length && prevAtSame.some((s) => s.reps < repMin)) {
      const lighter = roundToStep(top * 0.9, incrementKg, unit);
      return {
        kind: 'deload',
        weightKg: lighter,
        repMin,
        repMax,
        reason: `Below ${repMin} reps at ${fmt(top)} two sessions running. Drop to ${fmt(lighter)} and build back up.`,
      };
    }
    return {
      kind: 'repeat',
      weightKg: top,
      repMin,
      repMax,
      reason: `Last time: ${repsText} at ${fmt(top)}. Stay here and aim for at least ${repMin} reps every set.`,
    };
  }

  return {
    kind: 'reps',
    weightKg: top,
    repMin,
    repMax,
    reason: `Last time: ${repsText} at ${fmt(top)}. Same weight — add a rep where you can. Hit ${repMax} on every set and the weight goes up.`,
  };
}

// ── Scheduling & consistency ─────────────────────────────────────────────

/** Rotation: the routine after the one you did most recently (first routine if none yet). */
export function nextRoutine(routines: Routine[], workouts: Workout[]): Routine | null {
  const list = routines.filter((r) => r.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder);
  if (list.length === 0) return null;
  const done = workouts
    .filter((w) => w.endedAt !== null && w.deletedAt === null && w.routineId)
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const w of done) {
    const i = list.findIndex((r) => r.id === w.routineId);
    if (i >= 0) return list[(i + 1) % list.length];
  }
  return list[0];
}

/** Rough session length: work time + rest per set, rounded to 5 minutes. */
export function estimateMinutes(routine: Pick<Routine, 'exercises'>): number {
  const sec = routine.exercises.reduce((t, e) => t + e.sets * (40 + e.restSec) + e.warmupSets * 60, 0);
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}

export function finishedWorkoutsInWeek(workouts: Workout[], weekStart: ISODate): Workout[] {
  const end = addDays(weekStart, 6);
  return workouts.filter((w) => w.endedAt !== null && w.deletedAt === null && w.date >= weekStart && w.date <= end);
}

/**
 * Consecutive weeks (Mon–Sun) that met the weekly target. The current week only
 * adds to the streak once met — it can't break it while still in progress.
 */
export function weekStreak(workouts: Workout[], target: number, today: ISODate): number {
  if (target <= 0) return 0;
  const thisWeek = startOfWeek(today);
  let streak = finishedWorkoutsInWeek(workouts, thisWeek).length >= target ? 1 : 0;
  for (let week = addDays(thisWeek, -7); ; week = addDays(week, -7)) {
    if (finishedWorkoutsInWeek(workouts, week).length >= target) streak++;
    else break;
  }
  return streak;
}
