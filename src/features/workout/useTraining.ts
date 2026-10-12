import { useMemo } from 'react';
import { useExercises, useRecords, useRoutines, useWorkouts } from '../../db/hooks';
import type { Exercise, PersonalRecord, Profile, Routine, Workout } from '../../db/types';
import { buildHistory, detectPBs, recordWorkouts, type PersonalBest, type TrainingHistory } from '../../lib/calc/training';
import { formatWeight } from '../../lib/units';
import type { PlanContext } from './logic';

export interface Training {
  workouts: Workout[];
  finished: Workout[];
  active: Workout | null;
  exercises: Exercise[];
  exMap: Map<string, Exercise>;
  routines: Routine[];
  /** Sessions only — for planning, "last time" and progression suggestions. */
  history: TrainingHistory;
  /** Sessions + PRs logged on their own — for bests, PB detection, goals and charts. */
  bests: TrainingHistory;
  records: PersonalRecord[];
  pbs: PersonalBest[];
}

/** Everything the training screens need, derived once from the live database. `undefined` while loading. */
export function useTraining(): Training | undefined {
  const workouts = useWorkouts();
  const exercises = useExercises();
  const routines = useRoutines();
  const records = useRecords();
  return useMemo(() => {
    if (!workouts || !exercises || !routines || !records) return undefined;
    const exMap = new Map(exercises.map((e) => [e.id, e]));
    const finished = workouts.filter((w) => w.endedAt !== null);
    const history = buildHistory(finished);
    const bests = records.length ? buildHistory([...finished, ...recordWorkouts(records)]) : history;
    return {
      workouts,
      finished,
      active: [...workouts].reverse().find((w) => w.endedAt === null) ?? null,
      exercises,
      exMap,
      routines,
      history,
      bests,
      records,
      pbs: detectPBs(bests, exMap),
    };
  }, [workouts, exercises, routines, records]);
}

export function planContext(profile: Profile): PlanContext {
  return { unit: profile.weightUnit, fmt: (kg) => formatWeight(kg, profile.weightUnit) };
}

export const MUSCLE_LABEL: Record<Exercise['muscle'], string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  full_body: 'Full body',
};

export const EQUIPMENT_LABEL: Record<Exercise['equipment'], string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  other: 'Other',
};
