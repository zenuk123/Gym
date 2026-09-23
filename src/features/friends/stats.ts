import type { LocalData } from '../../db/localData';
import type { Goal, ISODate } from '../../db/types';
import { bodyweightGoal, evaluateGoal } from '../../lib/calc/goals';
import { SITE_LABEL } from '../../lib/calc/measurements';
import { weeklyReview } from '../../lib/calc/review';
import { weekStreak, type PBKind } from '../../lib/calc/training';
import { dailySeries, summariseWeight, windowAverage } from '../../lib/calc/weight';
import { addDays, daysBetween, startOfWeek } from '../../lib/dates';

// What a user shares with their friends: a small summary computed on the phone. Only the
// categories switched on are included; raw logs (foods, weigh-ins, sets) are never shared.
// Weight is only ever shared as a percentage, never kilograms.

export const SHARE_KEYS = ['workouts', 'streak', 'pbs', 'habit', 'weight', 'calories'] as const;
export type ShareKey = (typeof SHARE_KEYS)[number];
export type ShareSettings = Record<ShareKey, boolean>;

export const SHARE_LABEL: Record<ShareKey, { title: string; desc: string }> = {
  workouts: { title: 'Workouts', desc: 'Workouts this week vs your target' },
  streak: { title: 'Streak', desc: 'Weeks in a row you hit your workout target' },
  pbs: { title: 'Personal bests', desc: 'PB count, plus each PB (exercise, weight × reps) in the feed' },
  habit: { title: 'Habit score', desc: 'This week’s score from the weekly review' },
  weight: { title: 'Weight progress', desc: 'Only percentages — % towards your goal and 30-day change. Never your weight.' },
  calories: { title: 'Calories', desc: 'Days on calorie target and average % of target — not what you ate' },
};

export const ALL_SHARED: ShareSettings = { workouts: true, streak: true, pbs: true, habit: true, weight: true, calories: true };

export interface FriendStats {
  weekStart: ISODate;
  /** Days of the week so far (1–7), so weekly numbers can be read fairly mid-week. */
  days: number;
  workouts?: { done: number; target: number };
  streak?: number;
  pbs?: { week: number; total: number };
  habit?: number;
  weight?: { goal: Goal; goalProgressPct: number | null; change30Pct: number | null };
  calories?: { daysOnTarget: number; daysLogged: number; avgPctOfTarget: number | null };
}

/** PBs counted once per exercise per workout (one heavy set can beat several kinds of best). */
const pbMoments = (pbs: LocalData['pbs']) => new Set(pbs.map((p) => `${p.workoutId}:${p.exerciseId}`)).size;

export function buildStats(d: LocalData, share: ShareSettings): FriendStats {
  const weekStart = startOfWeek(d.today);
  const days = Math.min(7, daysBetween(weekStart, d.today) + 1);
  const r = weeklyReview({ profile: d.profile, weekStart, finished: d.finished, pbs: d.pbs, weights: d.weights, foodLogs: d.foodLogs, water: d.water, sleep: d.sleep, elapsedDays: days });
  const out: FriendStats = { weekStart, days };
  if (share.workouts) out.workouts = { done: r.training.workouts, target: d.profile.workoutsPerWeek };
  if (share.streak) out.streak = weekStreak(d.finished, d.profile.workoutsPerWeek, d.today);
  if (share.pbs) out.pbs = { week: pbMoments(d.pbs.filter((p) => p.date >= weekStart)), total: pbMoments(d.pbs) };
  if (share.habit) out.habit = r.score;
  if (share.weight) {
    const s = summariseWeight(d.weights, d.profile.startWeightKg, d.profile.targetWeightKg);
    const series = dailySeries(d.weights);
    const now = s.latest ? windowAverage(series, s.latest.date, 7) : null;
    const then = s.latest ? windowAverage(series, addDays(s.latest.date, -30), 7) : null;
    out.weight = {
      goal: d.profile.goal,
      goalProgressPct: s.progress === null ? null : Math.round(s.progress * 1000) / 10,
      change30Pct: now !== null && then ? Math.round(((now - then) / then) * 1000) / 10 : null,
    };
  }
  if (share.calories) {
    const n = r.nutrition;
    out.calories = {
      daysOnTarget: n.kcalOnTarget,
      daysLogged: n.daysLogged,
      avgPctOfTarget: n.avgKcal === null || !d.profile.calorieTarget ? null : Math.round((n.avgKcal / d.profile.calorieTarget) * 100),
    };
  }
  return out;
}

// ── Feed events ──────────────────────────────────────────────────────────

export type FriendEvent =
  | { key: string; kind: 'pb'; date: ISODate; data: { exercise: string; weightKg: number; reps: number; pb: PBKind } }
  | { key: string; kind: 'goal'; date: ISODate; data: { name: string } }
  | { key: string; kind: 'week'; date: ISODate; data: { done: number; target: number } }
  | { key: string; kind: 'streak'; date: ISODate; data: { weeks: number } };

const PB_RANK: Record<PBKind, number> = { weight: 0, e1rm: 1, reps: 2, volume: 3 };
const STREAK_MILESTONES = [2, 4, 8, 12, 26, 52, 104];

/** Recent achievements worth celebrating (last 14 days), filtered by what's shared. Keys are stable, so re-publishing is idempotent. */
export function buildEvents(d: LocalData, share: ShareSettings): FriendEvent[] {
  const since = addDays(d.today, -13);
  const out: FriendEvent[] = [];
  if (share.pbs) {
    // One entry per exercise per workout — the most impressive kind of PB.
    const best = new Map<string, (typeof d.pbs)[number]>();
    for (const p of d.pbs) {
      if (p.date < since) continue;
      const k = `${p.workoutId}:${p.exerciseId}`;
      const prev = best.get(k);
      if (!prev || PB_RANK[p.kind] < PB_RANK[prev.kind]) best.set(k, p);
    }
    for (const [k, p] of best)
      out.push({ key: `pb:${k}`, kind: 'pb', date: p.date, data: { exercise: d.exMap.get(p.exerciseId)?.name ?? 'Exercise', weightKg: p.weightKg, reps: p.reps, pb: p.kind } });
    // Lift goals reached.
    for (const g of d.goals.filter((x) => x.kind === 'lift')) {
      const s = evaluateGoal(g, { history: d.history, measurements: d.measurements, today: d.today });
      if (s.achievedOn && s.achievedOn >= since)
        out.push({ key: `goal:${g.id}`, kind: 'goal', date: s.achievedOn, data: { name: `${d.exMap.get(g.exerciseId ?? '')?.name ?? 'Lift'} goal` } });
    }
  }
  if (share.weight) {
    const bw = bodyweightGoal(d.profile, summariseWeight(d.weights, d.profile.startWeightKg, d.profile.targetWeightKg), d.today);
    if (bw?.achieved && d.profile.targetWeightKg !== null) out.push({ key: `goal:bodyweight:${d.profile.targetWeightKg}`, kind: 'goal', date: d.weights.at(-1)?.date ?? d.today, data: { name: 'Body-weight goal' } });
    for (const g of d.goals.filter((x) => x.kind === 'measurement')) {
      const s = evaluateGoal(g, { history: d.history, measurements: d.measurements, today: d.today });
      if (s.achievedOn && s.achievedOn >= since) out.push({ key: `goal:${g.id}`, kind: 'goal', date: s.achievedOn, data: { name: `${g.site ? SITE_LABEL[g.site] : 'Measurement'} goal` } });
    }
  }
  if (share.workouts) {
    for (const ws of [startOfWeek(d.today), addDays(startOfWeek(d.today), -7)]) {
      const done = d.finished.filter((w) => w.date >= ws && w.date <= addDays(ws, 6)).sort((a, b) => a.startedAt - b.startedAt);
      const target = d.profile.workoutsPerWeek;
      if (target > 0 && done.length >= target) out.push({ key: `week:${ws}`, kind: 'week', date: done[target - 1].date, data: { done: done.length, target } });
    }
  }
  if (share.streak) {
    const weeks = weekStreak(d.finished, d.profile.workoutsPerWeek, d.today);
    const m = [...STREAK_MILESTONES].reverse().find((x) => weeks >= x);
    if (m) {
      // Key on the streak's first week so the same milestone is never posted twice.
      const thisWk = startOfWeek(d.today);
      const counted = d.finished.filter((w) => w.date >= thisWk).length >= d.profile.workoutsPerWeek;
      const first = addDays(thisWk, -7 * (weeks - (counted ? 1 : 0)));
      const reached = addDays(first, 7 * m - 1);
      out.push({ key: `streak:${m}:${first}`, kind: 'streak', date: reached < d.today ? reached : d.today, data: { weeks: m } });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Leaderboard ──────────────────────────────────────────────────────────

export interface Member {
  userId: string;
  name: string;
  stats: FriendStats | null;
  updatedAt: string | null;
  me: boolean;
}

export type Metric = 'habit' | 'workouts' | 'streak' | 'pbs' | 'weight' | 'calories';

export interface MetricDef {
  label: string;
  /** Higher is better; null = not ranked (not shared, or no data this week). */
  score: (s: FriendStats, currentWeek: ISODate) => number | null;
  show: (s: FriendStats) => string;
  weekly: boolean;
}

const thisWeek = (s: FriendStats, week: ISODate) => s.weekStart === week;

export const METRICS: Record<Metric, MetricDef> = {
  habit: { label: 'Habit score', weekly: true, score: (s, w) => (thisWeek(s, w) && s.habit !== undefined ? s.habit : null), show: (s) => `${s.habit}` },
  workouts: {
    label: 'Workouts',
    weekly: true,
    // % of own target, so 3/3 beats 4/6; ties broken by raw count.
    score: (s, w) => (thisWeek(s, w) && s.workouts && s.workouts.target > 0 ? (s.workouts.done / s.workouts.target) * 100 + s.workouts.done / 100 : null),
    show: (s) => `${s.workouts!.done}/${s.workouts!.target}`,
  },
  streak: { label: 'Streak', weekly: false, score: (s) => s.streak ?? null, show: (s) => `${s.streak} wk` },
  pbs: { label: 'PBs', weekly: true, score: (s, w) => (thisWeek(s, w) && s.pbs ? s.pbs.week + s.pbs.total / 10_000 : null), show: (s) => `${s.pbs!.week}` },
  weight: { label: 'Goal progress', weekly: false, score: (s) => s.weight?.goalProgressPct ?? null, show: (s) => `${Math.round(s.weight!.goalProgressPct!)}%` },
  calories: {
    label: 'Calories',
    weekly: true,
    score: (s, w) => (thisWeek(s, w) && s.calories ? s.calories.daysOnTarget + s.calories.daysLogged / 100 : null),
    show: (s) => `${s.calories!.daysOnTarget}/${s.days} days`,
  },
};

/** Why a member has no value on a metric. */
export function missingReason(m: Member, metric: Metric, currentWeek: ISODate): string {
  if (!m.stats) return 'Hasn’t shared yet';
  if (METRICS[metric].weekly && m.stats.weekStart !== currentWeek) return 'Not updated this week';
  return 'Not shared';
}

export interface Row {
  member: Member;
  rank: number | null;
  value: string | null;
}

/** Rank members on one metric. Equal scores share a rank; members without data go last, unranked. */
export function leaderboard(members: Member[], metric: Metric, currentWeek: ISODate): Row[] {
  const def = METRICS[metric];
  const scored = members.map((m) => ({ m, score: m.stats ? def.score(m.stats, currentWeek) : null }));
  const ranked = scored.filter((x) => x.score !== null).sort((a, b) => b.score! - a.score! || a.m.name.localeCompare(b.m.name));
  const rows: Row[] = [];
  ranked.forEach((x, i) => {
    const rank = i > 0 && x.score === ranked[i - 1].score ? rows[i - 1].rank : i + 1;
    rows.push({ member: x.m, rank, value: def.show(x.m.stats!) });
  });
  for (const x of scored.filter((y) => y.score === null).sort((a, b) => a.m.name.localeCompare(b.m.name))) rows.push({ member: x.m, rank: null, value: null });
  return rows;
}
