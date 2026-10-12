import { describe, expect, it } from 'vitest';
import { fromOff } from './openFoodFacts';

describe('Open Food Facts mapping', () => {
  const base = { product_name: 'Oat bar', code: '123', nutriments: { 'energy-kcal_100g': 410, proteins_100g: 8, carbohydrates_100g: 60, fat_100g: 15 } };
  it('maps a normal product', () => {
    expect(fromOff(base)).toMatchObject({ name: 'Oat bar', kcal: 410, proteinG: 8, carbsG: 60, fatG: 15 });
  });
  it('falls back to kJ', () => {
    expect(fromOff({ ...base, nutriments: { energy_100g: 1715, proteins_100g: 8 } })?.kcal).toBe(410);
  });
  it('skips impossible per-100 g values', () => {
    expect(fromOff({ ...base, nutriments: { ...base.nutriments, 'energy-kcal_100g': 1715 } })).toBeNull(); // kJ in the kcal field
    expect(fromOff({ ...base, nutriments: { ...base.nutriments, proteins_100g: 160 } })).toBeNull();
    expect(fromOff({ ...base, nutriments: { ...base.nutriments, carbohydrates_100g: 80, fat_100g: 40 } })).toBeNull();
  });
});
