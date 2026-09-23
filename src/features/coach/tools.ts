import { db } from '../../db/db';
import { PROFILE_ID, type Exercise, type ISODate, type Profile } from '../../db/types';
import { nutritionSummary, trainingSummary } from '../../lib/calc/analytics';
import { mealPerServing, searchFoods } from '../../lib/calc/food';
import { bodyweightGoal, evaluateGoal, frequencyGoal } from '../../lib/calc/goals';
import { SITE_LABEL, summariseMeasurements } from '../../lib/calc/measurements';
import { dayTotals } from '../../lib/calc/plan';
import { reviewText, weeklyReview } from '../../lib/calc/review';
import { sleepVsTraining, summariseSleep } from '../../lib/calc/sleep';
import { buildHistory, detectPBs, nextRoutine, suggestNext, weekStreak } from '../../lib/calc/training';
import { summariseWeight } from '../../lib/calc/weight';
import { addDays, daysBetween, startOfWeek, todayISO } from '../../lib/dates';
import { formatWeight } from '../../lib/units';

// Read-only tools the coach can call. They only ever read this device's database —
// the coach cannot change targets, the programme, or any logged data.

type Kind = 'integer' | 'string';
interface Prop {
  type: Kind;
  description: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  optional?: boolean;
}

interface ToolSpec {
  name: string;
  /** Status line shown while it runs. */
  status: string;
  description: string;
  props: Record<string, Prop>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (max = 730): Prop => ({ type: 'integer', description: `How many days back from today (1–${max}).`, min: 1, max, optional: true });
const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const alive = <T extends { deletedAt: number | null }>(xs: T[]) => xs.filter((x) => x.deletedAt === null);

async function load() {
  const [profile, weights, workouts, exercises, routines, foodLogs, water, sleep, goals, measurements] = await Promise.all([
    db.profile.get(PROFILE_ID),
    db.weights.orderBy('date').toArray(),
    db.workouts.orderBy('startedAt').toArray(),
    db.exercises.toArray(),
    db.routines.toArray(),
    db.foodLogs.toArray(),
    db.waterLogs.toArray(),
    db.sleep.orderBy('date').toArray(),
    db.goals.toArray(),
    db.measurements.orderBy('date').toArray(),
  ]);
  if (!profile) throw new Error('No profile yet');
  const finished = alive(workouts).filter((w) => w.endedAt !== null);
  const exMap = new Map<string, Exercise>(exercises.map((e) => [e.id, e]));
  const history = buildHistory(finished);
  return {
    profile: profile as Profile,
    weights: alive(weights),
    finished,
    exMap,
    routines: alive(routines).sort((a, b) => a.sortOrder - b.sortOrder),
    history,
    pbs: detectPBs(history, exMap),
    foodLogs: alive(foodLogs),
    water: alive(water),
    sleep: alive(sleep),
    goals: alive(goals).filter((g) => !g.archived),
    measurements: alive(measurements),
    today: todayISO(),
  };
}

const exName = (exMap: Map<string, Exercise>, id: string) => exMap.get(id)?.name ?? 'Unknown exercise';

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_overview',
    status: 'Reading your profile and targets',
    description:
      "The user's profile, goal, daily targets (calories, protein, water, workouts/week), preferred units, and a snapshot of today (food eaten, water, last workout, last weigh-in). Call this first in most conversations.",
    props: {},
    run: async () => {
      const d = await load();
      const p = d.profile;
      const todayFood = d.foodLogs.filter((l) => l.date === d.today);
      const last = d.finished.at(-1);
      return {
        today: d.today,
        name: p.name || null,
        sex: p.sex,
        age: new Date().getFullYear() - p.birthYear,
        heightCm: p.heightCm,
        goal: p.goal,
        activityLevel: p.activityLevel,
        startWeightKg: p.startWeightKg,
        startDate: p.startDate,
        targetWeightKg: p.targetWeightKg,
        targets: { kcal: p.calorieTarget, proteinG: p.proteinTarget, carbsG: p.carbTarget, fatG: p.fatTarget, waterMl: p.waterTargetMl, workoutsPerWeek: p.workoutsPerWeek },
        units: { weight: p.weightUnit, length: p.lengthUnit },
        todaySoFar: {
          kcal: Math.round(todayFood.reduce((s, l) => s + l.kcal, 0)),
          proteinG: Math.round(todayFood.reduce((s, l) => s + l.proteinG, 0)),
          waterMl: d.water.filter((w) => w.date === d.today).reduce((s, w) => s + w.ml, 0),
        },
        lastWorkout: last ? { date: last.date, name: last.name, daysAgo: daysBetween(last.date, d.today) } : null,
        lastWeighIn: d.weights.at(-1) ? { date: d.weights.at(-1)!.date, kg: d.weights.at(-1)!.weightKg } : null,
        workoutStreakWeeks: weekStreak(d.finished, p.workoutsPerWeek, d.today),
        nextRoutine: nextRoutine(d.routines, d.finished)?.name ?? null,
        dataCounts: { weighIns: d.weights.length, workouts: d.finished.length, foodLogDays: new Set(d.foodLogs.map((l) => l.date)).size, sleepNights: d.sleep.length },
      };
    },
  },
  {
    name: 'get_weight_trend',
    status: 'Looking at your weight trend',
    description: 'Body-weight trend: 7-day average, rate per week (kg), change since start, remaining to goal, and weekly averages for the period. All weights in kg.',
    props: { days: days() },
    run: async ({ days: n = 90 }) => {
      const d = await load();
      const from = addDays(d.today, -((n as number) - 1));
      const s = summariseWeight(d.weights, d.profile.startWeightKg, d.profile.targetWeightKg);
      const weeks = new Map<string, number[]>();
      for (const w of d.weights.filter((x) => x.date >= from)) weeks.set(startOfWeek(w.date), [...(weeks.get(startOfWeek(w.date)) ?? []), w.weightKg]);
      return {
        latest: s.latest,
        average7Kg: r1(s.average7),
        ratePerWeekKg: s.rate === null ? null : Math.round(s.rate * 100) / 100,
        changeSinceStartKg: r1(s.changeKg),
        remainingToGoalKg: r1(s.remainingKg),
        weeklyAverages: [...weeks.entries()].map(([weekStart, ws]) => ({ weekStart, avgKg: r1(ws.reduce((a, b) => a + b, 0) / ws.length), weighIns: ws.length })),
      };
    },
  },
  {
    name: 'get_training_summary',
    status: 'Analysing your training',
    description:
      'Training over a period: workouts, working sets, reps, volume (kg), average duration, PB count, sessions per week, working sets per muscle group, and e1RM trends for the main lifts.',
    props: { days: days() },
    run: async ({ days: n = 28 }) => {
      const d = await load();
      const s = trainingSummary({ finished: d.finished, exMap: d.exMap, pbs: d.pbs, from: addDays(d.today, -((n as number) - 1)), to: d.today });
      return {
        ...s,
        volumeKg: Math.round(s.volumeKg),
        avgMinutes: s.avgMinutes && Math.round(s.avgMinutes),
        weeks: s.weeks.map((w) => ({ ...w, volumeKg: Math.round(w.volumeKg) })),
        lifts: s.lifts.map((l) => ({ exercise: exName(d.exMap, l.exerciseId), sessions: l.sessions, firstE1rmKg: r1(l.firstE1rm), latestE1rmKg: r1(l.latestE1rm), changePct: r1(l.changePct) })),
        targetWorkoutsPerWeek: d.profile.workoutsPerWeek,
      };
    },
  },
  {
    name: 'get_exercise_history',
    status: 'Checking your exercise history',
    description:
      "One exercise's recent sessions (sets as weight × reps @RPE), best e1RM, personal bests, and the app's double-progression suggestion for next time. Match by exercise name (partial names are fine).",
    props: {
      exercise: { type: 'string', description: 'Exercise name, e.g. "bench press".' },
      sessions: { type: 'integer', description: 'How many recent sessions (1–20).', min: 1, max: 20, optional: true },
    },
    run: async ({ exercise, sessions = 6 }) => {
      const d = await load();
      const q = String(exercise).toLowerCase().trim();
      const candidates = [...d.exMap.values()].filter((e) => e.name.toLowerCase().includes(q) && d.history.has(e.id));
      const ex = candidates.sort((a, b) => (d.history.get(b.id)?.length ?? 0) - (d.history.get(a.id)?.length ?? 0))[0];
      if (!ex) return { found: false, loggedExercises: [...d.history.keys()].map((id) => exName(d.exMap, id)) };
      const hist = d.history.get(ex.id)!;
      const lastW = [...d.finished].reverse().find((w) => w.exercises.some((e) => e.exerciseId === ex.id));
      const we = lastW?.exercises.find((e) => e.exerciseId === ex.id);
      const u = d.profile.weightUnit;
      const next = suggestNext({ sessions: hist, repMin: we?.repMin ?? 8, repMax: we?.repMax ?? 12, incrementKg: ex.incrementKg, unit: u, fmt: (kg) => formatWeight(kg, u) });
      return {
        found: true,
        exercise: ex.name,
        muscle: ex.muscle,
        totalSessions: hist.length,
        bestE1rmKg: r1(Math.max(...hist.map((s) => s.bestE1rm))),
        repRange: we ? `${we.repMin}-${we.repMax}` : null,
        recent: hist.slice(-(sessions as number)).map((s) => ({
          date: s.date,
          sets: s.sets.map((x) => `${x.weightKg}kg×${x.reps}${x.rpe ? ` @${x.rpe}` : ''}${x.kind !== 'normal' ? ` (${x.kind})` : ''}`),
          e1rmKg: r1(s.bestE1rm),
        })),
        pbs: d.pbs.filter((p) => p.exerciseId === ex.id).slice(-5).map((p) => ({ date: p.date, kind: p.kind, weightKg: p.weightKg, reps: p.reps })),
        appSuggestionForNextSession: { kind: next.kind, weightKg: next.weightKg, reps: `${next.repMin}-${next.repMax}`, reason: next.reason },
      };
    },
  },
  {
    name: 'get_routines',
    status: 'Reading your programme',
    description: "The user's workout routines (programme) in rotation order: exercises, sets, rep ranges, rest.",
    props: {},
    run: async () => {
      const d = await load();
      return d.routines.map((r) => ({
        name: r.name,
        exercises: r.exercises.map((e) => ({ exercise: exName(d.exMap, e.exerciseId), sets: e.sets, reps: `${e.repMin}-${e.repMax}`, restSec: e.restSec, superset: e.supersetGroup !== null })),
      }));
    },
  },
  {
    name: 'get_nutrition_summary',
    status: 'Adding up your nutrition',
    description:
      'Nutrition over a period: days logged, average calories/protein/carbs/fat on logged days, days on calorie target (±10%), days protein hit (≥90%), macro split, average water, and per-day calories/protein.',
    props: { days: days(180) },
    run: async ({ days: n = 14 }) => {
      const d = await load();
      const s = nutritionSummary({ logs: d.foodLogs, water: d.water, profile: d.profile, from: addDays(d.today, -((n as number) - 1)), to: d.today });
      return {
        ...s,
        avgKcal: s.avgKcal && Math.round(s.avgKcal),
        avgProtein: s.avgProtein && Math.round(s.avgProtein),
        avgCarbs: s.avgCarbs && Math.round(s.avgCarbs),
        avgFat: s.avgFat && Math.round(s.avgFat),
        avgWaterMl: s.avgWaterMl && Math.round(s.avgWaterMl),
        days: s.days.map((x) => (x.logged ? { date: x.date, kcal: Math.round(x.kcal), proteinG: Math.round(x.proteinG) } : { date: x.date, logged: false })),
        note: "Today is included and may be incomplete.",
      };
    },
  },
  {
    name: 'get_food_log',
    status: 'Opening your food log',
    description: 'Everything logged on one date, grouped by meal, with calories and macros.',
    props: { date: { type: 'string', description: 'YYYY-MM-DD (local date). Defaults to today.', pattern: DATE, optional: true } },
    run: async ({ date }) => {
      const d = await load();
      const day = (date as string | undefined) ?? d.today;
      const logs = d.foodLogs.filter((l) => l.date === day);
      return {
        date: day,
        entries: logs.map((l) => ({ meal: l.meal, name: l.name, grams: l.amountG ?? null, servings: l.servings ?? null, kcal: Math.round(l.kcal), proteinG: r1(l.proteinG), carbsG: r1(l.carbsG), fatG: r1(l.fatG) })),
        totals: { kcal: Math.round(logs.reduce((s, l) => s + l.kcal, 0)), proteinG: Math.round(logs.reduce((s, l) => s + l.proteinG, 0)) },
      };
    },
  },
  {
    name: 'get_sleep',
    status: 'Looking at your sleep',
    description: 'Sleep over a period: nights logged, average duration and quality (1–5), bedtime consistency, short nights, each night, and (if there is enough data) how lifting performance differs after ≥7 h vs shorter nights.',
    props: { days: days(365) },
    run: async ({ days: n = 14 }) => {
      const d = await load();
      const from = addDays(d.today, -((n as number) - 1));
      const s = summariseSleep(d.sleep, from, d.today);
      const link = sleepVsTraining(d.sleep, d.finished);
      return {
        ...s,
        avgMin: s.avgMin && Math.round(s.avgMin),
        bedtimeSpreadMin: s.bedtimeSpreadMin && Math.round(s.bedtimeSpreadMin),
        nightsList: d.sleep.filter((l) => l.date >= from).map((l) => ({ wokeOn: l.date, bed: l.bedTime, wake: l.wakeTime, minutes: l.durationMin, quality: l.quality, note: l.note })),
        sleepVsTraining: link && { ...link, differencePct: r1(link.differencePct) },
      };
    },
  },
  {
    name: 'get_weekly_review',
    status: 'Building the weekly review',
    description: "The app's weekly review (Mon–Sun): workouts vs target, PBs, nutrition averages, weight change vs previous week, water, sleep, habit score, wins and focus suggestions.",
    props: { week_start: { type: 'string', description: 'Monday of the week, YYYY-MM-DD. Defaults to the current week.', pattern: DATE, optional: true } },
    run: async ({ week_start }) => {
      const d = await load();
      const ws = startOfWeek((week_start as string | undefined) ?? d.today);
      const r = weeklyReview({
        profile: d.profile,
        weekStart: ws,
        finished: d.finished,
        pbs: d.pbs,
        weights: d.weights,
        foodLogs: d.foodLogs,
        water: d.water,
        sleep: d.sleep,
        elapsedDays: Math.min(7, daysBetween(ws, d.today) + 1),
      });
      return { summary: reviewText(r, d.profile), score: r.score, scoreParts: r.scoreParts, pbs: r.training.pbs.map((p) => `${exName(d.exMap, p.exerciseId)} ${p.kind} ${p.weightKg}kg×${p.reps}`), wins: r.wins, focus: r.focus };
    },
  },
  {
    name: 'get_goals',
    status: 'Checking your goals',
    description: 'All goals (body weight, weekly workouts, lift and measurement goals) with start, current, target, progress 0–1, rate per week, projected date, and body measurements (cm).',
    props: {},
    run: async () => {
      const d = await load();
      const out = [];
      const bw = bodyweightGoal(d.profile, summariseWeight(d.weights, d.profile.startWeightKg, d.profile.targetWeightKg), d.today);
      if (bw) out.push({ ...bw, name: 'Body weight (kg)' });
      out.push({ ...frequencyGoal(d.profile, d.finished, d.today), name: 'Workouts per week' });
      for (const g of d.goals) {
        const s = evaluateGoal(g, { history: d.history, measurements: d.measurements, today: d.today });
        out.push({ ...s, goal: undefined, name: g.kind === 'lift' ? `${exName(d.exMap, g.exerciseId ?? '')} ${g.metric === 'e1rm' ? 'estimated 1RM' : 'top weight'} (kg)` : `${g.site ? SITE_LABEL[g.site] : 'Measurement'} (cm)` });
      }
      return {
        goals: out.map((g) => ({ ...g, current: r1(g.current), progress: r1(g.progress), ratePerWeek: g.ratePerWeek === null ? null : Math.round(g.ratePerWeek * 100) / 100 })),
        measurements: summariseMeasurements(d.measurements).map((m) => ({ site: SITE_LABEL[m.site], latestCm: m.latest.value, date: m.latest.date, changeSinceFirstCm: r1(m.sinceFirst) })),
      };
    },
  },
  {
    name: 'search_foods',
    status: 'Searching foods',
    description: "Search the user's food database (built-in + their own foods). Returns nutrition per 100 g/ml and serving size. Use it to ground meal ideas in foods they actually have.",
    props: { query: { type: 'string', description: 'Food name, e.g. "greek yoghurt".' } },
    run: async ({ query }) => {
      const foods = alive(await db.foods.toArray()).filter((f) => !f.archived);
      return searchFoods(foods, String(query))
        .slice(0, 8)
        .map((f) => ({ name: f.name, brand: f.brand, per100: { kcal: f.kcal, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG }, unit: f.unit, serving: f.servingG ? `${f.servingName} = ${f.servingG}${f.unit}` : null }));
    },
  },
  {
    name: 'list_saved_meals',
    status: 'Reading your saved meals',
    description: "The user's saved meals / recipes with per-serving nutrition and ingredients.",
    props: {},
    run: async () => {
      const meals = alive(await db.meals.toArray());
      return meals.map((m) => {
        const per = mealPerServing(m);
        return { name: m.name, slot: m.slot, servings: m.servings, perServing: { kcal: Math.round(per.kcal), proteinG: Math.round(per.proteinG), carbsG: Math.round(per.carbsG), fatG: Math.round(per.fatG) }, ingredients: m.items.map((i) => `${i.name} ${Math.round(i.grams)}g`) };
      });
    },
  },
  {
    name: 'get_meal_plan',
    status: 'Opening your meal plan',
    description: 'The meal plan for a week (Mon–Sun): items per day and slot, whether eaten, and day totals.',
    props: { week_start: { type: 'string', description: 'Monday of the week, YYYY-MM-DD. Defaults to the current week.', pattern: DATE, optional: true } },
    run: async ({ week_start }) => {
      const ws = startOfWeek((week_start as string | undefined) ?? todayISO());
      const items = alive(await db.planItems.where('date').between(ws, addDays(ws, 6), true, true).toArray());
      const byDay = new Map<ISODate, typeof items>();
      for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
      return [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, xs]) => {
          const t = dayTotals(xs);
          return { date, items: xs.map((i) => ({ slot: i.slot, name: i.name, kcal: Math.round(i.kcal), proteinG: Math.round(i.proteinG), eaten: i.loggedId !== null })), totals: { kcal: Math.round(t.kcal), proteinG: Math.round(t.proteinG) } };
        });
    },
  },
];


const byName = new Map(TOOLS.map((t) => [t.name, t]));
export const toolStatus = (name: string) => byName.get(name)?.status ?? 'Working';

/** JSON-schema tool definitions for the API. */
export function toolDefinitions(eager: boolean) {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(eager ? { eager_input_streaming: true } : {}),
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(t.props).map(([k, p]) => [
          k,
          { type: p.type, description: p.description, ...(p.min !== undefined ? { minimum: p.min } : {}), ...(p.max !== undefined ? { maximum: p.max } : {}), ...(p.pattern ? { pattern: p.pattern.source } : {}) },
        ]),
      ),
      required: Object.entries(t.props)
        .filter(([, p]) => !p.optional)
        .map(([k]) => k),
      additionalProperties: false,
    },
  }));
}

/** Validate a (tolerantly parsed) tool input against its schema. Returns an error message or null. */
export function validateInput(name: string, input: unknown): string | null {
  const t = byName.get(name);
  if (!t) return `Unknown tool ${name}`;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Input must be an object';
  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!(k in t.props)) return `Unexpected field ${k}`;
  for (const [k, p] of Object.entries(t.props)) {
    const v = obj[k];
    if (v === undefined) {
      if (!p.optional) return `Missing ${k}`;
      continue;
    }
    if (p.type === 'integer' && !(typeof v === 'number' && Number.isInteger(v))) return `${k} must be an integer`;
    if (p.type === 'string' && (typeof v !== 'string' || v.trim() === '')) return `${k} must be a non-empty string`;
    if (typeof v === 'number' && ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))) return `${k} out of range`;
    if (typeof v === 'string' && p.pattern && !p.pattern.test(v)) return `${k} has the wrong format`;
  }
  return null;
}

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  return byName.get(name)!.run(input);
}
