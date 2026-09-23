import type { Exercise, FoodLog, ISODate, MuscleGroup, Profile, WaterLog, Workout } from '../../db/types';
import { addDays, daysBetween, startOfWeek } from '../dates';
import { macroTargets } from '../intake';
import { mean } from './stats';
import { e1rm, workingSets, workoutStats, type PersonalBest } from './training';

// Aggregations for the analytics screens. Pure functions over date ranges (inclusive).

const inRange = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;

// ── Training ─────────────────────────────────────────────────────────────

export interface WeekBucket {
  weekStart: ISODate;
  workouts: number;
  sets: number;
  volumeKg: number;
}

export interface LiftTrend {
  exerciseId: string;
  sessions: number;
  firstE1rm: number;
  latestE1rm: number;
  changePct: number;
  points: { date: ISODate; value: number }[];
}

export interface TrainingSummary {
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
  avgMinutes: number | null;
  pbs: number;
  weeks: WeekBucket[];
  muscleSets: { muscle: MuscleGroup; sets: number }[];
  lifts: LiftTrend[];
}

export function trainingSummary(opts: {
  finished: Workout[];
  exMap: Map<string, Exercise>;
  pbs: PersonalBest[];
  from: ISODate;
  to: ISODate;
}): TrainingSummary {
  const { finished, exMap, pbs, from, to } = opts;
  const ws = finished.filter((w) => inRange(w.date, from, to));
  const stats = ws.map((w) => workoutStats(w));

  // Every week in range, including empty ones, so gaps are visible.
  const weeks: WeekBucket[] = [];
  for (let wk = startOfWeek(from); wk <= to; wk = addDays(wk, 7)) weeks.push({ weekStart: wk, workouts: 0, sets: 0, volumeKg: 0 });
  ws.forEach((w, i) => {
    const b = weeks.find((x) => x.weekStart === startOfWeek(w.date));
    if (!b) return;
    b.workouts++;
    b.sets += stats[i].sets;
    b.volumeKg += stats[i].volumeKg;
  });

  const muscle = new Map<MuscleGroup, number>();
  const perExercise = new Map<string, { date: ISODate; value: number }[]>();
  for (const w of ws) {
    for (const ex of w.exercises) {
      const sets = workingSets(ex);
      if (!sets.length) continue;
      const m = exMap.get(ex.exerciseId)?.muscle;
      if (m) muscle.set(m, (muscle.get(m) ?? 0) + sets.length);
      const best = Math.max(...sets.map((s) => e1rm(s.weightKg, s.reps)));
      if (best > 0) perExercise.set(ex.exerciseId, [...(perExercise.get(ex.exerciseId) ?? []), { date: w.date, value: best }]);
    }
  }

  const lifts: LiftTrend[] = [...perExercise.entries()]
    .filter(([id]) => !exMap.get(id)?.bodyweight)
    .map(([exerciseId, pts]) => {
      const points = pts.sort((a, b) => a.date.localeCompare(b.date));
      const first = points[0].value;
      const latest = points[points.length - 1].value;
      return { exerciseId, sessions: points.length, firstE1rm: first, latestE1rm: latest, changePct: first > 0 ? ((latest - first) / first) * 100 : 0, points };
    })
    .sort((a, b) => b.sessions - a.sessions || b.latestE1rm - a.latestE1rm)
    .slice(0, 5);

  const durations = stats.map((s) => s.durationMin).filter((d): d is number => d !== null);
  return {
    workouts: ws.length,
    sets: stats.reduce((n, s) => n + s.sets, 0),
    reps: stats.reduce((n, s) => n + s.reps, 0),
    volumeKg: stats.reduce((n, s) => n + s.volumeKg, 0),
    avgMinutes: mean(durations),
    pbs: pbs.filter((p) => inRange(p.date, from, to)).length,
    weeks,
    muscleSets: [...muscle.entries()].map(([m, sets]) => ({ muscle: m, sets })).sort((a, b) => b.sets - a.sets),
    lifts,
  };
}

// ── Nutrition ────────────────────────────────────────────────────────────

export interface DayIntake {
  date: ISODate;
  kcal: number;
  proteinG: number;
  logged: boolean;
}

export interface NutritionSummary {
  days: DayIntake[];
  daysInRange: number;
  daysLogged: number;
  avgKcal: number | null;
  avgProtein: number | null;
  avgCarbs: number | null;
  avgFat: number | null;
  /** Logged days within ±10% of the calorie target. */
  kcalOnTarget: number;
  /** Logged days reaching ≥ 90% of the protein target. */
  proteinHit: number;
  /** Share of calories from each macro across logged food (entries with macros only). */
  macroSplit: { protein: number; carbs: number; fat: number } | null;
  avgWaterMl: number | null;
  targets: { kcal: number; protein: number; carbs: number; fat: number };
}

export function nutritionSummary(opts: {
  logs: FoodLog[];
  water: WaterLog[];
  profile: Profile;
  from: ISODate;
  to: ISODate;
}): NutritionSummary {
  const { logs, water, profile, from, to } = opts;
  const days: DayIntake[] = [];
  const byDate = new Map<ISODate, FoodLog[]>();
  for (const l of logs) if (inRange(l.date, from, to)) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const n = daysBetween(from, to) + 1;
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const ls = byDate.get(date) ?? [];
    days.push({
      date,
      kcal: ls.reduce((s, l) => s + l.kcal, 0),
      proteinG: ls.reduce((s, l) => s + l.proteinG, 0),
      logged: ls.length > 0,
    });
  }
  const logged = days.filter((d) => d.logged);
  const loggedLogs = [...byDate.values()].flat();
  const carbsDays = [...byDate.values()].map((ls) => ls.reduce((s, l) => s + (l.carbsG ?? 0), 0));
  const fatDays = [...byDate.values()].map((ls) => ls.reduce((s, l) => s + (l.fatG ?? 0), 0));

  const withMacros = loggedLogs.filter((l) => l.carbsG !== null && l.fatG !== null);
  let macroSplit: NutritionSummary['macroSplit'] = null;
  if (withMacros.length) {
    const p = withMacros.reduce((s, l) => s + l.proteinG * 4, 0);
    const c = withMacros.reduce((s, l) => s + (l.carbsG ?? 0) * 4, 0);
    const f = withMacros.reduce((s, l) => s + (l.fatG ?? 0) * 9, 0);
    const total = p + c + f;
    if (total > 0) macroSplit = { protein: p / total, carbs: c / total, fat: f / total };
  }

  const waterByDate = new Map<ISODate, number>();
  for (const w of water) if (inRange(w.date, from, to)) waterByDate.set(w.date, (waterByDate.get(w.date) ?? 0) + w.ml);

  const t = macroTargets(profile);
  return {
    days,
    daysInRange: n,
    daysLogged: logged.length,
    avgKcal: mean(logged.map((d) => d.kcal)),
    avgProtein: mean(logged.map((d) => d.proteinG)),
    avgCarbs: mean(carbsDays),
    avgFat: mean(fatDays),
    kcalOnTarget: logged.filter((d) => Math.abs(d.kcal - profile.calorieTarget) <= profile.calorieTarget * 0.1).length,
    proteinHit: logged.filter((d) => d.proteinG >= profile.proteinTarget * 0.9).length,
    macroSplit,
    avgWaterMl: mean([...waterByDate.values()]),
    targets: { kcal: profile.calorieTarget, protein: profile.proteinTarget, carbs: t.carbsG, fat: t.fatG },
  };
}
