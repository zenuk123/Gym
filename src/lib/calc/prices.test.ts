import { describe, expect, it } from 'vitest';
import type { PriceEntry, ShoppingItem } from '../../db/types';
import { bestMix, formatMoney, itemKey, lineCost, priceIndex, shopTotals } from './prices';

const meta = { createdAt: 1, deletedAt: null };
let n = 0;
const item = (name: string, amountG: number | null, foodId: string | null = null): ShoppingItem => ({
  id: `i${++n}`, weekStart: '2026-03-02', name, category: 'other', quantity: null, amountG, foodId, checked: false, source: 'plan', ...meta, updatedAt: 1,
});
const price = (key: string, shop: string, p: number, packG: number | null, updatedAt = 1): PriceEntry => ({
  id: `p${++n}`, itemKey: key, name: key, shop, price: p, packG, updatedOn: '2026-03-01', ...meta, updatedAt,
});

describe('price book', () => {
  it('keys items by food, or by normalised name', () => {
    expect(itemKey({ foodId: 'chicken', name: 'Chicken breast' })).toBe('food:chicken');
    expect(itemKey({ foodId: null, name: '  Washing-up   Liquid ' })).toBe('name:washing-up liquid');
  });

  it('buys whole packs', () => {
    expect(lineCost({ price: 3.5, packG: 500 }, 900)).toEqual({ cost: 7, packs: 2 });
    expect(lineCost({ price: 3.5, packG: 500 }, 1000)).toEqual({ cost: 7, packs: 2 });
    expect(lineCost({ price: 3.5, packG: 500 }, 120)).toEqual({ cost: 3.5, packs: 1 });
    expect(lineCost({ price: 1.2, packG: null }, 900)).toEqual({ cost: 1.2, packs: null });
    expect(lineCost({ price: 1.2, packG: 400 }, null)).toEqual({ cost: 1.2, packs: null });
  });

  it('totals per shop, best mix, and uses the newest price', () => {
    const chicken = item('Chicken breast', 1200, 'chicken');
    const rice = item('Rice', 500, 'rice');
    const soap = item('Washing-up liquid', null);
    const idx = priceIndex([
      price('food:chicken', 'Tesco', 5, 1000),
      price('food:chicken', 'Aldi', 4.2, 1000),
      price('food:rice', 'Tesco', 1.1, 1000),
      price('food:rice', 'Tesco', 0.99, 1000, 5), // newer
      price('name:washing-up liquid', 'Aldi', 0.89, null),
    ]);
    const t = shopTotals([chicken, rice, soap], idx);
    expect(t).toEqual([
      { shop: 'Aldi', total: 9.29, priced: 2, lines: 3 },
      { shop: 'Tesco', total: 10.99, priced: 2, lines: 3 },
    ]);
    const mix = bestMix([chicken, rice, soap], idx);
    expect(mix.total).toBe(10.28);
    expect(mix.shopFor.get(rice.id)).toBe('Tesco');
    expect(mix.shopFor.get(chicken.id)).toBe('Aldi');
  });

  it('formats money', () => {
    expect(formatMoney(3.5)).toBe('£3.50');
    expect(formatMoney(3.5, 'EUR')).toBe('€3.50');
  });
});
