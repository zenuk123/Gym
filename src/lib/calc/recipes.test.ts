import { describe, expect, it } from 'vitest';
import { BUILT_IN_RECIPES } from '../../db/seed/recipes';
import { addDays } from '../dates';
import { mealPerServing } from './food';
import { autoPlan, dayKcal, filterRecipes, fitsSlot, recipeTags, swapOptions } from './recipes';

const WEEK = '2026-09-21';
const days = Array.from({ length: 7 }, (_, i) => addDays(WEEK, i));
const target = { kcal: 2400, proteinG: 150 };

describe('built-in recipes', () => {
  it('all resolve to foods with sensible nutrition and a method', () => {
    expect(BUILT_IN_RECIPES.length).toBeGreaterThanOrEqual(24);
    for (const r of BUILT_IN_RECIPES) {
      const n = mealPerServing(r);
      expect(n.kcal, r.name).toBeGreaterThan(100);
      expect(n.kcal, r.name).toBeLessThan(1000);
      expect(r.steps!.length, r.name).toBeGreaterThan(0);
      expect(r.items.every((i) => i.foodId), r.name).toBe(true);
    }
    expect(new Set(BUILT_IN_RECIPES.map((r) => r.id)).size).toBe(BUILT_IN_RECIPES.length);
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) expect(BUILT_IN_RECIPES.filter((r) => r.slot === slot).length).toBeGreaterThanOrEqual(4);
  });

  it('derives tags', () => {
    const chilli = BUILT_IN_RECIPES.find((r) => r.name === 'Turkey chilli with rice')!;
    expect(recipeTags(chilli)).toEqual(expect.arrayContaining(['meal-prep', 'high-protein']));
    const dahl = BUILT_IN_RECIPES.find((r) => r.name.startsWith('Red lentil'))!;
    expect(recipeTags(dahl)).toEqual(expect.arrayContaining(['vegan', 'vegetarian', 'meal-prep']));
    expect(recipeTags(BUILT_IN_RECIPES.find((r) => r.name === 'Apple & almonds')!)).toContain('quick');
  });

  it('filters by slot, tag and search', () => {
    expect(filterRecipes(BUILT_IN_RECIPES, 'breakfast').every((r) => r.slot === 'breakfast')).toBe(true);
    expect(filterRecipes(BUILT_IN_RECIPES, 'vegan').length).toBeGreaterThanOrEqual(3);
    expect(filterRecipes(BUILT_IN_RECIPES, 'all', 'salmon').map((r) => r.name)).toEqual(['Salmon, rice & greens']);
    expect(filterRecipes(BUILT_IN_RECIPES, 'all', 'feta').length).toBeGreaterThanOrEqual(2); // by ingredient
    expect(fitsSlot(BUILT_IN_RECIPES.find((r) => r.slot === 'lunch')!, 'dinner')).toBe(true);
  });
});

describe('auto-fill week', () => {
  it('fills every empty slot, lands near the targets, and keeps variety', () => {
    const plan = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: ['breakfast', 'lunch', 'dinner', 'snack'], existing: [], target });
    expect(plan).toHaveLength(28);
    for (const d of days) {
      const t = dayKcal(d, plan, []);
      expect(Math.abs(t.kcal - target.kcal) / target.kcal, d).toBeLessThan(0.2);
      expect(t.proteinG, d).toBeGreaterThan(100);
    }
    const counts = new Map<string, number>();
    for (const p of plan) counts.set(p.mealId, (counts.get(p.mealId) ?? 0) + 1);
    for (const [id, n] of counts) {
      const r = BUILT_IN_RECIPES.find((x) => x.id === id)!;
      expect(n, r.name).toBeLessThanOrEqual(r.servings > 1 ? r.servings : 2);
    }
  });

  it('keeps what is already planned and respects dietary filters', () => {
    const existing = [{ date: days[0], slot: 'dinner' as const, kcal: 900, proteinG: 60, mealId: null }];
    const plan = autoPlan({ recipes: BUILT_IN_RECIPES, days: [days[0]], slots: ['breakfast', 'lunch', 'dinner'], existing, target, require: ['vegetarian'] });
    expect(plan.map((p) => p.slot).sort()).toEqual(['breakfast', 'lunch']);
    expect(plan.every((p) => BUILT_IN_RECIPES.find((r) => r.id === p.mealId)!.tags!.includes('vegetarian'))).toBe(true);
  });

  it('is repeatable per seed and changes with a new seed', () => {
    const a = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: ['breakfast', 'lunch', 'dinner'], existing: [], target, seed: 1 });
    const b = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: ['breakfast', 'lunch', 'dinner'], existing: [], target, seed: 1 });
    const c = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: ['breakfast', 'lunch', 'dinner'], existing: [], target, seed: 7 });
    expect(a).toEqual(b);
    expect(c.map((p) => p.mealId)).not.toEqual(a.map((p) => p.mealId));
  });

  it('ranks swaps by fit', () => {
    const opts = swapOptions(BUILT_IN_RECIPES, 'snack', 200, 15);
    expect(opts.length).toBeGreaterThan(2);
    expect(Math.abs(opts[0].kcal - 200)).toBeLessThanOrEqual(Math.abs(opts.at(-1)!.kcal - 200) + 1);
  });
});
