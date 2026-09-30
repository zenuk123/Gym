import { describe, expect, it } from 'vitest';
import { BUILT_IN_RECIPES } from '../../db/seed/recipes';
import type { FoodPrefs, Profile } from '../../db/types';
import { addDays } from '../dates';
import { defaultPrefs, planSettings, prefTips, recipeFits, recommend, scoreRecipe } from './foodPrefs';
import { costTier, ingredientFlags, recipeAllergens, recipeDiet, suitsDiet } from './ingredients';
import { autoPlan, dayKcal } from './recipes';

const byName = (n: string) => BUILT_IN_RECIPES.find((r) => r.name === n)!;
const profile = { goal: 'lose', proteinTarget: 150, calorieTarget: 2000 } as Profile;
const prefs = (p: Partial<FoodPrefs> = {}): FoodPrefs => ({ ...defaultPrefs(profile), ...p });

describe('ingredients', () => {
  it('classifies ingredient names', () => {
    expect([...ingredientFlags('Oat milk')]).toEqual([]);
    expect(ingredientFlags('Peanut butter').has('dairy')).toBe(false);
    expect(ingredientFlags('Peanut butter').has('peanut')).toBe(true);
    expect(ingredientFlags('Rice noodles (dry)').has('gluten')).toBe(false);
    expect([...ingredientFlags('Egg noodles (dry)')].sort()).toEqual(['egg', 'gluten']);
    expect([...ingredientFlags('Green pesto')].sort()).toEqual(['dairy', 'tree-nut']);
    expect(ingredientFlags('Coconut milk, light (canned)').has('dairy')).toBe(false);
    expect(ingredientFlags('Smoked salmon').has('fish')).toBe(true);
  });

  it('works out diet, allergens and cost from the ingredients', () => {
    expect(recipeDiet(byName('Red lentil & sweet potato dahl'))).toBe('vegan');
    expect(recipeDiet(byName('Paneer & pea curry'))).toBe('vegetarian');
    expect(recipeDiet(byName('Prawn noodle stir-fry'))).toBe('pescatarian');
    expect(recipeDiet(byName('Beef bolognese'))).toBe('everything');
    expect(suitsDiet(byName('Paneer & pea curry'), 'pescatarian')).toBe(true);
    expect(suitsDiet(byName('Paneer & pea curry'), 'vegan')).toBe(false);
    expect(recipeAllergens(byName('Beef bolognese'))).toEqual(['gluten']);
    expect(costTier(byName('Red lentil & sweet potato dahl'))).toBe(1);
    expect(costTier(byName('Prawn & chorizo paella'))).toBe(3);
  });

  it('library covers every diet, cuisine and meal well', () => {
    const vegan = BUILT_IN_RECIPES.filter((r) => recipeDiet(r) === 'vegan');
    expect(vegan.length).toBeGreaterThanOrEqual(10);
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      expect(BUILT_IN_RECIPES.filter((r) => r.slot === slot && suitsDiet(r, 'vegetarian')).length, slot).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(BUILT_IN_RECIPES.map((r) => r.cuisine)).size).toBe(7);
  });
});

describe('coverage for restrictive answers', () => {
  it('every diet, with or without gluten, has options for every meal', () => {
    for (const diet of ['everything', 'pescatarian', 'vegetarian', 'vegan'] as const) {
      for (const avoid of [[], ['gluten']] as const) {
        const p = prefs({ diet, avoid: [...avoid], weekdayMin: null });
        for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
          const n = BUILT_IN_RECIPES.filter((r) => r.slot === slot && recipeFits(r, p).ok).length;
          expect(n, `${diet} ${avoid.join('')} ${slot}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('food preferences', () => {
  it('rules out by diet, allergy, dislike and time', () => {
    const p = prefs({ diet: 'vegetarian', avoid: ['gluten'], dislikes: ['mushroom'], weekdayMin: 15, weekendMin: 60 });
    expect(recipeFits(byName('Beef bolognese'), p)).toEqual({ ok: false, why: 'Not vegetarian' });
    expect(recipeFits(byName('Hummus veggie wrap'), p).why).toBe('Contains gluten');
    expect(recipeFits(byName('Mushroom & pea risotto'), p).why).toBe('Has mushroom');
    const monday = '2026-09-28';
    const saturday = '2026-10-03';
    const halloumi = byName('Halloumi & roasted veg couscous'); // 30 min, single portion
    expect(recipeFits(halloumi, prefs({ weekdayMin: 15 }), { date: monday, slot: 'lunch' }).why).toBe('Takes 30 min');
    expect(recipeFits(halloumi, prefs({ weekdayMin: 15, weekendMin: 60 }), { date: saturday, slot: 'lunch' }).ok).toBe(true);
    // Batch recipes get twice the time (cooked once for several meals).
    expect(recipeFits(byName('Beef chilli con carne'), prefs({ weekdayMin: 30 }), { date: monday, slot: 'dinner' }).ok).toBe(true);
  });

  it('ranks for the goal and explains why', () => {
    const lose = scoreRecipe(byName('Lighter chicken tikka masala'), profile, prefs({ focus: 'fullness' }));
    expect(lose.reasons.join(' ')).toMatch(/protein/);
    const top = recommend(BUILT_IN_RECIPES, profile, prefs({ focus: 'protein', cuisines: ['indian'] }), 'dinner').slice(0, 5);
    expect(top.every((t) => t.meal.slot === 'dinner' || t.meal.slot === 'lunch')).toBe(true);
    expect(top.some((t) => t.meal.cuisine === 'indian')).toBe(true);
    const fuel = recommend(BUILT_IN_RECIPES, { goal: 'gain_weight', proteinTarget: 140 }, prefs({ focus: 'fuel' }), 'dinner')[0];
    expect(fuel.reasons.join(' ')).toMatch(/kcal a portion|Energy-dense|protein/);
  });

  it('gives tips for the chosen challenges', () => {
    const tips = prefTips(prefs({ challenges: ['snacking', 'no-time'], breakfast: true, snacks: 1 }), profile);
    expect(tips[0]).toEqual({ kind: 'calculation', text: 'To reach 150 g protein over 4 meals, aim for about 40 g each.' });
    expect(tips.map((t) => t.text).join(' ')).toMatch(/evening snack/);
    expect(tips.map((t) => t.text).join(' ')).toMatch(/Batch-cook/);
  });

  it('drives auto-fill: no breakfast, two snacks, vegan, same breakfast', () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays('2026-09-28', i));
    const s = planSettings(prefs({ diet: 'vegan', breakfast: false, snacks: 2, weekdayMin: null }), profile);
    expect(s.slots).toEqual(['lunch', 'dinner', 'snack', 'snack']);
    const plan = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: s.slots, existing: [], target: { kcal: 2000, proteinG: 150 }, allow: s.allow, bonus: s.bonus, portions: s.portions });
    expect(plan.filter((p) => p.slot === 'breakfast')).toHaveLength(0);
    expect(plan.filter((p) => p.date === days[0] && p.slot === 'snack')).toHaveLength(2);
    expect(plan.every((p) => recipeDiet(BUILT_IN_RECIPES.find((r) => r.id === p.mealId)!) === 'vegan')).toBe(true);
    for (const d of days) expect(dayKcal(d, plan, []).kcal, d).toBeGreaterThan(1500);

    const same = planSettings(prefs({ sameBreakfast: true }), profile);
    const plan2 = autoPlan({ recipes: BUILT_IN_RECIPES, days, slots: same.slots, existing: [], target: { kcal: 2000, proteinG: 150 }, allow: same.allow, bonus: same.bonus, sameBreakfast: true });
    expect(new Set(plan2.filter((p) => p.slot === 'breakfast').map((p) => p.mealId)).size).toBe(1);
  });
});
