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

/** Local table name → record type, for every table that syncs. */
export interface SyncTableMap {
  profile: Profile;
  weights: WeightEntry;
  foodLogs: FoodLog;
  waterLogs: WaterLog;
}
export type SyncTable = keyof SyncTableMap;

/** Local table → Supabase table. Add new synced tables here AND in a migration. */
export const REMOTE_TABLES: Record<SyncTable, string> = {
  profile: 'profiles',
  weights: 'weight_entries',
  foodLogs: 'food_logs',
  waterLogs: 'water_logs',
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
