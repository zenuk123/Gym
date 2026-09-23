import type {
  Exercise,
  Routine,
  RoutineExercise,
  SetKind,
  WeightUnit,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../../db/types';
import { newId } from '../../lib/id';
import { roundToStep, suggestNext, type ExerciseSession, type Suggestion, type TrainingHistory } from '../../lib/calc/training';

// Pure workout logic (no database): building a session from a routine, editing sets,
// and deciding what comes next in Gym Mode. Unit-tested in logic.test.ts.

export type PlanSpec = Pick<RoutineExercise, 'sets' | 'warmupSets' | 'repMin' | 'repMax' | 'restSec' | 'supersetGroup'>;

export const DEFAULT_SPEC: PlanSpec = { sets: 3, warmupSets: 0, repMin: 8, repMax: 12, restSec: 90, supersetGroup: null };

export interface PlanContext {
  unit: WeightUnit;
  fmt: (kg: number) => string;
}

const WARMUP_SCHEME: Record<number, [pct: number, reps: number][]> = {
  1: [[0.6, 6]],
  2: [
    [0.5, 8],
    [0.75, 4],
  ],
  3: [
    [0.4, 8],
    [0.6, 5],
    [0.8, 3],
  ],
};

const set = (kind: SetKind, weightKg: number, reps: number): WorkoutSet => ({
  id: newId(),
  kind,
  weightKg,
  reps,
  rpe: null,
  done: false,
  completedAt: null,
});

/** Build one exercise for today, pre-filled with the suggested target (a suggestion, never a rule). */
export function planExercise(
  exercise: Exercise,
  spec: PlanSpec,
  sessions: ExerciseSession[],
  ctx: PlanContext,
): { exercise: WorkoutExercise; suggestion: Suggestion } {
  const suggestion = suggestNext({
    sessions,
    repMin: spec.repMin,
    repMax: spec.repMax,
    incrementKg: exercise.incrementKg,
    unit: ctx.unit,
    fmt: ctx.fmt,
  });
  const weight = suggestion.weightKg ?? 0;
  const last = sessions.at(-1);
  const lastTop = last ? last.sets.filter((s) => s.kind !== 'drop' && Math.abs(s.weightKg - last.topSet.weightKg) < 1e-6) : [];

  const repsFor = (i: number): number => {
    const prev = lastTop[i]?.reps ?? lastTop.at(-1)?.reps ?? spec.repMin;
    switch (suggestion.kind) {
      case 'reps':
        return Math.min(spec.repMax, prev + 1);
      case 'repeat':
        return Math.max(spec.repMin, Math.min(spec.repMax, prev));
      case 'deload':
        return spec.repMax;
      default:
        return spec.repMin;
    }
  };

  const warmups = (WARMUP_SCHEME[Math.min(3, spec.warmupSets)] ?? []).map(([pct, reps]) => {
    let w = weight > 0 ? roundToStep(weight * pct, exercise.incrementKg, ctx.unit) : 0;
    if (exercise.equipment === 'barbell' && weight >= 20) w = Math.max(20, w); // never lighter than the bar
    return set('warmup', w, reps);
  });

  return {
    suggestion,
    exercise: {
      id: newId(),
      exerciseId: exercise.id,
      supersetGroup: spec.supersetGroup,
      restSec: spec.restSec,
      repMin: spec.repMin,
      repMax: spec.repMax,
      target: suggestion.weightKg !== null ? { weightKg: suggestion.weightKg, repMin: spec.repMin, repMax: spec.repMax } : null,
      notes: null,
      sets: [...warmups, ...Array.from({ length: spec.sets }, (_, i) => set('normal', weight, repsFor(i)))],
    },
  };
}

export type NewWorkout = Omit<Workout, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export function buildWorkout(opts: {
  routine: Routine | null;
  exercises: Map<string, Exercise>;
  history: TrainingHistory;
  ctx: PlanContext;
  date: string;
  now?: number;
}): NewWorkout {
  const { routine, exercises, history, ctx } = opts;
  const planned = (routine?.exercises ?? []).flatMap((re) => {
    const ex = exercises.get(re.exerciseId);
    return ex ? [planExercise(ex, re, history.get(ex.id) ?? [], ctx).exercise] : [];
  });
  return {
    routineId: routine?.id ?? null,
    name: routine?.name ?? 'Workout',
    date: opts.date,
    startedAt: opts.now ?? Date.now(),
    endedAt: null,
    notes: null,
    exercises: planned,
  };
}

// ── Set editing (all return a new/updated workout; used inside repo.mutate) ─────

function findEx(w: Workout, exId: string): WorkoutExercise | undefined {
  return w.exercises.find((e) => e.id === exId);
}

export function patchSet(w: Workout, exId: string, setId: string, patch: Partial<WorkoutSet>): Workout {
  const s = findEx(w, exId)?.sets.find((x) => x.id === setId);
  if (s) Object.assign(s, patch);
  return w;
}

export function completeSet(w: Workout, exId: string, setId: string, now = Date.now()): Workout {
  return patchSet(w, exId, setId, { done: true, completedAt: now });
}

export function addSet(w: Workout, exId: string, kind: SetKind, opts: { incrementKg: number; unit: WeightUnit }): Workout {
  const ex = findEx(w, exId);
  if (!ex) return w;
  const working = ex.sets.filter((s) => s.kind !== 'warmup');
  const ref = working.at(-1) ?? ex.sets.at(-1);
  const baseWeight = ref?.weightKg ?? ex.target?.weightKg ?? 0;
  const baseReps = ref?.reps ?? ex.repMin;
  if (kind === 'warmup') {
    const firstWork = ex.sets.findIndex((s) => s.kind !== 'warmup');
    const w0 = baseWeight > 0 ? roundToStep(baseWeight * 0.5, opts.incrementKg, opts.unit) : 0;
    ex.sets.splice(firstWork < 0 ? ex.sets.length : firstWork, 0, set('warmup', w0, 8));
  } else if (kind === 'drop') {
    // Drop set: ~20% lighter, as many reps as possible, straight after the last set.
    const lighter = baseWeight > 0 ? roundToStep(baseWeight * 0.8, opts.incrementKg, opts.unit) : 0;
    ex.sets.push(set('drop', lighter, baseReps));
  } else {
    ex.sets.push(set(kind, baseWeight, baseReps));
  }
  return w;
}

export function removeSet(w: Workout, exId: string, setId: string): Workout {
  const ex = findEx(w, exId);
  if (ex) ex.sets = ex.sets.filter((s) => s.id !== setId);
  return w;
}

export function addExercise(w: Workout, ex: WorkoutExercise): Workout {
  w.exercises.push(ex);
  return w;
}

export function removeExercise(w: Workout, exId: string): Workout {
  w.exercises = w.exercises.filter((e) => e.id !== exId);
  return w;
}

export function moveExercise(w: Workout, exId: string, delta: -1 | 1): Workout {
  const i = w.exercises.findIndex((e) => e.id === exId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= w.exercises.length) return w;
  [w.exercises[i], w.exercises[j]] = [w.exercises[j], w.exercises[i]];
  return w;
}

/** Finish: drop sets that were never done (and exercises left empty), stamp the end time. */
export function finalizeWorkout(w: Workout, now = Date.now()): Workout {
  w.exercises = w.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length > 0);
  w.endedAt = now;
  return w;
}

// ── Gym Mode flow ─────────────────────────────────────────────────────────

export const pendingSetIndex = (ex: WorkoutExercise) => ex.sets.findIndex((s) => !s.done);
export const isExerciseDone = (ex: WorkoutExercise) => ex.sets.length > 0 && pendingSetIndex(ex) < 0;

/** Exercise indexes that form a superset with `index` (just [index] when not in one). */
export function supersetMembers(w: Workout, index: number): number[] {
  const g = w.exercises[index]?.supersetGroup;
  if (!g) return [index];
  return w.exercises.flatMap((e, i) => (e.supersetGroup === g ? [i] : []));
}

/**
 * After completing a set on exercise `index`, where to go and whether to rest:
 * - superset: move to the next member without resting; rest after the last member
 * - next set is a drop set: go straight into it
 * - exercise finished: rest, then move to the next exercise that still has sets
 */
export function afterSetCompleted(w: Workout, index: number): { index: number; rest: boolean } {
  const members = supersetMembers(w, index);
  const pos = members.indexOf(index);
  const pending = (i: number) => pendingSetIndex(w.exercises[i]) >= 0;

  if (members.length > 1) {
    const later = members.slice(pos + 1).find(pending);
    if (later !== undefined) return { index: later, rest: false };
    const first = members.find(pending);
    if (first !== undefined) return { index: first, rest: true };
  } else {
    const ex = w.exercises[index];
    const p = pendingSetIndex(ex);
    if (p >= 0) return { index, rest: ex.sets[p].kind !== 'drop' };
  }
  // Current exercise/superset is finished: next exercise with work left (wrapping round).
  for (let k = 1; k <= w.exercises.length; k++) {
    const i = (index + k) % w.exercises.length;
    if (!members.includes(i) && pending(i)) return { index: i, rest: true };
  }
  return { index, rest: true };
}
