import { FOOD_CATEGORIES, type Food, type FoodCategory, type MealItem, type MealSlot } from '../../db/types';
import { mealItemFrom, sumNutrients, type Nutrients } from '../../lib/calc/food';
import { newId } from '../../lib/id';

// AI meal ideas: prompt + JSON schema for structured output, and the pure conversion of
// the model's answer into meal ingredient lines. Where an ingredient matches one of the
// user's foods, the app's own nutrition values are used instead of the model's estimate.

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slot: { type: 'string', enum: SLOTS },
          servings: { type: 'integer', description: 'Portions the ingredient amounts make.' },
          why: { type: 'string', description: 'One sentence: why this fits their targets and request.' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Use the exact name from the food list when using one of their foods.' },
                grams: { type: 'number', description: 'Total grams (or ml) for the whole recipe.' },
                category: { type: 'string', enum: [...FOOD_CATEGORIES] },
                kcal_per_100g: { type: 'number' },
                protein_per_100g: { type: 'number' },
                carbs_per_100g: { type: 'number' },
                fat_per_100g: { type: 'number' },
              },
              required: ['name', 'grams', 'category', 'kcal_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g'],
              additionalProperties: false,
            },
          },
          method: { type: 'string', description: 'Short method, 2–4 sentences.' },
        },
        required: ['name', 'slot', 'servings', 'why', 'ingredients', 'method'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
} as const;

export const MEAL_SYSTEM = `You create practical meal ideas for a person using a fitness app. Ideas must fit their calorie and protein targets, respect their preferences and restrictions, and use everyday ingredients — prefer foods from their own food list where they fit. Give realistic gram amounts and typical nutrition values per 100 g (cooked or raw as the ingredient is weighed). Keep methods short. British English. Never go below safe intakes; you are not a dietitian.`;

export interface MealIdeaRequest {
  kind: 'meal' | 'rest-of-day' | 'prep';
  slot: MealSlot;
  count: number;
  preferences: string;
  targets: { kcal: number; proteinG: number };
  remainingToday: { kcal: number; proteinG: number } | null;
  foods: Pick<Food, 'name' | 'kcal' | 'proteinG' | 'carbsG' | 'fatG'>[];
}

export function mealPrompt(r: MealIdeaRequest): string {
  const goal =
    r.kind === 'rest-of-day' && r.remainingToday
      ? `ideas for what to eat for the rest of today. They have about ${Math.max(0, Math.round(r.remainingToday.kcal))} kcal and ${Math.max(0, Math.round(r.remainingToday.proteinG))} g protein left for the day — ideas together should roughly fill that, one serving each`
      : r.kind === 'prep'
        ? `batch-cook recipes for ${r.slot} that make 4–5 portions each, each portion suiting a day of ${r.targets.kcal} kcal / ${r.targets.proteinG} g protein`
        : `${r.slot} ideas, one serving each, suiting a day of ${r.targets.kcal} kcal / ${r.targets.proteinG} g protein`;
  const foods = r.foods
    .slice(0, 40)
    .map((f) => `${f.name}: ${f.kcal} kcal, ${f.proteinG}P ${f.carbsG}C ${f.fatG}F`)
    .join('\n');
  return [
    `Suggest ${r.count} ${goal}.`,
    r.preferences.trim() ? `Their preferences / restrictions: ${r.preferences.trim()}` : 'No stated restrictions.',
    foods ? `Foods they use often (per 100 g):\n${foods}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface RawIdea {
  name: string;
  slot: string;
  servings: number;
  why: string;
  method: string;
  ingredients: { name: string; grams: number; category: string; kcal_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number }[];
}

export interface MealIdea {
  key: string;
  name: string;
  slot: MealSlot;
  servings: number;
  why: string;
  method: string;
  items: MealItem[];
  perServing: Nutrients;
  /** How many ingredients use the app's own food values (the rest are AI estimates). */
  matched: number;
}

const num = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/** Validate and convert the model's JSON. Invalid ideas/ingredients are dropped, not guessed. */
export function toMealIdeas(raw: unknown, foods: Food[]): MealIdea[] {
  const ideas = (raw as { ideas?: unknown })?.ideas;
  if (!Array.isArray(ideas)) return [];
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  const out: MealIdea[] = [];
  for (const i of ideas as RawIdea[]) {
    if (!i || typeof i.name !== 'string' || !Array.isArray(i.ingredients)) continue;
    const servings = num(i.servings, 1, 12) ? Math.round(i.servings) : 1;
    let matched = 0;
    const items: MealItem[] = [];
    for (const g of i.ingredients) {
      if (!g || typeof g.name !== 'string' || !num(g.grams, 1, 5000)) continue;
      const food = byName.get(g.name.toLowerCase());
      if (food) {
        matched++;
        items.push(mealItemFrom(food, Math.round(g.grams)));
        continue;
      }
      if (![g.kcal_per_100g, g.protein_per_100g, g.carbs_per_100g, g.fat_per_100g].every((v) => num(v, 0, 900))) continue;
      const f = g.grams / 100;
      items.push({
        key: newId(),
        foodId: null,
        name: g.name,
        grams: Math.round(g.grams),
        category: (FOOD_CATEGORIES as readonly string[]).includes(g.category) ? (g.category as FoodCategory) : 'other',
        kcal: Math.round(g.kcal_per_100g * f),
        proteinG: Math.round(g.protein_per_100g * f * 10) / 10,
        carbsG: Math.round(g.carbs_per_100g * f * 10) / 10,
        fatG: Math.round(g.fat_per_100g * f * 10) / 10,
        fibreG: null,
      });
    }
    if (!items.length) continue;
    const total = sumNutrients(items);
    out.push({
      key: newId(),
      name: i.name.slice(0, 80),
      slot: SLOTS.includes(i.slot as MealSlot) ? (i.slot as MealSlot) : 'lunch',
      servings,
      why: typeof i.why === 'string' ? i.why : '',
      method: typeof i.method === 'string' ? i.method : '',
      items,
      perServing: {
        kcal: Math.round(total.kcal / servings),
        proteinG: Math.round((total.proteinG / servings) * 10) / 10,
        carbsG: Math.round((total.carbsG / servings) * 10) / 10,
        fatG: Math.round((total.fatG / servings) * 10) / 10,
        fibreG: null,
      },
      matched,
    });
  }
  return out;
}
