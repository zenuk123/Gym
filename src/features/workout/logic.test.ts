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
