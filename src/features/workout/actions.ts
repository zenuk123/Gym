import { db } from '../../db/db';
import { create, mutate, remove, update } from '../../db/repo';
import { templateExerciseId, type ProgrammeTemplate } from '../../db/seed/templates';
import type { Exercise, Routine, RoutineExercise, SetKind, WeightUnit, Workout, WorkoutSet } from '../../db/types';
import type { TrainingHistory } from '../../lib/calc/training';
import { todayISO } from '../../lib/dates';
import { newId } from '../../lib/id';
import * as L from './logic';

// Database side of the workout system. Live workouts are edited with `mutate`, so
// every tap is saved to the phone immediately (crash- and offline-safe).

const edit = (id: string, fn: (w: Workout) => Workout) => mutate('workouts', id, fn);

export async function getActiveWorkout(): Promise<Workout | undefined> {
  const all = await db.workouts.orderBy('startedAt').reverse().toArray();
  return all.find((w) => w.endedAt === null && w.deletedAt === null);
}

export async function startWorkout(opts: {
  routine: Routine | null;
  exercises: Map<string, Exercise>;
  history: TrainingHistory;
  ctx: L.PlanContext;
}): Promise<Workout> {
  const active = await getActiveWorkout();
  if (active) return active; // only one workout at a time — resume it
  return create('workouts', L.buildWorkout({ ...opts, date: todayISO() }));
}

export const setField = (wid: string, exId: string, setId: string, patch: Partial<WorkoutSet>) =>
  edit(wid, (w) => L.patchSet(w, exId, setId, patch));

/** Read-modify-write one set inside the transaction (never from possibly stale UI state). */
export const editSet = (wid: string, exId: string, setId: string, fn: (s: WorkoutSet) => Partial<WorkoutSet>) =>
  edit(wid, (w) => L.updateSet(w, exId, setId, fn));

export const completeSet = (wid: string, exId: string, setId: string) => edit(wid, (w) => L.completeSet(w, exId, setId));

export const undoSet = (wid: string, exId: string, setId: string) =>
  edit(wid, (w) => L.patchSet(w, exId, setId, { done: false, completedAt: null }));

export const addSet = (wid: string, exId: string, kind: SetKind, opts: { incrementKg: number; unit: WeightUnit }) =>
  edit(wid, (w) => L.addSet(w, exId, kind, opts));

export const removeSet = (wid: string, exId: string, setId: string) => edit(wid, (w) => L.removeSet(w, exId, setId));

export function addExerciseToWorkout(
  wid: string,
  exercise: Exercise,
  history: TrainingHistory,
  ctx: L.PlanContext,
  spec: L.PlanSpec = L.DEFAULT_SPEC,
) {
  const planned = L.planExercise(exercise, spec, history.get(exercise.id) ?? [], ctx).exercise;
  return edit(wid, (w) => L.addExercise(w, planned));
}

export const removeExerciseFromWorkout = (wid: string, exId: string) => edit(wid, (w) => L.removeExercise(w, exId));
export const moveExerciseInWorkout = (wid: string, exId: string, delta: -1 | 1) => edit(wid, (w) => L.moveExercise(w, exId, delta));

export const setExerciseNotes = (wid: string, exId: string, notes: string) =>
  edit(wid, (w) => {
    const ex = w.exercises.find((e) => e.id === exId);
    if (ex) ex.notes = notes.trim() || null;
    return w;
  });

export const finishWorkout = (wid: string, notes: string | null) =>
  edit(wid, (w) => {
    w.notes = notes;
    return L.finalizeWorkout(w);
  });

export const discardWorkout = (wid: string) => remove('workouts', wid);

// ── Combining & editing logged workouts ──────────────────────────────────

/** Add every exercise of a routine (with today's targets) to the workout in progress. */
export function addRoutineToWorkout(wid: string, routine: Routine, exercises: Map<string, Exercise>, history: TrainingHistory, ctx: L.PlanContext) {
  const planned = routine.exercises.flatMap((re) => {
    const ex = exercises.get(re.exerciseId);
    return ex ? [L.planExercise(ex, re, history.get(ex.id) ?? [], ctx).exercise] : [];
  });
  return edit(wid, (w) => L.appendPlanned(w, planned, routine));
}

/**
 * Merge workout `otherId` into `keepId` (one transaction) and delete the other.
 * Returns an undo that puts both back exactly as they were.
 */
export async function mergeWorkoutsInto(keepId: string, otherId: string): Promise<(() => Promise<void>) | null> {
  let before: { keep: Workout; other: Workout } | null = null;
  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const keep = await db.workouts.get(keepId);
    const other = await db.workouts.get(otherId);
    if (!keep || !other || keep.deletedAt || other.deletedAt) return;
    before = { keep: structuredClone(keep), other: structuredClone(other) };
    await mutate('workouts', keepId, (w) => L.mergeWorkouts(w, other));
    await remove('workouts', otherId);
  });
  const saved = before as { keep: Workout; other: Workout } | null;
  if (!saved) return null;
  return async () => {
    const { id: _k, createdAt: _kc, updatedAt: _ku, ...keepRest } = saved.keep;
    const { id: _o, createdAt: _oc, updatedAt: _ou, ...otherRest } = saved.other;
    await update('workouts', keepId, keepRest);
    await update('workouts', otherId, { ...otherRest, deletedAt: null });
  };
}

/** Start a new session with the same exercises (sets, rep ranges, rest) as a logged workout. */
export async function repeatWorkout(src: Workout, exercises: Map<string, Exercise>, history: TrainingHistory, ctx: L.PlanContext): Promise<Workout> {
  const active = await getActiveWorkout();
  if (active) return active;
  const asRoutine: Routine = {
    id: src.routineId ?? 'repeat',
    name: src.name,
    notes: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    exercises: src.exercises.map((e) => ({
      key: newId(),
      exerciseId: e.exerciseId,
      sets: Math.max(1, e.sets.filter((x) => x.kind === 'normal').length),
      warmupSets: e.sets.filter((x) => x.kind === 'warmup').length,
      repMin: e.repMin,
      repMax: e.repMax,
      restSec: e.restSec,
      supersetGroup: e.supersetGroup,
    })),
  };
  const built = L.buildWorkout({ routine: asRoutine, exercises, history, ctx, date: todayISO() });
  return create('workouts', { ...built, routineId: src.routineId });
}

/** Log a workout you did but didn't track; it opens in the editor to add what you did. */
export const logPastWorkout = (date: string, name: string, minutes: number) => create('workouts', L.pastWorkout(date, name, minutes));

/** Fill a logged workout from a routine: its exercises with suggested weights, as done sets (no warm-ups). */
export function fillFromRoutine(wid: string, routine: Routine, exercises: Map<string, Exercise>, history: TrainingHistory, ctx: L.PlanContext) {
  const planned = routine.exercises.flatMap((re) => {
    const ex = exercises.get(re.exerciseId);
    return ex ? [L.planExercise(ex, { ...re, warmupSets: 0 }, history.get(ex.id) ?? [], ctx).exercise] : [];
  });
  return edit(wid, (w) => {
    for (const e of planned) e.sets = e.sets.map((x) => ({ ...x, done: true, completedAt: w.startedAt }));
    w.routineId = routine.id; // the name you typed stays
    return L.appendPlanned(w, planned);
  });
}

/** Name, date, length and notes of a logged workout. */
export const editWorkoutDetails = (wid: string, patch: { name?: string; date?: string; minutes?: number; notes?: string | null }) =>
  edit(wid, (w) => {
    if (patch.name !== undefined) w.name = patch.name.trim() || w.name;
    if (patch.date !== undefined && patch.date !== w.date) {
      // Keep the time of day, move the day.
      const t = new Date(w.startedAt);
      const [y, m, d] = patch.date.split('-').map(Number);
      const moved = new Date(y, m - 1, d, t.getHours(), t.getMinutes()).getTime();
      if (w.endedAt !== null) w.endedAt += moved - w.startedAt;
      w.startedAt = moved;
      w.date = patch.date;
    }
    if (patch.minutes !== undefined && w.endedAt !== null) w.endedAt = w.startedAt + Math.max(1, Math.round(patch.minutes)) * 60_000;
    if (patch.notes !== undefined) w.notes = patch.notes?.trim() || null;
    return w;
  });

/** In a logged workout every set counts as done. */
export const addDoneSet = (wid: string, exId: string, opts: { incrementKg: number; unit: WeightUnit }) =>
  edit(wid, (w) => {
    L.addSet(w, exId, 'normal', opts);
    const ex = w.exercises.find((e) => e.id === exId);
    const last = ex?.sets.at(-1);
    if (last) Object.assign(last, { done: true, completedAt: w.startedAt });
    return w;
  });

/** Add an exercise to a logged workout (sets pre-filled from history, already counted as done). */
export function addDoneExercise(wid: string, exercise: Exercise, history: TrainingHistory, ctx: L.PlanContext) {
  const planned = L.planExercise(exercise, L.DEFAULT_SPEC, history.get(exercise.id) ?? [], ctx).exercise;
  return edit(wid, (w) => {
    planned.sets = planned.sets.filter((s) => s.kind !== 'warmup').map((s) => ({ ...s, done: true, completedAt: w.startedAt }));
    return L.addExercise(w, planned);
  });
}

// ── Routines ─────────────────────────────────────────────────────────────

export async function nextSortOrder(): Promise<number> {
  const last = await db.routines.orderBy('sortOrder').last();
  return (last?.sortOrder ?? -1) + 1;
}

export function routineExercise(exerciseId: string, spec: Partial<L.PlanSpec> = {}): RoutineExercise {
  return { key: newId(), exerciseId, ...L.DEFAULT_SPEC, ...spec };
}

export async function createRoutine(name: string, exercises: RoutineExercise[] = []): Promise<Routine> {
  return create('routines', { name, notes: null, sortOrder: await nextSortOrder(), exercises });
}

export async function createFromTemplate(t: ProgrammeTemplate): Promise<Routine[]> {
  const out: Routine[] = [];
  let order = await nextSortOrder();
  for (const r of t.routines) {
    out.push(
      await create('routines', {
        name: r.name,
        notes: null,
        sortOrder: order++,
        exercises: r.exercises.map((e) =>
          routineExercise(templateExerciseId(e.name), {
            sets: e.sets,
            repMin: e.reps[0],
            repMax: e.reps[1],
            restSec: e.rest,
            warmupSets: e.warmups ?? 0,
          }),
        ),
      }),
    );
  }
  return out;
}

export const saveRoutine = (id: string, patch: Partial<Pick<Routine, 'name' | 'notes' | 'exercises' | 'sortOrder'>>) =>
  update('routines', id, patch);

export const deleteRoutine = (id: string) => remove('routines', id);

// ── Exercises ────────────────────────────────────────────────────────────

export function createExercise(data: Pick<Exercise, 'name' | 'muscle' | 'equipment' | 'bodyweight' | 'incrementKg'>) {
  return create('exercises', { ...data, builtIn: false, archived: false, notes: null });
}
