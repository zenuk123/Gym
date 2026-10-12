import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { FoodLog, PlanItem, SavedMeal } from '../../db/types';
import { addDays } from '../../lib/dates';
import { planMeal, type NewPlanItem } from '../../lib/calc/plan';
import type { MealSlot } from '../../db/types';

export const addPlanItem = (p: NewPlanItem) => create('planItems', p);

/** Log a planned meal as eaten (on its planned day) and link it. */
export async function markEaten(p: PlanItem) {
  const log = await create('foodLogs', {
    date: p.date,
    meal: p.slot,
    name: p.name,
    kcal: p.kcal,
    proteinG: p.proteinG,
    carbsG: p.carbsG,
    fatG: p.fatG,
    fibreG: p.fibreG,
    foodId: p.foodId,
    amountG: p.amountG,
    savedMealId: p.mealId,
    servings: p.servings,
  });
  await update('planItems', p.id, { loggedId: log.id });
}

export async function unmarkEaten(p: PlanItem) {
  if (p.loggedId) await remove('foodLogs', p.loggedId);
  await update('planItems', p.id, { loggedId: null });
}

/**
 * Delete a food-log entry. If it was logged from the plan, the planned meal goes back to
 * "not eaten" (otherwise it would vanish from Today's plan with no way to mark it again).
 * Returns an undo that restores both.
 */
export async function deleteFoodLog(log: Pick<FoodLog, 'id' | 'date'>): Promise<() => Promise<void>> {
  const linked = (await db.planItems.where('date').equals(log.date).toArray()).filter((p) => p.deletedAt === null && p.loggedId === log.id);
  await remove('foodLogs', log.id);
  for (const p of linked) await update('planItems', p.id, { loggedId: null });
  return async () => {
    await update('foodLogs', log.id, { deletedAt: null });
    for (const p of linked) await update('planItems', p.id, { loggedId: log.id });
  };
}

/** Copy a planned item to other days (e.g. same breakfast all week). */
export async function copyToDays(p: PlanItem, dates: string[]) {
  const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = p;
  for (const date of dates) await create('planItems', { ...rest, date, loggedId: null });
}

/** Batch cooking: spread N portions of a recipe over consecutive days at one meal. */
export async function mealPrep(meal: SavedMeal, startDate: string, portions: number, slot: MealSlot) {
  for (let i = 0; i < portions; i++) await create('planItems', planMeal(addDays(startDate, i), slot, meal, 1));
}

/** Copy every planned (not the eaten status) item from the previous week into this one. */
export async function copyPreviousWeek(weekStart: string): Promise<number> {
  const prevStart = addDays(weekStart, -7);
  const prev = (await db.planItems.where('date').between(prevStart, addDays(prevStart, 6), true, true).toArray()).filter((p) => p.deletedAt === null);
  for (const p of prev) {
    const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = p;
    await create('planItems', { ...rest, date: addDays(p.date, 7), loggedId: null });
  }
  return prev.length;
}

export async function clearWeek(weekStart: string) {
  const items = (await db.planItems.where('date').between(weekStart, addDays(weekStart, 6), true, true).toArray()).filter((p) => p.deletedAt === null);
  for (const p of items) await remove('planItems', p.id);
  return items.length;
}
