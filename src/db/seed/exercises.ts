import type { Equipment, Exercise, MuscleGroup } from '../types';
import { seedLocal } from '../repo';

/**
 * Built-in exercise library. Ids are stable ("ex-<slug>") so every device seeds the
 * same records and history lines up across devices. Never change an existing id.
 */
type Def = [name: string, muscle: MuscleGroup, equipment: Equipment, incrementKg?: number, bodyweight?: boolean];

const DEFS: Def[] = [
  // Chest
  ['Bench Press', 'chest', 'barbell'],
  ['Incline Bench Press', 'chest', 'barbell'],
  ['Dumbbell Bench Press', 'chest', 'dumbbell'],
  ['Incline Dumbbell Press', 'chest', 'dumbbell'],
  ['Machine Chest Press', 'chest', 'machine', 5],
  ['Cable Fly', 'chest', 'cable'],
  ['Pec Deck', 'chest', 'machine', 5],
  ['Push-up', 'chest', 'bodyweight', 2.5, true],
  ['Dip', 'chest', 'bodyweight', 2.5, true],
  // Back
  ['Deadlift', 'back', 'barbell', 5],
  ['Pull-up', 'back', 'bodyweight', 2.5, true],
  ['Chin-up', 'back', 'bodyweight', 2.5, true],
  ['Lat Pulldown', 'back', 'cable'],
  ['Barbell Row', 'back', 'barbell'],
  ['Dumbbell Row', 'back', 'dumbbell'],
  ['Seated Cable Row', 'back', 'cable'],
  ['Chest-Supported Row', 'back', 'machine', 5],
  ['T-Bar Row', 'back', 'barbell'],
  ['Straight-Arm Pulldown', 'back', 'cable'],
  // Shoulders
  ['Overhead Press', 'shoulders', 'barbell'],
  ['Seated Dumbbell Press', 'shoulders', 'dumbbell'],
  ['Machine Shoulder Press', 'shoulders', 'machine', 5],
  ['Lateral Raise', 'shoulders', 'dumbbell', 1],
  ['Cable Lateral Raise', 'shoulders', 'cable', 1.25],
  ['Rear Delt Fly', 'shoulders', 'dumbbell', 1],
  ['Face Pull', 'shoulders', 'cable'],
  ['Shrug', 'shoulders', 'dumbbell'],
  // Arms
  ['Barbell Curl', 'biceps', 'barbell'],
  ['Dumbbell Curl', 'biceps', 'dumbbell', 1],
  ['Hammer Curl', 'biceps', 'dumbbell', 1],
  ['Incline Dumbbell Curl', 'biceps', 'dumbbell', 1],
  ['Cable Curl', 'biceps', 'cable'],
  ['Preacher Curl', 'biceps', 'machine'],
  ['Tricep Pushdown', 'triceps', 'cable'],
  ['Overhead Tricep Extension', 'triceps', 'cable'],
  ['Skull Crusher', 'triceps', 'barbell'],
  ['Close-Grip Bench Press', 'triceps', 'barbell'],
  // Legs
  ['Squat', 'quads', 'barbell'],
  ['Front Squat', 'quads', 'barbell'],
  ['Leg Press', 'quads', 'machine', 10],
  ['Hack Squat', 'quads', 'machine', 5],
  ['Bulgarian Split Squat', 'quads', 'dumbbell'],
  ['Walking Lunge', 'quads', 'dumbbell'],
  ['Leg Extension', 'quads', 'machine', 5],
  ['Goblet Squat', 'quads', 'dumbbell'],
  ['Romanian Deadlift', 'hamstrings', 'barbell'],
  ['Lying Leg Curl', 'hamstrings', 'machine', 5],
  ['Seated Leg Curl', 'hamstrings', 'machine', 5],
  ['Hip Thrust', 'glutes', 'barbell', 5],
  ['Glute Bridge', 'glutes', 'barbell', 5],
  ['Cable Kickback', 'glutes', 'cable'],
  ['Hip Abduction', 'glutes', 'machine', 5],
  ['Standing Calf Raise', 'calves', 'machine', 5],
  ['Seated Calf Raise', 'calves', 'machine', 5],
  // Core
  ['Plank', 'core', 'bodyweight', 2.5, true],
  ['Hanging Leg Raise', 'core', 'bodyweight', 2.5, true],
  ['Cable Crunch', 'core', 'cable', 5],
  ['Ab Wheel Rollout', 'core', 'bodyweight', 2.5, true],
  // Full body
  ['Kettlebell Swing', 'full_body', 'kettlebell', 4],
  ['Farmer’s Carry', 'full_body', 'dumbbell'],
];

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const builtInId = (name: string) => `ex-${slug(name)}`;

export const BUILT_IN_EXERCISES: Exercise[] = DEFS.map(([name, muscle, equipment, incrementKg = 2.5, bodyweight = false]) => ({
  id: builtInId(name),
  name,
  muscle,
  equipment,
  bodyweight,
  incrementKg,
  builtIn: true,
  archived: false,
  notes: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
}));

/** Idempotent: only adds exercises this device doesn't have yet. */
export function seedExercises(): Promise<number> {
  return seedLocal('exercises', BUILT_IN_EXERCISES);
}
