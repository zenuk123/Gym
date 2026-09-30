import { db } from '../../../db/db';
import { createMany } from '../../../db/repo';
import type { ISODate } from '../../../db/types';
import { freshOnly, type HealthData } from '../../../lib/healthData';

export interface ImportCounts {
  weights: number;
  nights: number;
}

/**
 * Adds weigh-ins and nights for days that have nothing logged yet (never overwrites), through
 * repo.createMany so they sync like anything you type in. `source` ends up in the note.
 */
export async function importHealthData(found: HealthData, source: string, from?: ISODate): Promise<ImportCounts> {
  const [weights, sleep] = await Promise.all([db.weights.toArray(), db.sleep.toArray()]);
  const fresh = freshOnly(
    found,
    // Deleted days count as "have": if you deleted an imported entry, it doesn't come back next sync.
    { weights: weights.map((w) => w.date), nights: sleep.map((s) => s.date) },
    from,
  );
  const w = await createMany('weights', fresh.weights.map((x) => ({ date: x.date, weightKg: x.weightKg, note: source })));
  const n = await createMany(
    'sleep',
    fresh.nights.map((x) => ({ date: x.date, bedTime: x.bedTime, wakeTime: x.wakeTime, durationMin: x.durationMin, quality: 3, note: x.source && x.source !== source ? `${source} · ${x.source}` : source })),
  );
  return { weights: w, nights: n };
}
