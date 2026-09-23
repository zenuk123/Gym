import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, FoodLog, MetaEntry, OutboxEntry, Profile, Routine, WaterLog, WeightEntry, Workout } from './types';

/**
 * On-device database (IndexedDB via Dexie). This is the source of truth for the UI —
 * the app works fully offline and the sync engine mirrors it to the cloud when possible.
 *
 * Schema changes: add a new `this.version(n)` block, never edit an old one.
 */
export class FitnessDB extends Dexie {
  profile!: EntityTable<Profile, 'id'>;
  weights!: EntityTable<WeightEntry, 'id'>;
  foodLogs!: EntityTable<FoodLog, 'id'>;
  waterLogs!: EntityTable<WaterLog, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'key'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'fitness-os') {
    super(name);
    this.version(1).stores({
      profile: 'id, updatedAt',
      weights: 'id, date, updatedAt',
      foodLogs: 'id, date, updatedAt',
      waterLogs: 'id, date, updatedAt',
      outbox: '++key, &[table+recordId], nextAttemptAt',
      meta: 'key',
    });
    // Phase 2: training
    this.version(2).stores({
      exercises: 'id, name, updatedAt',
      routines: 'id, sortOrder, updatedAt',
      workouts: 'id, date, startedAt, updatedAt',
    });
  }
}

export const db = new FitnessDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
