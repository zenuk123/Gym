import type { Food, FoodCategory, MealItem, MealSlot, PlanItem, SavedMeal, ShoppingItem } from '../../db/types';
import { mealItemFrom, mealPerServing, nutritionFor, scaleNutrients, sumNutrients, type Nutrients } from './food';

// Meal planning & shopping maths. Pure + tested.

export type NewPlanItem = Omit<PlanItem, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export function planFood(date: string, slot: MealSlot, food: Food, grams: number): NewPlanItem {
  return {
    date,
    slot,
    kind: 'food',
    foodId: food.id,
    mealId: null,
    name: food.brand ? `${food.name} (${food.brand})` : food.name,
    amountG: grams,
    servings: null,
    ...nutrients(nutritionFor(food, grams)),
    items: [mealItemFrom(food, grams)],
    loggedId: null,
  };
}

export function planMeal(date: string, slot: MealSlot, meal: SavedMeal, servings: number): NewPlanItem {
  const factor = servings / Math.max(1, meal.servings);
  return {
    date,
    slot,
    kind: 'meal',
    foodId: null,
    mealId: meal.id,
    name: meal.name,
    amountG: null,
    servings,
    ...nutrients(scaleNutrients(mealPerServing(meal), servings)),
    items: meal.items.map((it) => ({ ...it, grams: Math.round(it.grams * factor), ...scaleNutrients(it, factor) })),
    loggedId: null,
  };
}

function nutrients(n: Nutrients) {
  return { kcal: n.kcal, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG, fibreG: n.fibreG };
}

export const dayTotals = (items: Pick<PlanItem, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fibreG'>[]) => sumNutrients(items);

export interface ShoppingLine {
  key: string;
  name: string;
  category: FoodCategory;
  foodId: string | null;
  amountG: number;
  quantity: string;
}

/** "1.2 kg", "350 g", plus a count when the food has a serving size ("≈ 6 × 1 egg"). */
export function formatQuantity(grams: number, food?: Pick<Food, 'unit' | 'servingG' | 'servingName'> | null): string {
  const unit = food?.unit ?? 'g';
  const big = unit === 'ml' ? 'L' : 'kg';
  const base = grams >= 1000 ? `${Math.round(grams / 100) / 10} ${big}` : `${Math.round(grams)} ${unit}`;
  if (food?.servingG && food.servingName && grams >= food.servingG * 0.75) {
    const n = Math.ceil(grams / food.servingG - 0.1);
    return `${base} (≈ ${n} × ${food.servingName})`;
  }
  return base;
}

/** Add up every ingredient across the planned meals: one line per food, grouped later by aisle. */
export function buildShoppingList(plan: Pick<PlanItem, 'items' | 'deletedAt'>[], foods: Map<string, Food>): ShoppingLine[] {
  const lines = new Map<string, ShoppingLine>();
  for (const p of plan) {
    if (p.deletedAt !== null) continue;
    for (const it of p.items as MealItem[]) {
      if (it.grams <= 0) continue;
      const key = it.foodId ?? `name:${it.name.trim().toLowerCase()}`;
      const food = it.foodId ? foods.get(it.foodId) : undefined;
      const cur = lines.get(key);
      if (cur) cur.amountG += it.grams;
      else lines.set(key, { key, name: food?.name ?? it.name, category: food?.category ?? it.category, foodId: it.foodId, amountG: it.grams, quantity: '' });
    }
  }
  return [...lines.values()]
    .map((l) => ({ ...l, amountG: Math.round(l.amountG), quantity: formatQuantity(l.amountG, l.foodId ? foods.get(l.foodId) : null) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Merge a freshly built list into the saved one: plan lines are replaced (keeping the
 * tick on anything already bought), manual lines are never touched.
 */
export function mergeShopping(existing: ShoppingItem[], lines: ShoppingLine[]) {
  const keyOf = (s: Pick<ShoppingItem, 'foodId' | 'name'>) => s.foodId ?? `name:${s.name.trim().toLowerCase()}`;
  const oldPlan = new Map(existing.filter((s) => s.source === 'plan').map((s) => [keyOf(s), s]));
  const upserts = lines.map((l) => {
    const prev = oldPlan.get(l.key);
    return { id: prev?.id, name: l.name, category: l.category, foodId: l.foodId, amountG: l.amountG, quantity: l.quantity, checked: prev?.checked ?? false };
  });
  const keep = new Set(lines.map((l) => l.key));
  const removals = [...oldPlan.entries()].filter(([k]) => !keep.has(k)).map(([, s]) => s.id);
  return { upserts, removals };
}

/** Plain-text list for sharing (grouped by aisle, unchecked only). */
export function shoppingText(items: ShoppingItem[], label: Record<FoodCategory, string>): string {
  const groups = new Map<FoodCategory, ShoppingItem[]>();
  for (const i of items.filter((x) => !x.checked)) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  return [...groups.entries()]
    .map(([cat, xs]) => `${label[cat]}\n${xs.map((x) => `• ${x.name}${x.quantity ? ` — ${x.quantity}` : ''}`).join('\n')}`)
    .join('\n\n');
}
