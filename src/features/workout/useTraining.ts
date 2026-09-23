import { useMemo } from 'react';
import { useExercises, useRoutines, useWorkouts } from '../../db/hooks';
import type { Exercise, Profile, Routine, Workout } from '../../db/types';
import { buildHistory, detectPBs, type PersonalBest, type TrainingHistory } from '../../lib/calc/training';
import { formatWeight } from '../../lib/units';
import type { PlanContext } from './logic';

export interface Training {
  workouts: Workout[];
  finished: Workout[];
  active: Workout | null;
  exercises: Exercise[];
  exMap: Map<string, Exercise>;
  routines: Routine[];
  history: TrainingHistory;
  pbs: PersonalBest[];
}

/** Everything the training screens need, derived once from the live database. `undefined` while loading. */
export function useTraining(): Training | undefined {
  const workouts = useWorkouts();
  const exercises = useExercises();
  const routines = useRoutines();
  return useMemo(() => {
    if (!workouts || !exercises || !routines) return undefined;
    const exMap = new Map(exercises.map((e) => [e.id, e]));
    const finished = workouts.filter((w) => w.endedAt !== null);
    const history = buildHistory(finished);
    return {
      workouts,
      finished,
      active: [...workouts].reverse().find((w) => w.endedAt === null) ?? null,
      exercises,
      exMap,
      routines,
      history,
      pbs: detectPBs(history, exMap),
    };
  }, [workouts, exercises, routines]);
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
