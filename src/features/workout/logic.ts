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

/** Patch computed from the set's *current* value — for steppers, so rapid taps each count. */
export function updateSet(w: Workout, exId: string, setId: string, fn: (s: WorkoutSet) => Partial<WorkoutSet>): Workout {
  const s = findEx(w, exId)?.sets.find((x) => x.id === setId);
  if (s) Object.assign(s, fn(s));
  return w;
}

export function completeSet(w: Workout, exId: string, setId: string, now = Date.now()): Workout {
  patchSet(w, exId, setId, { done: true, completedAt: now });
  // First time on an exercise every set starts at 0: carry the weight you just used to the
  // following sets of the same type that are still empty, so it's typed once, not every set.
  const ex = findEx(w, exId);
  const i = ex?.sets.findIndex((s) => s.id === setId) ?? -1;
  const done = ex?.sets[i];
  if (ex && done && done.weightKg > 0) {
    for (const s of ex.sets.slice(i + 1)) if (!s.done && s.kind === done.kind && s.weightKg === 0) s.weightKg = done.weightKg;
  }
  return w;
}

/** Gym shorthand → words in exercise names ("db ohp" finds Dumbbell Overhead Press). */
const ALIASES: Record<string, string[]> = {
  db: ['dumbbell'],
  bb: ['barbell'],
  kb: ['kettlebell'],
  ohp: ['overhead', 'press'],
  rdl: ['romanian', 'deadlift'],
  sldl: ['stiff', 'deadlift'],
  bp: ['bench', 'press'],
  dl: ['deadlift'],
  lat: ['lat'],
  tri: ['tricep'],
  bi: ['bicep', 'curl'],
  abs: ['crunch'],
};
const norm = (s: string) => s.toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();
const squash = (s: string) => norm(s).replace(/ /g, '');

/** True when every word of the query (or its expansion) appears in the name; "pullup" finds "Pull-up". */
export function matchesExercise(name: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const n = norm(name);
  if (n.includes(q) || squash(name).includes(squash(query))) return true;
  return q.split(' ').every((word) => (ALIASES[word] ?? [word]).every((part) => n.includes(part) || squash(name).includes(part)));
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

// ── Combining workouts ───────────────────────────────────────────────────

/** "Push + Pull", without repeating a name ("Workout + Workout" → "Workout"). */
export function combinedName(names: string[]): string {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  return uniq.length ? uniq.join(' + ') : 'Workout';
}

/** Fresh superset-group ids, so groups from different sources never accidentally join. */
function regroup(exs: WorkoutExercise[]): WorkoutExercise[] {
  const map = new Map<string, string>();
  return exs.map((e) => {
    if (!e.supersetGroup) return e;
    if (!map.has(e.supersetGroup)) map.set(e.supersetGroup, newId());
    return { ...e, supersetGroup: map.get(e.supersetGroup)! };
  });
}

/**
 * One routine made of several (e.g. Push + Abs), for starting a single session. Exercises keep
 * their order; an exercise already in an earlier routine isn't added twice.
 */
export function combineRoutines(routines: Routine[]): Routine | null {
  if (!routines.length) return null;
  if (routines.length === 1) return routines[0];
  const seen = new Set<string>();
  const exercises: RoutineExercise[] = [];
  for (const r of routines) {
    const groups = new Map<string, string>();
    for (const e of r.exercises) {
      if (seen.has(e.exerciseId)) continue;
      seen.add(e.exerciseId);
      let g = e.supersetGroup;
      if (g) {
        if (!groups.has(g)) groups.set(g, newId());
        g = groups.get(g)!;
      }
      exercises.push({ ...e, key: newId(), supersetGroup: g });
    }
  }
  // Rotation carries on after the last routine done (Legs + Push → Pull is next).
  return { ...routines[routines.length - 1], name: combinedName(routines.map((r) => r.name)), exercises };
}

/** Add a routine's exercises (with today's suggested targets) to a workout in progress. */
export function appendPlanned(w: Workout, planned: WorkoutExercise[], routine?: Pick<Routine, 'id' | 'name'>): Workout {
  w.exercises.push(...regroup(planned));
  if (routine) {
    // An empty workout becomes that routine; otherwise "Push" + Core → "Push + Core".
    w.name = w.exercises.length === planned.length || w.name === 'Workout' ? routine.name : combinedName([w.name, routine.name]);
    w.routineId = routine.id;
  }
  return w;
}

const durationMs = (w: Pick<Workout, 'startedAt' | 'endedAt'>) => Math.max(0, (w.endedAt ?? w.startedAt) - w.startedAt);

/**
 * Merge two logged workouts into one (e.g. a morning and an evening session, or a workout that
 * was accidentally split in two). The result keeps `a`'s id; sets of an exercise that appears in
 * both are joined into one entry. Time = both sessions' durations added up, starting at the
 * earlier start. `b` is not changed here — the caller deletes it.
 */
export function mergeWorkouts(a: Workout, b: Workout): Workout {
  const [first, second] = a.startedAt <= b.startedAt ? [a, b] : [b, a];
  const exercises: WorkoutExercise[] = first.exercises.map((e) => ({ ...e, sets: [...e.sets] }));
  for (const e of regroup(second.exercises)) {
    const same = !e.supersetGroup && exercises.find((x) => x.exerciseId === e.exerciseId && !x.supersetGroup);
    if (same) same.sets.push(...e.sets);
    else exercises.push({ ...e, sets: [...e.sets] });
  }
  const notes = [first.notes, second.notes].map((n) => n?.trim()).filter(Boolean).join('\n');
  return {
    ...a,
    routineId: second.routineId ?? first.routineId, // rotation carries on after the later session
    name: combinedName([first.name, second.name]),
    date: first.date,
    startedAt: first.startedAt,
    endedAt: first.endedAt === null && second.endedAt === null ? null : first.startedAt + durationMs(first) + durationMs(second),
    notes: notes || null,
    exercises,
  };
}

/** Workouts worth offering to merge with `w`: other finished ones, same day first, then newest. */
export function mergeCandidates(w: Workout, finished: Workout[], limit = 12): Workout[] {
  return finished
    .filter((x) => x.id !== w.id && x.deletedAt === null && x.endedAt !== null)
    .sort((x, y) => Number(y.date === w.date) - Number(x.date === w.date) || y.startedAt - x.startedAt)
    .slice(0, limit);
}

/** A workout logged after the fact (forgot to track it): finished, on the chosen day. */
export function pastWorkout(date: string, name: string, minutes: number, startHour = 18): NewWorkout {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d, startHour, 0, 0).getTime();
  return { routineId: null, name: name.trim() || 'Workout', date, startedAt: start, endedAt: start + Math.max(1, minutes) * 60_000, notes: null, exercises: [] };
}
