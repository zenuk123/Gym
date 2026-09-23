import { describe, expect, it } from 'vitest';
import type { FoodLog, Measurement, Profile, UserGoal, Workout } from '../../db/types';
import { addDays } from '../dates';
import { nutritionSummary, trainingSummary } from './analytics';
import { bodyweightGoal, currentLiftBest, evaluateGoal, frequencyGoal } from './goals';
import { summariseMeasurements } from './measurements';
import { niceTicks, ratePerWeek } from './stats';
import { buildHistory, detectPBs } from './training';
import { monthlyAverages, summariseWeight } from './weight';

const base = { createdAt: 0, updatedAt: 0, deletedAt: null };
const profile = {
  ...base,
  id: 'me',
  startWeightKg: 62,
  targetWeightKg: 70,
  workoutsPerWeek: 4,
  calorieTarget: 3000,
  proteinTarget: 150,
  carbTarget: null,
  fatTarget: null,
} as unknown as Profile;

const measure = (date: string, waistCm: number | null, armsCm: number | null = null): Measurement => ({
  ...base,
  id: date,
  date,
  chestCm: null,
  waistCm,
  armsCm,
  thighsCm: null,
  shouldersCm: null,
  hipsCm: null,
  neckCm: null,
  note: null,
});

let n = 0;
function workout(date: string, exerciseId: string, sets: [number, number][]): Workout {
  const t = new Date(date + 'T10:00:00').getTime();
  return {
    ...base,
    id: `w${++n}`,
    routineId: null,
    name: 'W',
    date,
    startedAt: t,
    endedAt: t + 3_000_000,
    notes: null,
    exercises: [
      {
        id: `e${n}`,
        exerciseId,
        supersetGroup: null,
        restSec: 90,
        repMin: 5,
        repMax: 8,
        target: null,
        notes: null,
        sets: sets.map(([weightKg, reps], i) => ({ id: `s${n}-${i}`, kind: 'normal', weightKg, reps, rpe: null, done: true, completedAt: t })),
      },
    ],
  };
}

describe('stats', () => {
  it('computes a weekly rate only with enough spread', () => {
    expect(ratePerWeek([{ date: '2026-01-01', value: 80 }, { date: '2026-01-15', value: 78 }, { date: '2026-01-08', value: 79 }])).toBeCloseTo(-1);
    expect(ratePerWeek([{ date: '2026-01-01', value: 80 }, { date: '2026-01-02', value: 79 }, { date: '2026-01-03', value: 78 }])).toBeNull();
  });

  it('makes clean axis ticks', () => {
    expect(niceTicks(0, 2900, 4)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(61.3, 63.8, 4)).toEqual([61, 62, 63, 64]);
  });
});

describe('measurements', () => {
  it('summarises each site independently, skipping missing readings', () => {
    const s = summariseMeasurements([measure('2026-01-01', 82, 34), measure('2026-01-15', null, 35), measure('2026-02-01', 80)]);
    const waist = s.find((x) => x.site === 'waist')!;
    const arms = s.find((x) => x.site === 'arms')!;
    expect(waist).toMatchObject({ count: 2, sinceFirst: -2, change: -2 });
    expect(arms).toMatchObject({ count: 2, sinceFirst: 1 });
    expect(s.map((x) => x.site)).toEqual(['waist', 'arms']);
  });
});

describe('goals', () => {
  const today = '2026-03-01';

  it('evaluates the body-weight goal with a projected finish', () => {
    const weights = Array.from({ length: 21 }, (_, i) => ({ date: addDays('2026-02-08', i), weightKg: 64 + i * (0.5 / 7) }));
    const g = bodyweightGoal(profile, summariseWeight(weights, 62, 70), today)!;
    expect(g.progress).toBeGreaterThan(0.25);
    expect(g.ratePerWeek).toBeCloseTo(0.5, 1);
    expect(g.eta).not.toBeNull();
    expect(g.achieved).toBe(false);
  });

  it('counts this week’s sessions for the frequency goal', () => {
    const g = frequencyGoal(profile, [workout('2026-02-23', 'bench', [[60, 5]]), workout('2026-02-25', 'bench', [[60, 5]])], today);
    expect(g).toMatchObject({ current: 2, target: 4, progress: 0.5, achieved: false });
  });

  it('tracks a lift goal from best-ever and records when it was hit', () => {
    const history = buildHistory([
      workout('2026-01-05', 'bench', [[80, 5]]),
      workout('2026-01-20', 'bench', [[90, 3]]),
      workout('2026-02-10', 'bench', [[100, 1]]),
      workout('2026-02-20', 'bench', [[95, 3]]),
    ]);
    const goal: UserGoal = { ...base, id: 'g', kind: 'lift', exerciseId: 'bench', metric: 'weight', site: null, startValue: 80, targetValue: 100, startDate: '2026-01-01', targetDate: null, archived: false };
    const s = evaluateGoal(goal, { history, measurements: [], today });
    expect(s).toMatchObject({ current: 100, achieved: true, achievedOn: '2026-02-10', progress: 1 });
    expect(currentLiftBest(history, 'bench', 'weight')).toBe(100);
  });

  it('handles decreasing measurement goals', () => {
    const goal: UserGoal = { ...base, id: 'w', kind: 'measurement', exerciseId: null, metric: null, site: 'waist', startValue: 84, targetValue: 80, startDate: '2026-01-01', targetDate: '2026-06-01', archived: false };
    const ms = [measure('2026-01-01', 84), measure('2026-01-22', 83), measure('2026-02-12', 82)];
    const s = evaluateGoal(goal, { history: new Map(), measurements: ms, today });
    expect(s.progress).toBeCloseTo(0.5);
    expect(s.ratePerWeek).toBeGreaterThan(0); // moving toward the goal
    expect(s.requiredPerWeek).not.toBeNull();
  });
});

describe('analytics', () => {
  it('summarises training over a range including empty weeks', () => {
    const ws = [workout('2026-02-02', 'bench', [[60, 8], [60, 8]]), workout('2026-02-16', 'bench', [[65, 8]])];
    const exMap = new Map([['bench', { id: 'bench', muscle: 'chest', bodyweight: false } as never]]);
    const s = trainingSummary({ finished: ws, exMap, pbs: detectPBs(buildHistory(ws)), from: '2026-02-01', to: '2026-02-28' });
    expect(s.workouts).toBe(2);
    expect(s.sets).toBe(3);
    expect(s.weeks.map((w) => w.workouts)).toEqual([0, 1, 0, 1, 0]); // weeks starting 26 Jan, 2, 9, 16, 23 Feb
    expect(s.muscleSets).toEqual([{ muscle: 'chest', sets: 3 }]);
    expect(s.lifts[0].changePct).toBeCloseTo(8.3, 1);
    expect(s.pbs).toBeGreaterThan(0);
  });

  it('summarises nutrition: averages over logged days only', () => {
    const log = (date: string, kcal: number, proteinG: number, carbsG: number | null = null, fatG: number | null = null): FoodLog => ({
      ...base,
      id: `${date}${kcal}`,
      date,
      meal: 'lunch',
      name: 'x',
      kcal,
      proteinG,
      carbsG,
      fatG,
      fibreG: null,
    });
    const s = nutritionSummary({
      logs: [log('2026-02-01', 2900, 150, 300, 100), log('2026-02-03', 2000, 100)],
      water: [],
      profile,
      from: '2026-02-01',
      to: '2026-02-07',
    });
    expect(s.daysInRange).toBe(7);
    expect(s.daysLogged).toBe(2);
    expect(s.avgKcal).toBe(2450);
    expect(s.kcalOnTarget).toBe(1);
    expect(s.proteinHit).toBe(1);
    expect(s.macroSplit!.protein).toBeCloseTo(600 / 2700);
  });

  it('averages weight by calendar month', () => {
    expect(monthlyAverages([{ date: '2026-01-30', weightKg: 60 }, { date: '2026-02-01', weightKg: 61 }, { date: '2026-02-02', weightKg: 63 }])).toEqual([
      { month: '2026-02', avg: 62, n: 2 },
      { month: '2026-01', avg: 60, n: 1 },
    ]);
  });
});
