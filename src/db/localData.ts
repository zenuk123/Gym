import { db } from './db';
import { PROFILE_ID, type Exercise, type Profile } from './types';
import { buildHistory, detectPBs } from '../lib/calc/training';
import { todayISO } from '../lib/dates';

// One read of everything the analysis features need (coach tools, friends summary).
// Read-only; soft-deleted rows are already filtered out.

const alive = <T extends { deletedAt: number | null }>(xs: T[]) => xs.filter((x) => x.deletedAt === null);

export type LocalData = Awaited<ReturnType<typeof loadLocalData>>;

export async function loadLocalData() {
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

