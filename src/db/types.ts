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
  /** "Reset" on Today: this routine is next until a routine workout is finished after `nextRoutineSetAt`. */
  nextRoutineId?: string | null;
  nextRoutineSetAt?: number | null;
  /** ISO 4217 code for the price book (default GBP). */
  currency?: string | null;
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
  /** Nutrition is a snapshot at log time, so editing a food later never rewrites history. */
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  /** Source food and amount (absent for quick adds and entries made before Phase 4). */
  foodId?: string | null;
  amountG?: number | null;
  /** Logged from a saved meal. */
  savedMealId?: string | null;
  servings?: number | null;
}

// ── Nutrition (Phase 4) ──────────────────────────────────────────────────

/** Shopping-list aisles (spec: meat, dairy, fruit, vegetables, carbohydrates, snacks, other). */
export const FOOD_CATEGORIES = ['meat', 'dairy', 'fruit', 'vegetables', 'carbs', 'snacks', 'other'] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

/** A food with nutrition per 100 g (or 100 ml). */
export interface Food extends SyncFields {
  name: string;
  brand: string | null;
  category: FoodCategory;
  unit: 'g' | 'ml';
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number | null;
  /** Typical portion, e.g. 1 egg = 50 g. */
  servingG: number | null;
  servingName: string | null;
  barcode: string | null;
  source: 'builtin' | 'custom' | 'openfoodfacts' | 'ai';
  favourite: boolean;
  archived: boolean;
}

/** An ingredient line. Nutrition is stored for the given grams, so a meal is self-contained. */
export interface MealItem {
  key: string;
  foodId: string | null;
  name: string;
  grams: number;
  category: FoodCategory;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number | null;
}

/** A saved meal / recipe. `servings` = how many portions the ingredients make (meal prep). */
export interface SavedMeal extends SyncFields {
  name: string;
  slot: MealSlot | null;
  servings: number;
  items: MealItem[];
  notes: string | null;
  favourite: boolean;
  /** Recipe extras (all optional so older meals stay valid). */
  /** Your photo, as a small JPEG data URL (≈50 KB) so it syncs and backs up with the meal. */
  image?: string | null;
  /** Method, one step per entry. */
  steps?: string[] | null;
  /** Total prep + cook time, minutes. */
  prepMin?: number | null;
  tags?: RecipeTag[] | null;
  /** Built-in recipes are seeded on every device (stable ids, updatedAt 0). */
  source?: 'builtin' | 'custom' | null;
  /** Emoji for the illustrated cover shown until you add a photo. */
  cover?: string | null;
}

export const RECIPE_TAGS = ['high-protein', 'vegetarian', 'vegan', 'quick', 'meal-prep', 'low-calorie'] as const;
export type RecipeTag = (typeof RECIPE_TAGS)[number];

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

// ── Meal prep (Phase 5) ──────────────────────────────────────────────────

/** A planned meal on a day. Nutrition + ingredient lines are stored for the planned portion. */
export interface PlanItem extends SyncFields {
  date: ISODate;
  slot: MealSlot;
  kind: 'food' | 'meal' | 'custom';
  foodId: string | null;
  mealId: string | null;
  name: string;
  amountG: number | null;
  servings: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number | null;
  /** Ingredients for this portion — what the shopping list adds up. */
  items: MealItem[];
  /** Food-log entry created when it was eaten. */
  loggedId: string | null;
}

export interface ShoppingItem extends SyncFields {
  /** Monday of the plan week this list belongs to. */
  weekStart: ISODate;
  name: string;
  category: FoodCategory;
  /** Human quantity, e.g. "600 g (≈ 4 × 1 breast)". */
  quantity: string | null;
  amountG: number | null;
  foodId: string | null;
  checked: boolean;
  source: 'plan' | 'manual';
}

// ── Sleep (Phase 6) ──────────────────────────────────────────────────────

/** One night, filed under the date you woke up. Times are local "HH:MM". */
export interface SleepLog extends SyncFields {
  date: ISODate;
  bedTime: string;
  wakeTime: string;
  durationMin: number;
  /** 1 (awful) – 5 (great) */
  quality: number;
  note: string | null;
}

// ── Price book ───────────────────────────────────────────────────────────

/**
 * What an item costs at a shop, entered by the user. `packG` is the pack size in grams/ml
 * (so a list needing 900 g of a 500 g pack costs 2 packs); null = price per item as bought.
 */
export interface PriceEntry extends SyncFields {
  /** `food:<foodId>` or `name:<normalised name>` — see lib/calc/prices.ts itemKey(). */
  itemKey: string;
  name: string;
  shop: string;
  price: number;
  packG: number | null;
  updatedOn: ISODate;
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
  foods: Food;
  meals: SavedMeal;
  planItems: PlanItem;
  shopping: ShoppingItem;
  sleep: SleepLog;
  prices: PriceEntry;
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
  foods: 'foods',
  meals: 'saved_meals',
  planItems: 'plan_items',
  shopping: 'shopping_items',
  sleep: 'sleep_logs',
  prices: 'prices',
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
