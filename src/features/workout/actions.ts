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
