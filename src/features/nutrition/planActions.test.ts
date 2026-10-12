import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { create } from '../../db/repo';
import { deleteFoodLog, markEaten } from './planActions';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('plan ↔ food log', () => {
  it('deleting a log made from the plan puts the planned meal back to "not eaten", and undo relinks it', async () => {
    const p = await create('planItems', { date: '2026-10-12', slot: 'lunch', kind: 'custom', foodId: null, mealId: null, name: 'Chilli', amountG: null, servings: 1, kcal: 600, proteinG: 40, carbsG: 50, fatG: 20, fibreG: null, items: [], loggedId: null });
    await markEaten(p);
    const logId = (await db.planItems.get(p.id))!.loggedId!;
    expect(logId).toBeTruthy();
    const undo = await deleteFoodLog({ id: logId, date: '2026-10-12' });
    expect((await db.planItems.get(p.id))!.loggedId).toBeNull();
    expect((await db.foodLogs.get(logId))!.deletedAt).not.toBeNull();
    await undo();
    expect((await db.planItems.get(p.id))!.loggedId).toBe(logId);
    expect((await db.foodLogs.get(logId))!.deletedAt).toBeNull();
  });
});
