import { describe, expect, it } from 'vitest';
import { BUILT_IN_FOODS, builtInFoodId } from '../../db/seed/foods';
import type { SavedMeal, ShoppingItem } from '../../db/types';
import { mealItemFrom } from './food';
import { buildShoppingList, formatQuantity, mergeShopping, planFood, planMeal, shoppingText } from './plan';
import { CATEGORY_LABEL } from './food';

const foods = new Map(BUILT_IN_FOODS.map((f) => [f.id, f]));
const F = (n: string) => foods.get(builtInFoodId(n))!;

const prep: SavedMeal = {
  id: 'm1',
  name: 'Chicken & rice prep',
  slot: 'lunch',
  servings: 4,
  items: [mealItemFrom(F('Chicken breast (raw)'), 600), mealItemFrom(F('White rice (dry)'), 300), mealItemFrom(F('Broccoli'), 320)],
  notes: null,
  favourite: false,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

describe('planning', () => {
  it('scales a batch-cooked meal to one portion', () => {
    const p = planMeal('2026-01-05', 'lunch', prep, 1);
    expect(p.kcal).toBe(Math.round((636 + 1080 + 109) / 4));
    expect(p.items.map((i) => i.grams)).toEqual([150, 75, 80]);
  });

  it('plans a single food with its ingredient line', () => {
    const p = planFood('2026-01-05', 'breakfast', F('Rolled oats'), 80);
    expect(p).toMatchObject({ kind: 'food', kcal: 303, amountG: 80 });
    expect(p.items).toHaveLength(1);
  });
});

describe('shopping list', () => {
  it('adds up ingredients across the week, one line per food', () => {
    const week = [0, 1, 2, 3].map((d) => ({ ...planMeal(`2026-01-0${5 + d}`, 'lunch', prep, 1), deletedAt: null }));
    week.push({ ...planFood('2026-01-05', 'breakfast', F('Egg (large)'), 116), deletedAt: null });
    week.push({ ...planFood('2026-01-06', 'breakfast', F('Egg (large)'), 116), deletedAt: null });
    const lines = buildShoppingList(week, foods);
    const chicken = lines.find((l) => l.name === 'Chicken breast (raw)')!;
    expect(chicken).toMatchObject({ amountG: 600, category: 'meat' });
    expect(chicken.quantity).toBe('600 g (≈ 4 × 1 breast)');
    expect(lines.find((l) => l.name === 'Egg (large)')!.quantity).toBe('232 g (≈ 4 × 1 egg)');
  });

  it('formats large amounts', () => {
    expect(formatQuantity(1250)).toBe('1.3 kg');
    expect(formatQuantity(1500, { unit: 'ml', servingG: null, servingName: null })).toBe('1.5 L');
  });

  it('keeps ticks and manual items when rebuilding', () => {
    const existing = [
      { id: 'a', foodId: builtInFoodId('Broccoli'), name: 'Broccoli', source: 'plan', checked: true },
      { id: 'b', foodId: builtInFoodId('Apple'), name: 'Apple', source: 'plan', checked: false },
      { id: 'c', foodId: null, name: 'Bin bags', source: 'manual', checked: false },
    ] as ShoppingItem[];
    const lines = buildShoppingList([{ items: prep.items, deletedAt: null }], foods);
    const { upserts, removals } = mergeShopping(existing, lines);
    expect(upserts.find((u) => u.name === 'Broccoli')).toMatchObject({ id: 'a', checked: true });
    expect(removals).toEqual(['b']);
    expect(upserts.some((u) => u.name === 'Bin bags')).toBe(false);
  });

  it('shares unchecked items grouped by aisle', () => {
    const items = [
      { name: 'Milk', category: 'dairy', quantity: '2 L', checked: false },
      { name: 'Eggs', category: 'dairy', quantity: null, checked: true },
      { name: 'Apples', category: 'fruit', quantity: '6', checked: false },
    ] as ShoppingItem[];
    expect(shoppingText(items, CATEGORY_LABEL)).toBe('Dairy & eggs\n• Milk — 2 L\n\nFruit\n• Apples — 6');
  });
});
