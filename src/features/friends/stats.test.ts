import { describe, expect, it } from 'vitest';
import type { LocalData } from '../../db/localData';
import type { Exercise, Profile, Workout } from '../../db/types';
import { buildHistory, detectPBs } from '../../lib/calc/training';
import { addDays, startOfWeek } from '../../lib/dates';
import { ALL_SHARED, buildEvents, buildStats, leaderboard, missingReason, type Member, type ShareSettings } from './stats';

const TODAY = '2026-03-12'; // Thursday
const WEEK = startOfWeek(TODAY);
const meta = { createdAt: 1, updatedAt: 1, deletedAt: null };
let n = 0;
const session = (date: string, kg: number, reps = 5): Workout => ({
  id: `w${++n}`, routineId: null, name: 'S', date, startedAt: new Date(date + 'T18:00:00').getTime(), endedAt: new Date(date + 'T19:00:00').getTime(), notes: null, ...meta,
  exercises: [{ id: `e${++n}`, exerciseId: 'bench', supersetGroup: null, restSec: 90, repMin: 5, repMax: 8, target: null, notes: null, sets: [{ id: `s${++n}`, kind: 'normal', weightKg: kg, reps, rpe: null, done: true, completedAt: 1 }] }],
});
const profile = { goal: 'lose', weightUnit: 'kg', calorieTarget: 2000, proteinTarget: 150, carbTarget: null, fatTarget: null, waterTargetMl: 2500, workoutsPerWeek: 2, startWeightKg: 90, targetWeightKg: 80, startDate: '2026-01-01' } as Profile;

function data(): LocalData {
  // Two sessions a week for 3 weeks → a streak; bench goes up this week → PB.
  const finished = [
    session(addDays(WEEK, -14), 60), session(addDays(WEEK, -12), 60),
    session(addDays(WEEK, -7), 62.5), session(addDays(WEEK, -5), 62.5),
    session(WEEK, 65), session(addDays(WEEK, 2), 67.5),
  ];
  const exMap = new Map<string, Exercise>([['bench', { id: 'bench', name: 'Bench press', muscle: 'chest', bodyweight: false } as Exercise]]);
  const history = buildHistory(finished);
  const weights = Array.from({ length: 40 }, (_, i) => ({ id: `wt${i}`, date: addDays(TODAY, -39 + i), weightKg: 88 - i * 0.05, note: null, ...meta }));
  const foodLogs = [0, 1, 2].map((i) => ({ id: `f${i}`, date: addDays(WEEK, i), meal: 'lunch' as const, name: 'x', kcal: i === 2 ? 2600 : 1950, proteinG: 100, carbsG: null, fatG: null, fibreG: null, ...meta }));
  return { profile, weights, finished, exMap, routines: [], history, pbs: detectPBs(history, exMap), foodLogs, water: [], sleep: [], goals: [], measurements: [], today: TODAY };
}

describe('friends summary', () => {
  it('shares every category when all are on — and weight only as percentages', () => {
    const s = buildStats(data(), ALL_SHARED);
    expect(s).toMatchObject({ weekStart: WEEK, days: 4, workouts: { done: 2, target: 2 }, streak: 3, pbs: { week: 2 } });
    expect(s.habit).toBeGreaterThan(0);
    expect(s.calories).toEqual({ daysOnTarget: 2, daysLogged: 3, avgPctOfTarget: 108 });
    expect(s.weight!.goalProgressPct).toBeGreaterThan(20);
    expect(s.weight!.change30Pct).toBeLessThan(0);
    // No kilograms anywhere in what's shared.
    expect(JSON.stringify(s)).not.toMatch(/Kg|kg/);
  });

  it('leaves out anything switched off', () => {
    const share: ShareSettings = { ...ALL_SHARED, weight: false, calories: false, pbs: false };
    const s = buildStats(data(), share);
    expect(s.weight).toBeUndefined();
    expect(s.calories).toBeUndefined();
    expect(s.pbs).toBeUndefined();
    expect(buildEvents(data(), share).some((e) => e.kind === 'pb')).toBe(false);
  });

  it('builds stable feed events', () => {
    const ev = buildEvents(data(), ALL_SHARED);
    const pbs = ev.filter((e) => e.kind === 'pb');
    expect(pbs.length).toBe(3); // last week's 62.5 and this week's 65 + 67.5 (first session is only the baseline)
    expect(pbs[0].data).toMatchObject({ exercise: 'Bench press', weightKg: 67.5, reps: 5, pb: 'weight' });
    expect(ev.find((e) => e.kind === 'week' && e.key === `week:${WEEK}`)).toBeTruthy();
    const streak = ev.find((e) => e.kind === 'streak')!;
    expect(streak.data).toEqual({ weeks: 2 });
    expect(streak.key).toBe(`streak:2:${addDays(WEEK, -14)}`);
    const d = data();
    expect(buildEvents(d, ALL_SHARED).map((e) => e.key)).toEqual(buildEvents(d, ALL_SHARED).map((e) => e.key));
  });
});

describe('leaderboard', () => {
  const base = { weekStart: WEEK, days: 4 };
  const m = (name: string, stats: Member['stats']): Member => ({ userId: name, name, stats, updatedAt: null, me: name === 'Me' });
  const members = [
    m('Me', { ...base, habit: 70, workouts: { done: 3, target: 3 }, streak: 4 }),
    m('Alex', { ...base, habit: 85, workouts: { done: 4, target: 6 }, streak: 4 }),
    m('Sam', { ...base, weekStart: addDays(WEEK, -7), habit: 99, streak: 1 }), // stale week
    m('Jo', null),
  ];

  it('ranks by the metric, with stale weekly stats and non-sharers unranked at the bottom', () => {
    const rows = leaderboard(members, 'habit', WEEK);
    expect(rows.map((r) => [r.member.name, r.rank, r.value])).toEqual([
      ['Alex', 1, '85'],
      ['Me', 2, '70'],
      ['Jo', null, null],
      ['Sam', null, null],
    ]);
  });

  it('compares workouts against each person’s own target', () => {
    expect(leaderboard(members, 'workouts', WEEK).map((r) => [r.member.name, r.rank, r.value]).slice(0, 2)).toEqual([
      ['Me', 1, '3/3'],
      ['Alex', 2, '4/6'],
    ]);
  });

  it('shares ranks on ties; non-weekly metrics ignore the week', () => {
    const rows = leaderboard(members, 'streak', WEEK);
    expect(rows.map((r) => [r.member.name, r.rank])).toEqual([
      ['Alex', 1],
      ['Me', 1],
      ['Sam', 3],
      ['Jo', null],
    ]);
  });

  it('explains why someone is unranked', () => {
    expect(missingReason(members[3], 'habit', WEEK)).toBe('Hasn’t shared yet');
    expect(missingReason(members[2], 'habit', WEEK)).toBe('Not updated this week');
    expect(missingReason(members[0], 'calories', WEEK)).toBe('Not shared');
    expect(missingReason(members[2], 'weight', WEEK)).toBe('Not shared');
  });
});
