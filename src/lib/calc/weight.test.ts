import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { dailySeries, summariseWeight, weeklyRate, windowAverage } from './weight';

const series = (start: string, values: number[]) => values.map((w, i) => ({ date: addDays(start, i), weightKg: w }));

describe('weight trend', () => {
  it('averages multiple weigh-ins on the same day', () => {
    const s = dailySeries([
      { date: '2026-01-02', weightKg: 70 },
      { date: '2026-01-01', weightKg: 69 },
      { date: '2026-01-02', weightKg: 71 },
    ]);
    expect(s).toEqual([
      { date: '2026-01-01', weightKg: 69 },
      { date: '2026-01-02', weightKg: 70.5 },
    ]);
  });

  it('computes a trailing window average', () => {
    const s = series('2026-01-01', [60, 61, 62, 63, 64, 65, 66, 67]);
    expect(windowAverage(s, '2026-01-08', 7)).toBeCloseTo(64); // 61..67
  });

  it('measures kg/week via regression and ignores noise', () => {
    // +0.05 kg/day = +0.35 kg/week with alternating ±0.3 noise
    const s = series('2026-01-01', Array.from({ length: 21 }, (_, i) => 60 + i * 0.05 + (i % 2 ? 0.3 : -0.3)));
    expect(weeklyRate(s, '2026-01-21')!).toBeCloseTo(0.35, 1);
  });

  it('needs enough data before reporting a rate', () => {
    expect(weeklyRate(series('2026-01-01', [60, 60.2]), '2026-01-02')).toBeNull();
  });

  it('reports progress toward the target from the start weight', () => {
    const s = summariseWeight(series('2026-01-01', [64, 64, 64, 64, 64, 64, 64]), 62, 70);
    expect(s.changeKg).toBeCloseTo(2);
    expect(s.progress).toBeCloseTo(0.25);
    expect(s.remainingKg).toBeCloseTo(6);
  });

  it('clamps progress when moving away from the goal', () => {
    const s = summariseWeight([{ date: '2026-01-01', weightKg: 60 }], 62, 70);
    expect(s.progress).toBe(0);
  });
});
