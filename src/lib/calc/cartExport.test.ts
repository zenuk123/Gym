import { describe, expect, it } from 'vitest';
import type { PriceEntry, ShoppingItem } from '../../db/types';
import { buildCartFile, searchTerm } from './cartExport';

const item = (id: string, name: string, amountG: number | null, checked = false, foodId: string | null = null): ShoppingItem => ({
  id, weekStart: '2026-09-28', name, category: 'meat', quantity: amountG ? `${amountG} g` : null, amountG, foodId, checked, source: 'plan', createdAt: 1, updatedAt: 1, deletedAt: null,
});

describe('cart export', () => {
  it('makes supermarket search terms from food names', () => {
    expect(searchTerm('Turkey mince, 5% fat (raw)')).toBe('turkey mince 5% fat');
    expect(searchTerm('Tuna in spring water (drained)')).toBe('tuna in spring water');
    expect(searchTerm('Dark chocolate (70%)')).toBe('dark chocolate 70%');
    expect(searchTerm('Coconut milk, light (canned)')).toBe('coconut milk light');
    expect(searchTerm('Washing-up liquid')).toBe('washing-up liquid');
  });

  it('exports unticked items with packs from the price book', () => {
    const prices: PriceEntry[] = [
      { id: 'p1', itemKey: 'food:chicken', name: 'Chicken', shop: 'Tesco', price: 4.5, packG: 650, updatedOn: '2026-09-28', createdAt: 1, updatedAt: 1, deletedAt: null },
      { id: 'p2', itemKey: 'food:chicken', name: 'Chicken', shop: 'Aldi', price: 3.99, packG: 1000, updatedOn: '2026-09-28', createdAt: 1, updatedAt: 1, deletedAt: null },
    ];
    const f = buildCartFile([item('a', 'Chicken breast (raw)', 1100, false, 'chicken'), item('b', 'Rice', 500, true), item('c', 'Washing-up liquid', null)], {
      weekStart: '2026-09-28',
      shop: 'Tesco',
      prices,
      foods: new Map(),
      now: new Date('2026-09-30T10:00:00Z'),
    });
    expect(f.format).toBe('fitness-os-shopping-list');
    expect(f.items.map((i) => i.name)).toEqual(['Chicken breast (raw)', 'Washing-up liquid']);
    expect(f.items[0]).toMatchObject({ search: 'chicken breast', quantity: 2, price: 9, need: '1100 g' });
    expect(f.items[1]).toMatchObject({ quantity: 1, price: null, need: '1' });
  });
});
