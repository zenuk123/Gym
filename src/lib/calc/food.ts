import type { Food, FoodCategory, FoodLog, MealItem, SavedMeal } from '../../db/types';
import { newId } from '../id';

// Food maths: scaling per-100 g values, meal totals, search and "recent" lists. Pure + tested.

export interface Nutrients {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function nutritionFor(food: Pick<Food, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fibreG'>, grams: number): Nutrients {
  const f = grams / 100;
  return {
    kcal: Math.round(food.kcal * f),
    proteinG: r1(food.proteinG * f),
    carbsG: r1(food.carbsG * f),
    fatG: r1(food.fatG * f),
    fibreG: food.fibreG === null ? null : r1(food.fibreG * f),
  };
}

export function sumNutrients(xs: Nutrients[]): Nutrients {
  const hasFibre = xs.some((x) => x.fibreG !== null);
  return {
    kcal: Math.round(xs.reduce((s, x) => s + x.kcal, 0)),
    proteinG: r1(xs.reduce((s, x) => s + x.proteinG, 0)),
    carbsG: r1(xs.reduce((s, x) => s + x.carbsG, 0)),
    fatG: r1(xs.reduce((s, x) => s + x.fatG, 0)),
    fibreG: hasFibre ? r1(xs.reduce((s, x) => s + (x.fibreG ?? 0), 0)) : null,
  };
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: Math.round(n.kcal * factor),
    proteinG: r1(n.proteinG * factor),
    carbsG: r1(n.carbsG * factor),
    fatG: r1(n.fatG * factor),
    fibreG: n.fibreG === null ? null : r1(n.fibreG * factor),
  };
}

export function mealItemFrom(food: Food, grams: number): MealItem {
  return { key: newId(), foodId: food.id, name: food.name, grams, category: food.category, ...nutritionFor(food, grams) };
}

/** Re-scale an ingredient line to a new amount (keeps its per-gram nutrition). */
export function rescaleItem(item: MealItem, grams: number): MealItem {
  if (item.grams <= 0) return { ...item, grams };
  return { ...item, grams, ...scaleNutrients(item, grams / item.grams) };
}

export const mealTotal = (m: Pick<SavedMeal, 'items'>) => sumNutrients(m.items);
export const mealPerServing = (m: Pick<SavedMeal, 'items' | 'servings'>) => scaleNutrients(mealTotal(m), 1 / Math.max(1, m.servings));

/** Human amount: "1 egg (58 g)", "150 g", "250 ml". */
export function describeAmount(food: Pick<Food, 'unit' | 'servingG' | 'servingName'>, grams: number): string {
  const u = food.unit;
  if (food.servingG && food.servingName) {
    const n = grams / food.servingG;
    if (Math.abs(n - Math.round(n)) < 0.01 && Math.round(n) >= 1) {
      const count = Math.round(n);
      return count === 1 ? `${food.servingName} (${grams} ${u})` : `${count} × ${food.servingName} (${grams} ${u})`;
    }
  }
  return `${Math.round(grams)} ${u}`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ');

/** Local food search: every query word must match; prefix matches, favourites and frequent foods rank first. */
export function searchFoods(foods: Food[], query: string, usage: Map<string, number> = new Map()): Food[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const live = foods.filter((f) => !f.archived && f.deletedAt === null);
  if (words.length === 0) return live.sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const scored: [Food, number][] = [];
  for (const f of live) {
    const hay = norm(`${f.name} ${f.brand ?? ''}`);
    const tokens = hay.split(/\s+/);
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    for (const w of words) score += tokens.some((t) => t.startsWith(w)) ? 3 : 1;
    if (hay.startsWith(words[0])) score += 3;
    if (f.favourite) score += 4;
    score += Math.min(5, usage.get(f.id) ?? 0);
    if (f.source !== 'builtin') score += 1; // your own foods first on ties
    scored.push([f, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length).map(([f]) => f);
}

/** How often each food has been logged (drives search ranking). */
export function foodUsage(logs: FoodLog[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) if (l.foodId && l.deletedAt === null) m.set(l.foodId, (m.get(l.foodId) ?? 0) + 1);
  return m;
}

/** Most recently logged foods with the amount you usually have. */
export function recentFoods(logs: FoodLog[], foods: Map<string, Food>, limit = 20): { food: Food; grams: number }[] {
  const seen = new Set<string>();
  const out: { food: Food; grams: number }[] = [];
  for (const l of [...logs].sort((a, b) => b.createdAt - a.createdAt)) {
    if (!l.foodId || seen.has(l.foodId) || l.deletedAt !== null) continue;
    const food = foods.get(l.foodId);
    if (!food || food.archived) continue;
    seen.add(l.foodId);
    out.push({ food, grams: l.amountG ?? food.servingG ?? 100 });
    if (out.length >= limit) break;
  }
  return out;
}

export const CATEGORY_LABEL: Record<FoodCategory, string> = {
  meat: 'Meat & fish',
  dairy: 'Dairy & eggs',
  fruit: 'Fruit',
  vegetables: 'Vegetables',
  carbs: 'Carbohydrates',
  snacks: 'Snacks',
  other: 'Other',
};
