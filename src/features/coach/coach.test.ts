import { describe, expect, it } from 'vitest';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Food } from '../../db/types';
import { echoable, modelParams } from './claude';
import { MEAL_SCHEMA, mealPrompt, toMealIdeas } from './mealIdeas';
import { toolDefinitions, validateInput, TOOLS } from './tools';

const oats: Food = {
  id: 'oats',
  name: 'Porridge oats',
  brand: null,
  category: 'carbs',
  unit: 'g',
  kcal: 375,
  proteinG: 11,
  carbsG: 60,
  fatG: 8,
  fibreG: 9,
  servingG: 40,
  servingName: '1 bowl',
  barcode: null,
  source: 'builtin',
  favourite: false,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

describe('coach tools', () => {
  it('builds strict-looking JSON schemas with eager streaming on request', () => {
    const defs = toolDefinitions(true);
    expect(defs).toHaveLength(TOOLS.length);
    const ex = defs.find((d) => d.name === 'get_exercise_history')!;
    expect(ex.eager_input_streaming).toBe(true);
    expect(ex.input_schema.required).toEqual(['exercise']);
    expect(ex.input_schema.additionalProperties).toBe(false);
    expect(toolDefinitions(false)[0]).not.toHaveProperty('eager_input_streaming');
  });

  it('validates tolerant-parsed input before running', () => {
    expect(validateInput('get_weight_trend', {})).toBeNull();
    expect(validateInput('get_weight_trend', { days: 30 })).toBeNull();
    expect(validateInput('get_weight_trend', { days: 0 })).toMatch(/range/);
    expect(validateInput('get_weight_trend', { days: '30' })).toMatch(/integer/);
    expect(validateInput('get_exercise_history', {})).toMatch(/Missing exercise/);
    expect(validateInput('get_food_log', { date: '2026-3-1' })).toMatch(/format/);
    expect(validateInput('get_food_log', { date: '2026-03-01', extra: 1 })).toMatch(/Unexpected/);
    expect(validateInput('delete_everything', {})).toMatch(/Unknown tool/);
  });
});

describe('claude helpers', () => {
  it('opts Opus 5 into server-side refusal fallbacks only', () => {
    expect(modelParams('claude-opus-5')).toEqual({ model: 'claude-opus-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(modelParams('claude-sonnet-5')).toEqual({ model: 'claude-sonnet-5' });
  });

  it('drops pre-fallback thinking/tool_use blocks when echoing a turn back', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'partial', citations: null },
      { type: 'tool_use', id: 't1', name: 'x', input: {} },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'text', text: 'rest', citations: null },
      { type: 'tool_use', id: 't2', name: 'y', input: {} },
    ] as unknown as BetaContentBlock[];
    const out = echoable(content) as { type: string; id?: string }[];
    expect(out.map((b) => b.type)).toEqual(['text', 'fallback', 'text', 'tool_use']);
    expect(out.at(-1)!.id).toBe('t2');
    const plain = [{ type: 'text', text: 'hi', citations: null }] as unknown as BetaContentBlock[];
    expect(echoable(plain)).toEqual(plain);
  });
});

describe('meal ideas', () => {
  it('asks for the right thing', () => {
    const p = mealPrompt({ kind: 'rest-of-day', slot: 'dinner', count: 3, preferences: 'no fish', targets: { kcal: 2200, proteinG: 160 }, remainingToday: { kcal: 900.4, proteinG: 71.6 }, foods: [oats] });
    expect(p).toMatch(/900 kcal and 72 g protein left/);
    expect(p).toMatch(/no fish/);
    expect(p).toMatch(/Porridge oats: 375 kcal/);
    expect(MEAL_SCHEMA.required).toEqual(['ideas']);
  });

  it('uses the app’s food values where names match and drops invalid lines', () => {
    const ideas = toMealIdeas(
      {
        ideas: [
          {
            name: 'Protein oats',
            slot: 'breakfast',
            servings: 1,
            why: 'High protein',
            method: 'Mix.',
            ingredients: [
              { name: 'porridge oats', grams: 60, category: 'carbs', kcal_per_100g: 999, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 0 },
              { name: 'Whey', grams: 30, category: 'other', kcal_per_100g: 400, protein_per_100g: 80, carbs_per_100g: 8, fat_per_100g: 6 },
              { name: 'Bad', grams: -5, category: 'other', kcal_per_100g: 1, protein_per_100g: 1, carbs_per_100g: 1, fat_per_100g: 1 },
            ],
          },
          { name: 'Empty', slot: 'lunch', servings: 1, why: '', method: '', ingredients: [] },
        ],
      },
      [oats],
    );
    expect(ideas).toHaveLength(1);
    const i = ideas[0];
    expect(i.items).toHaveLength(2);
    expect(i.matched).toBe(1);
    expect(i.items[0]).toMatchObject({ foodId: 'oats', grams: 60, kcal: 225 });
    expect(i.items[1]).toMatchObject({ foodId: null, kcal: 120, proteinG: 24 });
    expect(i.perServing.kcal).toBe(345);
  });

  it('splits batch recipes into portions', () => {
    const [i] = toMealIdeas({ ideas: [{ name: 'Chilli', slot: 'dinner', servings: 4, why: '', method: '', ingredients: [{ name: 'Mince', grams: 1000, category: 'meat', kcal_per_100g: 200, protein_per_100g: 20, carbs_per_100g: 0, fat_per_100g: 13 }] }] }, []);
    expect(i.perServing).toMatchObject({ kcal: 500, proteinG: 50 });
    expect(toMealIdeas('nonsense', [])).toEqual([]);
  });
});

describe('coach tools against the local database', () => {
  it('reads profile, weight and review data', async () => {
    const { db } = await import('../../db/db');
    const { runTool } = await import('./tools');
    const { addDays, todayISO } = await import('../../lib/dates');
    const today = todayISO();
    const meta = { createdAt: 1, updatedAt: 1, deletedAt: null };
    await db.profile.put({
      id: 'me', ...meta, name: 'Sam', sex: 'female', birthYear: 1995, heightCm: 168, activityLevel: 'moderate', goal: 'lose', startWeightKg: 70, startDate: addDays(today, -30),
      targetWeightKg: 65, calorieTarget: 1900, proteinTarget: 130, carbTarget: null, fatTarget: null, waterTargetMl: 2500, workoutsPerWeek: 3, weightUnit: 'kg', lengthUnit: 'cm',
    });
    for (let i = 0; i < 10; i++) await db.weights.put({ id: `w${i}`, ...meta, date: addDays(today, -i), weightKg: 68 + i * 0.1, note: null });
    await db.foodLogs.put({ id: 'f1', ...meta, date: today, meal: 'lunch', name: 'Wrap', kcal: 500, proteinG: 30, carbsG: 50, fatG: 15, fibreG: null });

    const o = (await runTool('get_overview', {})) as { targets: { kcal: number }; todaySoFar: { kcal: number }; dataCounts: { weighIns: number } };
    expect(o.targets.kcal).toBe(1900);
    expect(o.todaySoFar.kcal).toBe(500);
    expect(o.dataCounts.weighIns).toBe(10);

    const w = (await runTool('get_weight_trend', { days: 30 })) as { average7Kg: number; ratePerWeekKg: number | null };
    expect(w.average7Kg).toBeCloseTo(68.3, 1);

    const r = (await runTool('get_weekly_review', {})) as { summary: string };
    expect(r.summary).toMatch(/Workouts: 0\/3/);

    const ex = (await runTool('get_exercise_history', { exercise: 'bench' })) as { found: boolean };
    expect(ex.found).toBe(false);
  });
});
