import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createMany } from './repo';

describe('createMany', () => {
  beforeEach(async () => {
    await db.weights.clear();
    await db.outbox.clear();
  });

  it('writes every row and queues each for sync, with increasing timestamps', async () => {
    const n = await createMany('weights', [
      { date: '2026-01-01', weightKg: 80, note: null },
      { date: '2026-01-02', weightKg: 79.8, note: null },
      { date: '2026-01-03', weightKg: 79.9, note: null },
    ]);
    expect(n).toBe(3);
    const rows = await db.weights.orderBy('date').toArray();
    expect(rows.map((r) => r.weightKg)).toEqual([80, 79.8, 79.9]);
    expect(new Set(rows.map((r) => r.updatedAt)).size).toBe(3);
    expect(await db.outbox.where('table').equals('weights').count()).toBe(3);
    expect(await createMany('weights', [])).toBe(0);
  });
});
