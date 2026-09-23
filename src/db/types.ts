// Domain types for everything stored on-device (IndexedDB) and synced to the cloud.
// Units: weights are always stored in kg, lengths in cm, energy in kcal, water in ml.
// Convert only at the UI edge (see lib/units.ts).

/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

/** Fields every synced record carries. Timestamps are epoch milliseconds. */
export interface SyncFields {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Soft delete marker so deletions sync to other devices. */
  deletedAt: number | null;
}

export type Sex = 'male' | 'female' | 'other';
export type Goal = 'lose' | 'maintain' | 'gain_weight' | 'gain_muscle';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';

export const PROFILE_ID = 'me';

export interface Profile extends SyncFields {
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  startWeightKg: number;
  /** Date the start weight was recorded — progress is measured from here. */
  startDate: ISODate;
  targetWeightKg: number | null;
  calorieTarget: number;
  proteinTarget: number;
  carbTarget: number | null;
  fatTarget: number | null;
  waterTargetMl: number;
  workoutsPerWeek: number;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
}

export interface WeightEntry extends SyncFields {
  date: ISODate;
  weightKg: number;
  note: string | null;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodLog extends SyncFields {
  date: ISODate;
  meal: MealSlot;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
}

export interface WaterLog extends SyncFields {
  date: ISODate;
  ml: number;
}

// ── Training ─────────────────────────────────────────────────────────────

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'full_body';

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'other';

export interface Exercise extends SyncFields {
  name: string;
  muscle: MuscleGroup;
  equipment: Equipment;
  /** Bodyweight exercises log reps; weight is optional added load. */
  bodyweight: boolean;
  /** Smallest sensible jump in load, used by progression suggestions. */
  incrementKg: number;
  /** Built-in library entry (seeded locally, id is stable across devices). */
  builtIn: boolean;
  /** Hidden from pickers but kept because history references it. */
  archived: boolean;
  notes: string | null;
}

export interface RoutineExercise {
  /** Stable key within the routine. */
  key: string;
  exerciseId: string;
  sets: number;
  warmupSets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  /** Exercises sharing a group id are performed as a superset. */
  supersetGroup: string | null;
}

export interface Routine extends SyncFields {
  name: string;
  notes: string | null;
  /** Position in the rotation (Today suggests the next routine after the last one done). */
  sortOrder: number;
  exercises: RoutineExercise[];
}

export type SetKind = 'warmup' | 'normal' | 'drop' | 'failure';

export interface WorkoutSet {
  id: string;
  kind: SetKind;
  weightKg: number;
  reps: number;
  rpe: number | null;
  done: boolean;
  completedAt: number | null;
}

export interface WorkoutTarget {
  weightKg: number;
  repMin: number;
  repMax: number;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  supersetGroup: string | null;
  restSec: number;
  repMin: number;
  repMax: number;
  /** Suggested target when the workout started (shown, never forced). */
  target: WorkoutTarget | null;
  notes: string | null;
  sets: WorkoutSet[];
}

/** One gym session. Sets are embedded so a whole workout saves (and syncs) atomically. */
export interface Workout extends SyncFields {
  routineId: string | null;
  name: string;
  date: ISODate;
  startedAt: number;
  /** null while the workout is in progress. */
  endedAt: number | null;
  notes: string | null;
  exercises: WorkoutExercise[];
}

// ── Progress (Phase 3) ───────────────────────────────────────────────────

export const MEASUREMENT_SITES = ['chest', 'waist', 'arms', 'thighs', 'shoulders', 'hips', 'neck'] as const;
export type MeasurementSite = (typeof MEASUREMENT_SITES)[number];

/** One measuring session. Every site is optional; values in cm. */
export interface Measurement extends SyncFields {
  date: ISODate;
  chestCm: number | null;
  waistCm: number | null;
  armsCm: number | null;
  thighsCm: number | null;
  shouldersCm: number | null;
  hipsCm: number | null;
  neckCm: number | null;
  note: string | null;
}

export const siteKey = (site: MeasurementSite) => `${site}Cm` as `${MeasurementSite}Cm`;

/**
 * User goals beyond the profile's body-weight and weekly-training targets
 * (those two live on the profile and are shown as goals automatically).
 */
export type GoalKind = 'lift' | 'measurement';
export type LiftMetric = 'weight' | 'e1rm';

export interface UserGoal extends SyncFields {
  kind: GoalKind;
  /** lift goals */
  exerciseId: string | null;
  metric: LiftMetric | null;
  /** measurement goals */
  site: MeasurementSite | null;
  /** kg for lifts, cm for measurements */
  startValue: number;
  targetValue: number;
  startDate: ISODate;
  targetDate: ISODate | null;
  archived: boolean;
}

export type PhotoPose = 'front' | 'side' | 'back';

/** Metadata for a progress photo. The image itself lives in `photoFiles` (and cloud storage). */
export interface ProgressPhoto extends SyncFields {
  date: ISODate;
  pose: PhotoPose;
  width: number;
  height: number;
  note: string | null;
}

/**
 * Local-only image store (never synced as rows). `remote` tracks the upload to
 * private cloud storage: pending → uploaded, or `delete` once the photo is removed.
 */
export interface PhotoFile {
  id: string;
  full: Blob | null;
  thumb: Blob | null;
  remote: 'pending' | 'uploaded' | 'delete' | 'none';
}

/** Local table name → record type, for every table that syncs. */
export interface SyncTableMap {
  profile: Profile;
  weights: WeightEntry;
  foodLogs: FoodLog;
  waterLogs: WaterLog;
  exercises: Exercise;
  routines: Routine;
  workouts: Workout;
  measurements: Measurement;
  goals: UserGoal;
  photos: ProgressPhoto;
}
export type SyncTable = keyof SyncTableMap;

/** Local table → Supabase table. Add new synced tables here AND in a migration. */
export const REMOTE_TABLES: Record<SyncTable, string> = {
  profile: 'profiles',
  weights: 'weight_entries',
  foodLogs: 'food_logs',
  waterLogs: 'water_logs',
  exercises: 'exercises',
  routines: 'routines',
  workouts: 'workouts',
  measurements: 'measurements',
  goals: 'goals',
  photos: 'progress_photos',
};

export const SYNC_TABLES = Object.keys(REMOTE_TABLES) as SyncTable[];

/** A pending upload. One entry per record (coalesced), retried with backoff. */
export interface OutboxEntry {
  key?: number;
  table: SyncTable;
  recordId: string;
  /** Bumped every time the record changes while queued, so an in-flight push can't drop a newer edit. */
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
