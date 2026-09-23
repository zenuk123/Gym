import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { PROFILE_ID, type FoodLog, type ISODate, type Profile, type WaterLog, type WeightEntry } from './types';

// Live queries: components re-render automatically whenever the underlying
// IndexedDB data changes (local edits or records pulled from the cloud).
// `undefined` always means "still loading".

const alive = <T extends { deletedAt: number | null }>(r: T) => r.deletedAt === null;

/** `null` = no profile yet (show onboarding). */
export function useProfile(): Profile | null | undefined {
  return useLiveQuery(async () => {
    const p = await db.profile.get(PROFILE_ID);
    return p && alive(p) ? p : null;
  });
}

/** All weight entries, oldest first. */
export function useWeights(): WeightEntry[] | undefined {
  return useLiveQuery(async () => (await db.weights.orderBy('date').toArray()).filter(alive));
}

export function useFoodLogs(date: ISODate): FoodLog[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.foodLogs.where('date').equals(date).toArray()).filter(alive).sort((a, b) => a.createdAt - b.createdAt),
    [date],
  );
}

export function useWaterLogs(date: ISODate): WaterLog[] | undefined {
  return useLiveQuery(
    async () => (await db.waterLogs.where('date').equals(date).toArray()).filter(alive),
    [date],
  );
}

export function usePendingSyncCount(): number | undefined {
  return useLiveQuery(() => db.outbox.count());
}
