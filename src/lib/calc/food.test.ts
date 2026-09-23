import { describe, expect, it } from 'vitest';
import { BUILT_IN_FOODS, builtInFoodId } from '../../db/seed/foods';
import type { Food, FoodLog } from '../../db/types';
import { categoryFromTags, fromOff } from '../openFoodFacts';
import { describeAmount, foodUsage, mealItemFrom, mealPerServing, nutritionFor, recentFoods, rescaleItem, searchFoods } from './food';

const byName = (n: string) => BUILT_IN_FOODS.find((f) => f.name === n)!;

describe('food database', () => {
  it('has unique ids and sane macros (energy roughly matches 4/4/9)', () => {
    expect(new Set(BUILT_IN_FOODS.map((f) => f.id)).size).toBe(BUILT_IN_FOODS.length);
    for (const f of BUILT_IN_FOODS) {
      const est = f.proteinG * 4 + f.carbsG * 4 + f.fatG * 9;
      // Alcohol (lager) aside, labelled kcal should be within ~25% of the macro estimate.
      if (f.name === 'Lager') continue;
      expect(Math.abs(est - f.kcal) / Math.max(f.kcal, 20), f.name).toBeLessThan(0.3);
    }
  });
});

describe('food maths', () => {
  it('scales per-100 g values', () => {
    expect(nutritionFor(byName('Chicken breast (raw)'), 150)).toEqual({ kcal: 159, proteinG: 36, carbsG: 0, fatG: 1.7, fibreG: 0 });
  });

  it('builds meal lines and per-serving totals', () => {
    const meal = {
      servings: 2,
      items: [mealItemFrom(byName('Chicken breast (raw)'), 300), mealItemFrom(byName('White rice (dry)'), 150)],
    };
    const per = mealPerServing(meal);
    expect(per.kcal).toBe(Math.round((318 + 540) / 2));
    expect(per.proteinG).toBeCloseTo((72 + 9.9) / 2, 1);
  });

  it('rescales an ingredient line', () => {
    const line = mealItemFrom(byName('Rolled oats'), 40);
    expect(rescaleItem(line, 80).kcal).toBe(line.kcal * 2);
  });

  it('describes amounts using servings when they fit', () => {
    const egg = byName('Egg (large)');
    expect(describeAmount(egg, 116)).toBe('2 × 1 egg (116 g)');
    expect(describeAmount(egg, 58)).toBe('1 egg (58 g)');
    expect(describeAmount(egg, 70)).toBe('70 g');
  });
});

describe('search', () => {
  const custom: Food = { ...byName('Greek yoghurt, 0% fat'), id: 'mine', name: 'Fage Total 0% Greek yoghurt', brand: 'Fage', source: 'custom', favourite: true };
  const foods = [...BUILT_IN_FOODS, custom];

  it('matches every word, ignoring case and accents', () => {
    const r = searchFoods(foods, 'chicken RAW');
    expect(r.map((f) => f.name)).toEqual(['Chicken breast (raw)', 'Chicken thigh, skinless (raw)']);
  });

  it('ranks favourites and frequently logged foods first', () => {
    expect(searchFoods(foods, 'yoghurt')[0].id).toBe('mine');
    const usage = foodUsage([{ foodId: builtInFoodId('Greek yoghurt, full fat'), deletedAt: null } as FoodLog, { foodId: builtInFoodId('Greek yoghurt, full fat'), deletedAt: null } as FoodLog]);
    const r = searchFoods(foods.map((f) => ({ ...f, favourite: false })), 'greek', usage);
    expect(r[0].name).toBe('Greek yoghurt, full fat');
  });

  it('lists recent foods once each, newest first, with the last amount', () => {
    const m = new Map(BUILT_IN_FOODS.map((f) => [f.id, f]));
    const logs = [
      { foodId: builtInFoodId('Banana'), amountG: 118, createdAt: 1, deletedAt: null },
      { foodId: builtInFoodId('Skyr'), amountG: 150, createdAt: 3, deletedAt: null },
      { foodId: builtInFoodId('Banana'), amountG: 100, createdAt: 2, deletedAt: null },
    ] as FoodLog[];
    expect(recentFoods(logs, m).map((r) => [r.food.name, r.grams])).toEqual([
      ['Skyr', 150],
      ['Banana', 100],
    ]);
  });
});

describe('Open Food Facts mapping', () => {
  it('maps a product and falls back from kJ', () => {
    const f = fromOff({
      code: '5000000000000',
      product_name: 'Protein Yogurt',
      brands: 'Brand, Other',
      serving_quantity: '200',
      serving_size: '200 g',
      categories_tags: ['en:dairies', 'en:yogurts'],
      nutriments: { energy_100g: 300, proteins_100g: 10, carbohydrates_100g: 5, fat_100g: 1 },
    })!;
    expect(f).toMatchObject({ name: 'Protein Yogurt', brand: 'Brand', category: 'dairy', kcal: 72, servingG: 200, source: 'openfoodfacts', barcode: '5000000000000' });
  });

  it('rejects products without nutrition', () => {
    expect(fromOff({ product_name: 'Mystery' })).toBeNull();
    expect(categoryFromTags(['en:snacks'])).toBe('snacks');
  });
});
