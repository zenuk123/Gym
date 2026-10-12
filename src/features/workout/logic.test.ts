import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { BUILT_IN_EXERCISES, builtInId, seedExercises } from '../../db/seed/exercises';
import { TEMPLATES, templateExerciseId } from '../../db/seed/templates';
import type { Exercise, Workout } from '../../db/types';
import { buildHistory } from '../../lib/calc/training';
import * as A from './actions';
import * as L from './logic';

const ctx = { unit: 'kg' as const, fmt: (kg: number) => `${kg} kg` };
const exMap = new Map<string, Exercise>(BUILT_IN_EXERCISES.map((e) => [e.id, e]));
const bench = exMap.get(builtInId('Bench Press'))!;
const row = exMap.get(builtInId('Barbell Row'))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('library & templates', () => {
  it('seeds the library idempotently, without queueing uploads', async () => {
    expect(await seedExercises()).toBe(BUILT_IN_EXERCISES.length);
    expect(await seedExercises()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('only references exercises that exist in the library', () => {
    const missing = TEMPLATES.flatMap((t) => t.routines.flatMap((r) => r.exercises)).filter((e) => !exMap.has(templateExerciseId(e.name)));
    expect(missing).toEqual([]);
  });

  it('has unique ids', () => {
    expect(new Set(BUILT_IN_EXERCISES.map((e) => e.id)).size).toBe(BUILT_IN_EXERCISES.length);
  });
});

describe('planning a session', () => {
  it('pre-fills the suggested weight and warm-ups from history', async () => {
    await seedExercises();
    const [push] = await A.createFromTemplate(TEMPLATES[0]);
    const w1 = await A.startWorkout({ routine: push, exercises: exMap, history: new Map(), ctx });
    // First time: no weight suggestion.
    expect(w1.exercises[0].target).toBeNull();

    // Log 60 × 8,8,8 on bench and finish.
    const benchEx = w1.exercises[0];
    for (const s of benchEx.sets) {
      await A.setField(w1.id, benchEx.id, s.id, { weightKg: 60, reps: 8 });
      await A.completeSet(w1.id, benchEx.id, s.id);
    }
    await A.finishWorkout(w1.id, null);

    const history = buildHistory(await db.workouts.toArray());
    const w2 = await A.startWorkout({ routine: push, exercises: exMap, history, ctx });
    const b = w2.exercises[0];
    expect(b.target).toEqual({ weightKg: 62.5, repMin: 6, repMax: 8 });
    const working = b.sets.filter((s) => s.kind === 'normal');
    expect(working.map((s) => [s.weightKg, s.reps])).toEqual([
      [62.5, 6],
      [62.5, 6],
      [62.5, 6],
    ]);
    // Two warm-ups, never below the empty bar.
    expect(b.sets.filter((s) => s.kind === 'warmup').map((s) => s.weightKg)).toEqual([32.5, 47.5]);
  });

  it('only allows one active workout', async () => {
    const a = await A.startWorkout({ routine: null, exercises: exMap, history: new Map(), ctx });
    const b = await A.startWorkout({ routine: null, exercises: exMap, history: new Map(), ctx });
    expect(b.id).toBe(a.id);
  });

  it('never loses a tap when sets are completed in quick succession', async () => {
    const w = await A.startWorkout({ routine: null, exercises: exMap, history: new Map(), ctx });
    await A.addExerciseToWorkout(w.id, bench, new Map(), ctx);
    const ex = (await db.workouts.get(w.id))!.exercises[0];
    await Promise.all(ex.sets.map((s) => A.completeSet(w.id, ex.id, s.id)));
    expect((await db.workouts.get(w.id))!.exercises[0].sets.every((s) => s.done)).toBe(true);
  });

  it('stepper taps each count, even before the previous save is visible', async () => {
    const w = await A.startWorkout({ routine: null, exercises: exMap, history: new Map(), ctx });
    await A.addExerciseToWorkout(w.id, bench, new Map(), ctx);
    const ex = (await db.workouts.get(w.id))!.exercises[0];
    const set = ex.sets[0];
    // A typed weight saved, then three quick "+2.5" taps — none of them reads stale UI state.
    void A.setField(w.id, ex.id, set.id, { weightKg: 60 });
    await Promise.all([1, 2, 3].map(() => A.editSet(w.id, ex.id, set.id, (s) => ({ weightKg: s.weightKg + 2.5, reps: s.reps + 1 }))));
    const after = (await db.workouts.get(w.id))!.exercises[0].sets[0];
    expect(after.weightKg).toBe(67.5);
    expect(after.reps).toBe(set.reps + 3);
  });

  it('finishing drops unfinished sets and empty exercises', async () => {
    const w = await A.startWorkout({ routine: null, exercises: exMap, history: new Map(), ctx });
    await A.addExerciseToWorkout(w.id, bench, new Map(), ctx);
    await A.addExerciseToWorkout(w.id, row, new Map(), ctx);
    const ex = (await db.workouts.get(w.id))!.exercises[0];
    await A.completeSet(w.id, ex.id, ex.sets[0].id);
    const done = (await A.finishWorkout(w.id, 'good'))!;
    expect(done.endedAt).not.toBeNull();
    expect(done.exercises).toHaveLength(1);
    expect(done.exercises[0].sets).toHaveLength(1);
  });
});

describe('gym mode flow', () => {
  function session(groups: (string | null)[], setsPer = 2): Workout {
    const w = L.buildWorkout({ routine: null, exercises: exMap, history: new Map(), ctx, date: '2026-01-01' }) as Workout;
    w.exercises = groups.map((g) => ({
      ...L.planExercise(bench, { ...L.DEFAULT_SPEC, sets: setsPer, supersetGroup: g }, [], ctx).exercise,
    }));
    return w;
  }
  const complete = (w: Workout, i: number) => {
    const ex = w.exercises[i];
    L.completeSet(w, ex.id, ex.sets[L.pendingSetIndex(ex)].id);
  };

  it('rests between straight sets, then moves on', () => {
    const w = session([null, null]);
    complete(w, 0);
    expect(L.afterSetCompleted(w, 0)).toEqual({ index: 0, rest: true });
    complete(w, 0);
    expect(L.afterSetCompleted(w, 0)).toEqual({ index: 1, rest: true });
  });

  it('alternates superset exercises and rests after the pair', () => {
    const w = session(['a', 'a', null]);
    complete(w, 0);
    expect(L.afterSetCompleted(w, 0)).toEqual({ index: 1, rest: false });
    complete(w, 1);
    expect(L.afterSetCompleted(w, 1)).toEqual({ index: 0, rest: true });
    complete(w, 0);
    complete(w, 1);
    expect(L.afterSetCompleted(w, 1)).toEqual({ index: 2, rest: true });
  });

  it('goes straight into a drop set', () => {
    const w = session([null], 1);
    L.addSet(w, w.exercises[0].id, 'drop', { incrementKg: 2.5, unit: 'kg' });
    complete(w, 0);
    expect(L.afterSetCompleted(w, 0)).toEqual({ index: 0, rest: false });
  });
});

describe('combining workouts', () => {
  const mk = (id: string, name: string, startedAt: number, minutes: number, exs: [string, number[]][], routineId: string | null = null): Workout => ({
    id, name, routineId, date: '2026-10-12', startedAt, endedAt: startedAt + minutes * 60_000, notes: null, createdAt: 1, updatedAt: 1, deletedAt: null,
    exercises: exs.map(([exerciseId, ws], i) => ({ id: `${id}-e${i}`, exerciseId, supersetGroup: null, restSec: 90, repMin: 8, repMax: 12, target: null, notes: null,
      sets: ws.map((kg, k) => ({ id: `${id}-${i}-${k}`, kind: 'normal' as const, weightKg: kg, reps: 8, rpe: null, done: true, completedAt: startedAt })) })),
  });

  it('merges two sessions: joins shared exercises, adds durations, keeps the earlier start', () => {
    const am = mk('a', 'Push', Date.parse('2026-10-12T07:00:00'), 40, [['ex-bench-press', [60, 60]], ['ex-lateral-raise', [8]]], 'r-push');
    const pm = mk('b', 'Abs', Date.parse('2026-10-12T18:00:00'), 20, [['ex-bench-press', [62.5]], ['ex-plank', [0, 0]]]);
    const m = L.mergeWorkouts(pm, am); // order doesn't matter
    expect(m.id).toBe('b');
    expect(m.name).toBe('Push + Abs');
    expect(m.routineId).toBe('r-push'); // the later session has no routine, so the earlier one's counts
    expect(L.mergeWorkouts(am, { ...pm, routineId: 'r-abs' }).routineId).toBe('r-abs');
    expect(m.startedAt).toBe(am.startedAt);
    expect((m.endedAt! - m.startedAt) / 60_000).toBe(60);
    expect(m.exercises.map((e) => e.exerciseId)).toEqual(['ex-bench-press', 'ex-lateral-raise', 'ex-plank']);
    expect(m.exercises[0].sets.map((s) => s.weightKg)).toEqual([60, 60, 62.5]);
    expect(am.exercises[0].sets).toHaveLength(2); // inputs untouched
  });

  it('combines routines without repeating exercises, and keeps supersets apart', () => {
    const r = (id: string, name: string, ids: string[], group: string | null = null): import('../../db/types').Routine => ({
      id, name, notes: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null,
      exercises: ids.map((exerciseId) => ({ key: exerciseId, exerciseId, sets: 3, warmupSets: 0, repMin: 8, repMax: 12, restSec: 60, supersetGroup: group })),
    });
    const c = L.combineRoutines([r('p', 'Push', ['ex-a', 'ex-b'], 'g1'), r('c', 'Core', ['ex-b', 'ex-c', 'ex-d'], 'g1')])!;
    expect(c.name).toBe('Push + Core');
    expect(c.id).toBe('c'); // rotation continues after the last routine
    expect(c.exercises.map((e) => e.exerciseId)).toEqual(['ex-a', 'ex-b', 'ex-c', 'ex-d']);
    expect(c.exercises[0].supersetGroup).not.toBe(c.exercises[2].supersetGroup); // was the same id in both routines
    expect(L.combinedName(['Workout', 'Workout'])).toBe('Workout');
  });

  it('offers same-day workouts first when merging', () => {
    const w = mk('w', 'A', Date.parse('2026-10-12T10:00:00'), 30, []);
    const other = { ...mk('x', 'B', Date.parse('2026-10-11T10:00:00'), 30, []), date: '2026-10-11' };
    const same = mk('y', 'C', Date.parse('2026-10-12T07:00:00'), 30, []);
    expect(L.mergeCandidates(w, [w, other, same]).map((x) => x.id)).toEqual(['y', 'x']);
  });

  it('merge in the database is undoable', async () => {
    const a = await db.workouts.add(mk('a1', 'Push', Date.parse('2026-10-12T07:00:00'), 40, [['ex-bench-press', [60]]]));
    const b = await db.workouts.add(mk('b1', 'Pull', Date.parse('2026-10-12T08:00:00'), 30, [['ex-barbell-row', [50]]]));
    const undo = await A.mergeWorkoutsInto(a, b);
    expect((await db.workouts.get(a))!.exercises).toHaveLength(2);
    expect((await db.workouts.get(b))!.deletedAt).not.toBeNull();
    await undo!();
    expect((await db.workouts.get(a))!.exercises).toHaveLength(1);
    expect((await db.workouts.get(a))!.name).toBe('Push');
    expect((await db.workouts.get(b))!.deletedAt).toBeNull();
  });

  it('logs a past workout and edits its details', async () => {
    const w = await A.logPastWorkout('2026-10-10', 'Legs', 50);
    expect(w.endedAt! - w.startedAt).toBe(50 * 60_000);
    await A.addDoneExercise(w.id, bench, new Map(), ctx);
    await A.editWorkoutDetails(w.id, { date: '2026-10-09', minutes: 65, name: 'Leg day' });
    const after = (await db.workouts.get(w.id))!;
    expect(after).toMatchObject({ date: '2026-10-09', name: 'Leg day' });
    expect(new Date(after.startedAt).getDate()).toBe(9);
    expect((after.endedAt! - after.startedAt) / 60_000).toBe(65);
    expect(after.exercises[0].sets.every((s) => s.done)).toBe(true);
    expect(buildHistory([after]).get(bench.id)).toHaveLength(1);
  });
});

describe('gym conveniences', () => {
  it('carries a completed weight to the empty sets after it (same type only)', () => {
    const sets = (['warmup', 'warmup', 'normal', 'normal', 'normal'] as const).map((kind, i) => ({ id: `s${i}`, kind, weightKg: 0, reps: 8, rpe: null, done: false, completedAt: null }));
    const w: Workout = { id: 'w', name: 'W', routineId: null, date: '2026-10-12', startedAt: 0, endedAt: null, notes: null, createdAt: 1, updatedAt: 1, deletedAt: null,
      exercises: [{ id: 'e', exerciseId: 'ex-bench-press', supersetGroup: null, restSec: 90, repMin: 6, repMax: 8, target: null, notes: null, sets }] };
    sets[0].weightKg = 40;
    L.completeSet(w, 'e', 's0');
    expect(w.exercises[0].sets.map((s) => s.weightKg)).toEqual([40, 40, 0, 0, 0]);
    w.exercises[0].sets[2].weightKg = 80;
    w.exercises[0].sets[4].weightKg = 70; // already set by hand — left alone
    L.completeSet(w, 'e', 's2');
    expect(w.exercises[0].sets.map((s) => s.weightKg)).toEqual([40, 40, 80, 80, 70]);
  });

  it('finds exercises by gym shorthand', () => {
    expect(L.matchesExercise('Dumbbell Bench Press', 'db bench')).toBe(true);
    expect(L.matchesExercise('Overhead Press', 'ohp')).toBe(true);
    expect(L.matchesExercise('Romanian Deadlift', 'RDL')).toBe(true);
    expect(L.matchesExercise('Pull-up', 'pullup')).toBe(true);
    expect(L.matchesExercise('Pull-up', 'pull up')).toBe(true);
    expect(L.matchesExercise('Bench Press', 'squat')).toBe(false);
  });
});
