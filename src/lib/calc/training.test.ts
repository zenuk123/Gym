import { describe, expect, it } from 'vitest';
import type { Routine, SetKind, Workout } from '../../db/types';
import { addDays } from '../dates';
import {
  buildHistory,
  detectPBs,
  e1rm,
  estimateMinutes,
  nextRoutine,
  stepWeight,
  suggestNext,
  weekStreak,
  recordWorkouts,
  exerciseBests,
  finishedWorkoutsInWeek,
  workoutStats,
} from './training';

let n = 0;
type S = [weight: number, reps: number, kind?: SetKind, rpe?: number | null];

function workout(date: string, exercises: Record<string, S[]>, extra: Partial<Workout> = {}): Workout {
  const startedAt = new Date(date + 'T10:00:00').getTime();
  return {
    id: `w${++n}`,
    routineId: null,
    name: 'Session',
    date,
    startedAt,
    endedAt: startedAt + 3_600_000,
    notes: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({
      id: `we${++n}`,
      exerciseId,
      supersetGroup: null,
      restSec: 90,
      repMin: 6,
      repMax: 8,
      target: null,
      notes: null,
      sets: sets.map(([weightKg, reps, kind = 'normal', rpe = null]) => ({
        id: `s${++n}`,
        kind,
        weightKg,
        reps,
        rpe,
        done: true,
        completedAt: startedAt,
      })),
    })),
    ...extra,
  };
}

const fmt = (kg: number) => `${kg} kg`;

describe('basics', () => {
  it('estimates 1RM with Epley', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(60, 8)).toBeCloseTo(76);
    expect(e1rm(60, 0)).toBe(0);
  });

  it('ignores warm-ups and unfinished sets in stats', () => {
    const w = workout('2026-01-01', { bench: [[20, 10, 'warmup'], [60, 8], [60, 7]] });
    w.exercises[0].sets.push({ id: 'x', kind: 'normal', weightKg: 60, reps: 6, rpe: null, done: false, completedAt: null });
    const s = workoutStats(w);
    expect(s.sets).toBe(2);
    expect(s.volumeKg).toBe(900);
    expect(s.durationMin).toBe(60);
  });

  it('steps weights in the user’s unit', () => {
    expect(stepWeight(60, 1, 2.5, 'kg')).toBe(62.5);
    // 150 lb + 5 lb
    const kg150 = 150 * 0.45359237;
    expect(stepWeight(kg150, 1, 2.5, 'lb') / 0.45359237).toBeCloseTo(155);
  });
});

describe('PB detection', () => {
  it('needs a baseline: the first session is never a PB', () => {
    const h = buildHistory([workout('2026-01-01', { bench: [[60, 8]] })]);
    expect(detectPBs(h)).toEqual([]);
  });

  it('detects a weight PB with the previous best', () => {
    const h = buildHistory([workout('2026-01-01', { bench: [[60, 8]] }), workout('2026-01-04', { bench: [[62.5, 8]] })]);
    const pbs = detectPBs(h);
    const weight = pbs.find((p) => p.kind === 'weight')!;
    expect(weight).toMatchObject({ weightKg: 62.5, reps: 8, previous: { weightKg: 60, reps: 8 } });
    // same set isn't double-counted as a rep or e1RM PB
    expect(pbs.filter((p) => p.kind === 'reps' || p.kind === 'e1rm')).toEqual([]);
  });

  it('detects a rep PB at the same weight', () => {
    const h = buildHistory([workout('2026-01-01', { bench: [[60, 6]] }), workout('2026-01-04', { bench: [[60, 8]] })]);
    const kinds = detectPBs(h).map((p) => p.kind).sort();
    expect(kinds).toEqual(['e1rm', 'reps', 'volume']);
  });

  it('finds no PB for fewer reps at a lighter weight', () => {
    const h = buildHistory([workout('2026-01-01', { bench: [[60, 8]] }), workout('2026-01-04', { bench: [[50, 7]] })]);
    expect(detectPBs(h)).toEqual([]);
  });

  it('ignores warm-ups', () => {
    const h = buildHistory([
      workout('2026-01-01', { bench: [[60, 8]] }),
      workout('2026-01-04', { bench: [[100, 1, 'warmup'], [60, 8]] }),
    ]);
    expect(detectPBs(h)).toEqual([]);
  });
});

describe('progressive overload', () => {
  const hist = (...ws: Workout[]) => buildHistory(ws).get('bench') ?? [];
  const base = { repMin: 6, repMax: 8, incrementKg: 2.5, unit: 'kg' as const, fmt };

  it('suggests more weight after hitting the top of the range on every set', () => {
    const s = suggestNext({ ...base, sessions: hist(workout('2026-01-01', { bench: [[60, 8], [60, 8], [60, 8]] })) });
    expect(s).toMatchObject({ kind: 'increase', weightKg: 62.5 });
  });

  it('keeps the weight and asks for reps when still inside the range', () => {
    const s = suggestNext({ ...base, sessions: hist(workout('2026-01-01', { bench: [[60, 8], [60, 7], [60, 6]] })) });
    expect(s).toMatchObject({ kind: 'reps', weightKg: 60 });
  });

  it('holds back when the top-end sets were a grind', () => {
    const s = suggestNext({ ...base, sessions: hist(workout('2026-01-01', { bench: [[60, 8, 'normal', 10], [60, 8, 'normal', 9.5]] })) });
    expect(s.kind).toBe('repeat');
  });

  it('deloads ~10% after missing the range twice', () => {
    const s = suggestNext({
      ...base,
      sessions: hist(workout('2026-01-01', { bench: [[80, 5], [80, 4]] }), workout('2026-01-04', { bench: [[80, 5], [80, 4]] })),
    });
    expect(s).toMatchObject({ kind: 'deload', weightKg: 72.5 });
  });

  it('handles a brand new exercise', () => {
    expect(suggestNext({ ...base, sessions: [] })).toMatchObject({ kind: 'new', weightKg: null });
  });
});

describe('scheduling & consistency', () => {
  const routine = (id: string, sortOrder: number): Routine => ({
    id,
    name: id,
    notes: null,
    sortOrder,
    exercises: [{ key: 'k', exerciseId: 'bench', sets: 3, warmupSets: 1, repMin: 6, repMax: 8, restSec: 120, supersetGroup: null }],
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  });

  it('rotates to the routine after the last one done', () => {
    const rs = [routine('push', 0), routine('pull', 1), routine('legs', 2)];
    expect(nextRoutine(rs, [])!.id).toBe('push');
    expect(nextRoutine(rs, [workout('2026-01-01', {}, { routineId: 'pull' })])!.id).toBe('legs');
    expect(nextRoutine(rs, [workout('2026-01-01', {}, { routineId: 'legs' })])!.id).toBe('push');
  });

  it('honours a reset until the next routine workout is finished', () => {
    const rs = [routine('push', 0), routine('pull', 1), routine('legs', 2)];
    const pull = workout('2026-01-01', {}, { routineId: 'pull' });
    const reset = { routineId: 'push', setAt: pull.startedAt + 1 };
    expect(nextRoutine(rs, [pull])!.id).toBe('legs');
    expect(nextRoutine(rs, [pull], reset)!.id).toBe('push');
    // After doing push (started later than the reset), rotation continues normally.
    const push = workout('2026-01-02', {}, { routineId: 'push' });
    expect(nextRoutine(rs, [pull, push], reset)!.id).toBe('pull');
    // A reset pointing at a deleted routine is ignored.
    expect(nextRoutine(rs, [pull], { routineId: 'gone', setAt: pull.startedAt + 1 })!.id).toBe('legs');
  });

  it('estimates session length', () => {
    expect(estimateMinutes(routine('a', 0))).toBe(10); // 3×160s + 60s = 9 min → 10
  });

  it('counts week streaks without breaking on the week in progress', () => {
    const today = '2026-01-21'; // Wednesday
    const mondays = ['2026-01-05', '2026-01-12'];
    const ws = mondays.flatMap((m) => [0, 2, 4].map((d) => workout(addDays(m, d), {})));
    expect(weekStreak(ws, 3, today)).toBe(2);
    expect(weekStreak([...ws, ...[0, 1, 2].map((d) => workout(addDays('2026-01-19', d), {}))], 3, today)).toBe(3);
    expect(weekStreak(ws, 4, today)).toBe(0);
  });
});

describe('live PB check', () => {
  it('flags a heavier set as a weight PB with the previous best', async () => {
    const { checkSetPB } = await import('./training');
    expect(checkSetPB({ weightKg: 62.5, reps: 8 }, [{ weightKg: 60, reps: 8 }])).toEqual({ kind: 'weight', previous: { weightKg: 60, reps: 8 } });
    expect(checkSetPB({ weightKg: 60, reps: 9 }, [{ weightKg: 60, reps: 8 }])!.kind).toBe('reps');
    expect(checkSetPB({ weightKg: 60, reps: 8 }, [{ weightKg: 60, reps: 8 }])).toBeNull();
    expect(checkSetPB({ weightKg: 60, reps: 8 }, [])).toBeNull();
  });
});

describe('personal records logged on their own', () => {
  const rec = (id: string, date: string, weightKg: number, reps: number) => ({ id, exerciseId: 'ex-bench-press', date, weightKg, reps, createdAt: 1, deletedAt: null as number | null });
  const ses = (id: string, date: string, sets: [number, number][]): Workout => ({
    id, routineId: 'r', name: 'Push', date, startedAt: Date.parse(`${date}T18:00:00`), endedAt: Date.parse(`${date}T19:00:00`), notes: null, createdAt: 1, updatedAt: 1, deletedAt: null,
    exercises: [{ id: id + 'e', exerciseId: 'ex-bench-press', supersetGroup: null, restSec: 90, repMin: 6, repMax: 8, target: null, notes: null,
      sets: sets.map(([kg, reps], i) => ({ id: `${id}-${i}`, kind: 'normal' as const, weightKg: kg, reps, rpe: null, done: true, completedAt: 0 })) }],
  });

  it('become one-set sessions that count for PBs but are not workouts', () => {
    const workouts = [ses('w1', '2026-09-01', [[80, 5], [80, 5]])];
    const records = [rec('r1', '2026-09-10', 90, 3), { ...rec('r2', '2026-09-11', 200, 1), deletedAt: 5 }];
    const history = buildHistory([...workouts, ...recordWorkouts(records)]);
    expect(history.get('ex-bench-press')!.map((s) => s.workoutId)).toEqual(['w1', 'r1']); // deleted one ignored
    const pbs = detectPBs(history);
    expect(pbs.map((p) => [p.kind, p.workoutId, p.weightKg])).toContainEqual(['weight', 'r1', 90]);
    expect(finishedWorkoutsInWeek(workouts, '2026-09-07')).toHaveLength(0); // records live outside `finished`
  });

  it('exerciseBests: heaviest, e1RM and rep maxes across workouts and records', () => {
    const history = buildHistory([ses('w1', '2026-09-01', [[80, 8], [85, 5]]), ...recordWorkouts([rec('r1', '2026-09-10', 100, 1)])]);
    const b = exerciseBests(history.get('ex-bench-press')!);
    expect(b.heaviest).toEqual({ weightKg: 100, reps: 1, date: '2026-09-10' });
    expect(b.repMaxes[1]!.weightKg).toBe(100);
    expect(b.repMaxes[3]!.weightKg).toBe(85);
    expect(b.repMaxes[5]!.weightKg).toBe(85);
    expect(b.repMaxes[8]!.weightKg).toBe(80);
    expect(b.repMaxes[10]).toBeNull();
    expect(Math.round(b.e1rm!.value)).toBe(101); // 80 × 8 → 101.3 beats 100 × 1
    expect(b.lastImproved).toBe('2026-09-10');
  });

  it('a PR logged later the same day comes after that day’s workout (so it is the PR, not the baseline)', () => {
    const w = ses('w1', '2026-09-01', [[80, 5]]);
    const r = { ...rec('r1', '2026-09-01', 90, 3), createdAt: Date.parse('2026-09-01T21:30:00') };
    const pbs = detectPBs(buildHistory([w, ...recordWorkouts([r])]));
    expect(pbs.map((p) => [p.kind, p.workoutId])).toEqual([['weight', 'r1']]);
  });
});
