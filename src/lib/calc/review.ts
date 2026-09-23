import type { FoodLog, ISODate, Profile, SleepLog, WaterLog, WeightEntry, Workout } from '../../db/types';
import { addDays, startOfWeek } from '../dates';
import type { InsightKind } from '../insights';
import { formatWeight } from '../units';
import { nutritionSummary, type NutritionSummary } from './analytics';
import { summariseSleep, type SleepSummary } from './sleep';
import { mean } from './stats';
import { workoutStats, type PersonalBest } from './training';

// The weekly review (Mon–Sun): what happened, how it compares with last week, and what
// to focus on next. Every statement is labelled fact / calculation / suggestion, and
// nothing here ever changes a target — suggestions are for the user to act on.

export interface ReviewStatement {
  kind: InsightKind;
  text: string;
}

export interface WeeklyReview {
  weekStart: ISODate;
  weekEnd: ISODate;
  training: { workouts: number; target: number; sets: number; volumeKg: number; prevVolumeKg: number; pbs: PersonalBest[] };
  nutrition: NutritionSummary;
  weight: { avgKg: number | null; prevAvgKg: number | null; changeKg: number | null; weighIns: number };
  water: { avgMl: number | null; daysHit: number };
  sleep: SleepSummary;
  /** 0–100: how many of the week's habits were hit (a calculation, shown with its parts). */
  score: number;
  scoreParts: { label: string; hit: number; of: number }[];
  wins: ReviewStatement[];
  focus: ReviewStatement[];
}

export interface ReviewInput {
  profile: Profile;
  weekStart: ISODate;
  finished: Workout[];
  pbs: PersonalBest[];
  weights: WeightEntry[];
  foodLogs: FoodLog[];
  water: WaterLog[];
  sleep: SleepLog[];
  /** Days of the week that have happened so far (7 for a finished week). */
  elapsedDays?: number;
}

const between = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;

export function weeklyReview(input: ReviewInput): WeeklyReview {
  const { profile, finished, pbs, weights, foodLogs, water, sleep } = input;
  const weekStart = startOfWeek(input.weekStart);
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);
  const days = Math.max(1, Math.min(7, input.elapsedDays ?? 7));
  const lastDay = addDays(weekStart, days - 1);
  const u = profile.weightUnit;

  // Training
  const ws = finished.filter((w) => w.endedAt !== null && w.deletedAt === null && between(w.date, weekStart, weekEnd));
  const prevWs = finished.filter((w) => w.endedAt !== null && w.deletedAt === null && between(w.date, prevStart, prevEnd));
  const stats = ws.map((w) => workoutStats(w));
  const weekPbs = pbs.filter((p) => between(p.date, weekStart, weekEnd));
  const training = {
    workouts: ws.length,
    target: profile.workoutsPerWeek,
    sets: stats.reduce((n, s) => n + s.sets, 0),
    volumeKg: stats.reduce((n, s) => n + s.volumeKg, 0),
    prevVolumeKg: prevWs.map((w) => workoutStats(w).volumeKg).reduce((a, b) => a + b, 0),
    pbs: weekPbs,
  };

  // Nutrition + water (only over the days that have happened)
  const nutrition = nutritionSummary({ logs: foodLogs.filter((l) => l.deletedAt === null), water: water.filter((w) => w.deletedAt === null), profile, from: weekStart, to: lastDay });
  const waterByDay = new Map<ISODate, number>();
  for (const w of water) if (w.deletedAt === null && between(w.date, weekStart, lastDay)) waterByDay.set(w.date, (waterByDay.get(w.date) ?? 0) + w.ml);
  const waterDaysHit = [...waterByDay.values()].filter((ml) => ml >= profile.waterTargetMl).length;

  // Weight: average of the week's weigh-ins vs the previous week's.
  const alive = weights.filter((w) => w.deletedAt === null);
  const thisW = alive.filter((w) => between(w.date, weekStart, weekEnd)).map((w) => w.weightKg);
  const prevW = alive.filter((w) => between(w.date, prevStart, prevEnd)).map((w) => w.weightKg);
  const avgKg = mean(thisW);
  const prevAvgKg = mean(prevW);
  const weight = { avgKg, prevAvgKg, changeKg: avgKg !== null && prevAvgKg !== null ? avgKg - prevAvgKg : null, weighIns: thisW.length };

  const sleepSummary = summariseSleep(sleep, weekStart, weekEnd);

  // Habit score: the parts are shown, so the number is never a black box.
  const scoreParts = [
    { label: 'Workouts', hit: Math.min(training.workouts, training.target), of: training.target },
    { label: 'Days food logged', hit: nutrition.daysLogged, of: days },
    { label: 'Protein target days', hit: nutrition.proteinHit, of: days },
    { label: 'Water target days', hit: waterDaysHit, of: days },
  ].filter((p) => p.of > 0);
  const score = Math.round((scoreParts.reduce((s, p) => s + p.hit / p.of, 0) / Math.max(1, scoreParts.length)) * 100);

  // ── Wins (facts) ───────────────────────────────────────────────────────
  const wins: ReviewStatement[] = [];
  if (training.target > 0 && training.workouts >= training.target) wins.push({ kind: 'fact', text: `Hit your training target: ${training.workouts} of ${training.target} workouts.` });
  if (weekPbs.length) wins.push({ kind: 'fact', text: `${weekPbs.length} personal best${weekPbs.length === 1 ? '' : 's'} this week.` });
  if (nutrition.daysLogged >= Math.min(5, days) && nutrition.proteinHit >= Math.ceil(nutrition.daysLogged * 0.7))
    wins.push({ kind: 'fact', text: `Protein target reached on ${nutrition.proteinHit} of ${nutrition.daysLogged} logged days.` });
  if (nutrition.daysLogged === days && days >= 5) wins.push({ kind: 'fact', text: 'Food logged every day.' });
  if (weight.changeKg !== null && profile.targetWeightKg !== null) {
    const towards = Math.sign(profile.targetWeightKg - (prevAvgKg ?? profile.startWeightKg));
    if (towards !== 0 && Math.sign(weight.changeKg) === towards && Math.abs(weight.changeKg) >= 0.1)
      wins.push({ kind: 'calculation', text: `Average weight moved ${formatWeight(Math.abs(weight.changeKg), u)} towards your goal.` });
  }
  if (sleepSummary.avgMin !== null && sleepSummary.nights >= 3 && sleepSummary.avgMin >= 7 * 60)
    wins.push({ kind: 'calculation', text: `Averaged ${Math.floor(sleepSummary.avgMin / 60)}h ${Math.round(sleepSummary.avgMin % 60)}m in bed a night.` });

  // ── Focus for next week (suggestions, max 3, most important first) ─────
  const focus: ReviewStatement[] = [];
  if (training.target > 0 && training.workouts < training.target && days === 7) {
    const missed = training.target - training.workouts;
    focus.push({ kind: 'suggestion', text: `You were ${missed} workout${missed === 1 ? '' : 's'} short of ${training.target}. Pick your training days for next week now — booked sessions happen more often.` });
  }
  if (nutrition.daysLogged > 0 && nutrition.proteinHit < Math.ceil(nutrition.daysLogged * 0.6) && nutrition.avgProtein !== null) {
    const gap = Math.round(profile.proteinTarget - nutrition.avgProtein);
    if (gap > 0) focus.push({ kind: 'suggestion', text: `Protein averaged ${gap} g/day under target. Adding one high-protein item (Greek yoghurt, a shake, extra chicken) most days would close it.` });
  }
  if (nutrition.daysLogged < Math.min(5, days) && days >= 5)
    focus.push({ kind: 'suggestion', text: `Food was logged on ${nutrition.daysLogged} of ${days} days. Weekly averages are only reliable with most days logged — try “Same as yesterday” or saved meals to make it quicker.` });
  if (weight.changeKg !== null && (profile.goal === 'lose' || profile.goal === 'gain_weight' || profile.goal === 'gain_muscle')) {
    const wantDown = profile.goal === 'lose';
    const wrongWay = wantDown ? weight.changeKg > 0.2 : weight.changeKg < -0.2;
    if (wrongWay)
      focus.push({
        kind: 'suggestion',
        text: `Average weight went ${wantDown ? 'up' : 'down'} ${formatWeight(Math.abs(weight.changeKg), u)} — one week can be water or salt. If it repeats next week, look at portion sizes${nutrition.avgKcal !== null ? ` (you averaged ${Math.round(nutrition.avgKcal)} kcal vs ${profile.calorieTarget})` : ''}. Your targets stay as they are unless you change them.`,
      });
  }
  if (sleepSummary.nights >= 3 && sleepSummary.avgMin !== null && sleepSummary.avgMin < 7 * 60)
    focus.push({ kind: 'suggestion', text: 'Sleep averaged under 7 hours. A fixed bedtime is the simplest lever — recovery and appetite both improve with more sleep.' });
  if (weight.weighIns < 3 && days === 7) focus.push({ kind: 'suggestion', text: `Only ${weight.weighIns} weigh-in${weight.weighIns === 1 ? '' : 's'} this week. 3+ morning weigh-ins make the weekly average far more trustworthy.` });

  return {
    weekStart,
    weekEnd,
    training,
    nutrition,
    weight,
    water: { avgMl: nutrition.avgWaterMl, daysHit: waterDaysHit },
    sleep: sleepSummary,
    score,
    scoreParts,
    wins,
    focus: focus.slice(0, 3),
  };
}

/** Plain-text version (for sharing, or as context for the AI coach). */
export function reviewText(r: WeeklyReview, profile: Profile): string {
  const u = profile.weightUnit;
  const lines = [
    `Week ${r.weekStart} → ${r.weekEnd}`,
    `Workouts: ${r.training.workouts}/${r.training.target}, ${r.training.sets} working sets, ${r.training.pbs.length} PBs`,
    `Food logged: ${r.nutrition.daysLogged} days; avg ${r.nutrition.avgKcal !== null ? Math.round(r.nutrition.avgKcal) : '—'} kcal (target ${profile.calorieTarget}), avg protein ${r.nutrition.avgProtein !== null ? Math.round(r.nutrition.avgProtein) : '—'} g (target ${profile.proteinTarget})`,
    `Weight: avg ${r.weight.avgKg !== null ? formatWeight(r.weight.avgKg, u) : '—'}${r.weight.changeKg !== null ? ` (${formatWeight(r.weight.changeKg, u, { signed: true })} vs last week)` : ''}, ${r.weight.weighIns} weigh-ins`,
    `Sleep: ${r.sleep.nights} nights logged${r.sleep.avgMin !== null ? `, avg ${Math.round(r.sleep.avgMin)} min` : ''}`,
    `Habit score: ${r.score}/100`,
  ];
  return lines.join('\n');
}
