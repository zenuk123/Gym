import { describe, expect, it } from 'vitest';
import type { Profile } from '../db/types';
import { generateInsights } from './insights';
import type { WeightSummary } from './calc/weight';

const profile = { goal: 'gain_weight', weightUnit: 'kg', proteinTarget: 150 } as Profile;
const weight = (rate: number | null): WeightSummary => ({
  latest: { date: '2026-01-21', weightKg: 62.4 },
  average7: 62.4,
  rate,
  startKg: 62,
  changeKg: 0.4,
  targetKg: 70,
  remainingKg: 7.6,
  progress: 0.05,
});

describe('coach insights', () => {
  it('suggests more calories when a gain goal has stalled — as a suggestion, not a change', () => {
    const [top] = generateInsights({ profile, weight: weight(0.02), recentWeighIns: 12, intake: { kcal: 0, proteinG: 0 }, hour: 9 });
    expect(top.kind).toBe('suggestion');
    expect(top.text).toMatch(/stable/);
    expect(top.text).toMatch(/consider/);
  });

  it('says on track when gaining as intended', () => {
    const [top] = generateInsights({ profile, weight: weight(0.3), recentWeighIns: 12, intake: { kcal: 0, proteinG: 0 }, hour: 9 });
    expect(top.id).toBe('on-track');
  });

  it('flags missing protein in the evening', () => {
    const ins = generateInsights({ profile, weight: weight(0.3), recentWeighIns: 12, intake: { kcal: 1500, proteinG: 60 }, hour: 19 });
    expect(ins[0].id).toBe('protein-evening');
    expect(ins[0].text).toContain('90 g');
  });

  it('asks for weigh-ins when there is no data', () => {
    const empty = { ...weight(null), latest: null };
    const [top] = generateInsights({ profile, weight: empty, recentWeighIns: 0, intake: { kcal: 0, proteinG: 0 }, hour: 9 });
    expect(top.id).toBe('log-weight');
  });

  it('nudges after a training gap and names the next routine', () => {
    const ins = generateInsights({
      profile,
      weight: weight(0.3),
      recentWeighIns: 12,
      intake: { kcal: 0, proteinG: 0 },
      hour: 9,
      training: { daysSinceLast: 5, pbsThisWeek: 0, nextRoutine: 'Pull', active: false },
    });
    expect(ins[0]).toMatchObject({ id: 'train-gap', kind: 'fact' });
    expect(ins[0].text).toContain('Next up: Pull');
  });
});
