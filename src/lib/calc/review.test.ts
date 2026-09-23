import { describe, expect, it } from 'vitest';
import type { FoodLog, Profile, WaterLog, WeightEntry, Workout } from '../../db/types';
import { addDays } from '../dates';
import { reviewText, weeklyReview } from './review';

const profile = {
  goal: 'lose',
  weightUnit: 'kg',
  calorieTarget: 2000,
  proteinTarget: 150,
  carbTarget: null,
  fatTarget: null,
  waterTargetMl: 2500,
  workoutsPerWeek: 3,
  startWeightKg: 90,
  targetWeightKg: 80,
} as Profile;

const WEEK = '2026-03-02'; // Monday
let n = 0;
const meta = { createdAt: 1, updatedAt: 1, deletedAt: null };
const food = (date: string, kcal: number, proteinG: number): FoodLog => ({ id: `f${++n}`, date, meal: 'lunch', name: 'x', kcal, proteinG, carbsG: 0, fatG: 0, fibreG: null, ...meta });
const weigh = (date: string, weightKg: number): WeightEntry => ({ id: `wt${++n}`, date, weightKg, note: null, ...meta });
const drink = (date: string, ml: number): WaterLog => ({ id: `wa${++n}`, date, ml, ...meta });
const session = (date: string): Workout => ({
  id: `w${++n}`,
  routineId: null,
  name: 'S',
  date,
  startedAt: 1,
  endedAt: 2,
  notes: null,
  ...meta,
  exercises: [{ id: `e${++n}`, exerciseId: 'bench', supersetGroup: null, restSec: 90, repMin: 8, repMax: 10, target: null, notes: null, sets: [{ id: `s${++n}`, kind: 'normal', weightKg: 60, reps: 10, rpe: null, done: true, completedAt: 1 }] }],
});

const days = (k: number) => Array.from({ length: k }, (_, i) => addDays(WEEK, i));

describe('weeklyReview', () => {
  it('celebrates a good week with facts', () => {
    const r = weeklyReview({
      profile,
      weekStart: WEEK,
      finished: [session(WEEK), session(addDays(WEEK, 2)), session(addDays(WEEK, 4)), session(addDays(WEEK, -3))],
      pbs: [],
      weights: [...days(7).map((d) => weigh(addDays(d, -7), 90)), ...days(7).map((d) => weigh(d, 89.5))],
      foodLogs: days(7).map((d) => food(d, 1950, 160)),
      water: days(7).map((d) => drink(d, 2600)),
      sleep: [],
    });
    expect(r.training.workouts).toBe(3);
    expect(r.training.volumeKg).toBe(1800);
    expect(r.training.prevVolumeKg).toBe(600);
    expect(r.weight.changeKg).toBeCloseTo(-0.5);
    expect(r.score).toBe(100);
    expect(r.wins.map((w) => w.text).join(' ')).toMatch(/training target/);
    expect(r.wins.some((w) => /towards your goal/.test(w.text))).toBe(true);
    expect(r.focus).toHaveLength(0);
  });

  it('suggests (never changes) focus areas for a weak week', () => {
    const r = weeklyReview({
      profile,
      weekStart: WEEK,
      finished: [session(WEEK)],
      pbs: [],
      weights: [weigh(addDays(WEEK, -3), 88), weigh(addDays(WEEK, 3), 88.6)],
      foodLogs: days(3).map((d) => food(d, 2400, 90)),
      water: [],
      sleep: [],
    });
    expect(r.focus.length).toBeGreaterThan(0);
    expect(r.focus.length).toBeLessThanOrEqual(3);
    expect(r.focus.every((f) => f.kind === 'suggestion')).toBe(true);
    expect(r.focus[0].text).toMatch(/2 workouts short/);
    expect(r.focus.map((f) => f.text).join(' ')).toMatch(/Protein averaged 60 g\/day under/);
    expect(r.score).toBeLessThan(40);
    expect(reviewText(r, profile)).toMatch(/Workouts: 1\/3/);
  });

  it('only counts elapsed days for a week in progress', () => {
    const r = weeklyReview({ profile, weekStart: WEEK, finished: [], pbs: [], weights: [], foodLogs: days(2).map((d) => food(d, 2000, 150)), water: [], sleep: [], elapsedDays: 2 });
    expect(r.nutrition.daysInRange).toBe(2);
    expect(r.scoreParts.find((p) => p.label === 'Days food logged')).toEqual({ label: 'Days food logged', hit: 2, of: 2 });
    // No "you missed workouts" nag mid-week.
    expect(r.focus.some((f) => /short of/.test(f.text))).toBe(false);
  });
});
