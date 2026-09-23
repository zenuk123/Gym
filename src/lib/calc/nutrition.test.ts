import { describe, expect, it } from 'vitest';
import { calcBMR, estimateCalories, estimateMacros, estimateProtein, suggestTargets } from './nutrition';

describe('nutrition calculations', () => {
  it('computes Mifflin–St Jeor BMR', () => {
    // 10*70 + 6.25*175 - 5*25 + 5 = 1673.75
    expect(calcBMR({ sex: 'male', age: 25, heightCm: 175, weightKg: 70 })).toBeCloseTo(1673.75);
    expect(calcBMR({ sex: 'female', age: 25, heightCm: 175, weightKg: 70 })).toBeCloseTo(1507.75);
  });

  it('adds the goal adjustment to maintenance and rounds to 10 kcal', () => {
    const stats = { sex: 'male' as const, age: 25, heightCm: 175, weightKg: 70 };
    const maintain = estimateCalories(stats, 'moderate', 'maintain');
    const gain = estimateCalories(stats, 'moderate', 'gain_weight');
    expect(maintain.target % 10).toBe(0);
    expect(maintain.maintenance).toBe(2590); // 1673.75 * 1.55 = 2594.3
    expect(gain.target - maintain.target).toBe(400);
  });

  it('never suggests below a safe floor', () => {
    const tiny = estimateCalories({ sex: 'female', age: 70, heightCm: 145, weightKg: 40 }, 'sedentary', 'lose');
    expect(tiny.target).toBeGreaterThanOrEqual(Math.min(1200, tiny.bmr) - 10);
  });

  it('suggests protein per kg by goal', () => {
    expect(estimateProtein(62, 'gain_muscle')).toBe(125); // 124 → nearest 5
    expect(estimateProtein(80, 'lose')).toBe(175); // 176 → 175
  });

  it('splits remaining calories into carbs and fat', () => {
    const { carbsG, fatG } = estimateMacros(2800, 150);
    expect(fatG).toBe(80); // 2800*.25/9 = 77.8 → 80
    expect(carbsG).toBe(370); // (2800 - 600 - 720)/4 = 370
  });

  it('suggestTargets combines everything', () => {
    const s = suggestTargets(
      { sex: 'male', birthYear: 2000, heightCm: 178, weightKg: 62.4, activityLevel: 'moderate', goal: 'gain_weight' },
      new Date('2026-06-01'),
    );
    expect(s.calories.target).toBeGreaterThan(s.calories.maintenance);
    expect(s.protein).toBeGreaterThan(100);
  });
});
