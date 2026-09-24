import type { ISODate, MealSlot, PlanItem, RecipeTag, SavedMeal } from '../../db/types';
import { mealPerServing } from './food';

// Recipes: derived tags, filtering, and the "auto-fill my week" planner. Pure + tested.
// The planner only proposes — nothing is saved until the user confirms.

export const TAG_LABEL: Record<RecipeTag, string> = {
  'high-protein': 'High protein',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  quick: 'Quick',
  'meal-prep': 'Meal prep',
  'low-calorie': 'Light',
};

/** Declared tags (vegetarian/vegan) plus ones worked out from the recipe itself. */
export function recipeTags(m: SavedMeal): RecipeTag[] {
  const tags = new Set<RecipeTag>(m.tags ?? []);
  const n = mealPerServing(m);
  if (n.kcal > 0 && (n.proteinG >= 30 || (n.proteinG * 4) / n.kcal >= 0.3)) tags.add('high-protein');
  if (m.prepMin != null && m.prepMin <= 15) tags.add('quick');
  if (m.servings >= 3) tags.add('meal-prep');
  if (n.kcal > 0 && n.kcal <= (m.slot === 'snack' ? 200 : 450)) tags.add('low-calorie');
  return [...tags];
}

export type RecipeFilter = 'all' | MealSlot | RecipeTag | 'mine' | 'favourites';

export function filterRecipes(meals: SavedMeal[], filter: RecipeFilter, query = ''): SavedMeal[] {
  const q = query.trim().toLowerCase();
  return meals.filter((m) => {
    if (m.items.length === 0) return false;
    if (q && !m.name.toLowerCase().includes(q) && !m.items.some((i) => i.name.toLowerCase().includes(q))) return false;
    if (filter === 'all') return true;
    if (filter === 'mine') return m.source !== 'builtin';
    if (filter === 'favourites') return m.favourite;
    if (filter === 'breakfast' || filter === 'lunch' || filter === 'dinner' || filter === 'snack') return fitsSlot(m, filter);
    return recipeTags(m).includes(filter);
  });
}

/** Lunch and dinner recipes are interchangeable; meals without a usual slot fit any main meal. */
export function fitsSlot(m: SavedMeal, slot: MealSlot): boolean {
  if (m.slot === slot) return true;
  if (slot === 'lunch' || slot === 'dinner') return m.slot === null || m.slot === 'lunch' || m.slot === 'dinner';
  return false;
}

// ── Auto-fill ───────────────────────────────────────────────────────────

/** Rough share of the day's calories per meal. */
export const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.33, snack: 0.12 };

/** Portion sizes the planner may use (servings of the recipe). */
const PORTIONS = [0.75, 1, 1.25, 1.5];

export interface Proposal {
  date: ISODate;
  slot: MealSlot;
  mealId: string;
  servings: number;
  kcal: number;
  proteinG: number;
}

export interface AutoPlanInput {
  recipes: SavedMeal[];
  days: ISODate[];
  slots: MealSlot[];
  /** Already planned items (kept; empty slots only are filled). */
  existing: Pick<PlanItem, 'date' | 'slot' | 'kcal' | 'proteinG' | 'mealId'>[];
  target: { kcal: number; proteinG: number };
  /** Only use recipes having all these tags. */
  require?: RecipeTag[];
  /** Different seed → different (but repeatable) picks. */
  seed?: number;
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How well a portion fits a calorie budget and protein aim (lower is better). */
function score(kcal: number, protein: number, budget: number, proteinAim: number): number {
  const kcalMiss = Math.abs(kcal - budget) / Math.max(1, budget);
  const proteinShort = Math.max(0, proteinAim - protein) / Math.max(1, proteinAim);
  return kcalMiss + 0.6 * proteinShort;
}

function bestPortion(m: SavedMeal, budget: number, proteinAim: number) {
  const per = mealPerServing(m);
  // Batch recipes are portioned as cooked; single recipes can be scaled a little.
  const options = m.servings > 1 ? [1] : PORTIONS;
  let best = { servings: 1, kcal: per.kcal, proteinG: per.proteinG, s: Infinity };
  for (const sv of options) {
    const kcal = per.kcal * sv;
    const p = per.proteinG * sv;
    const s = score(kcal, p, budget, proteinAim);
    if (s < best.s) best = { servings: sv, kcal, proteinG: p, s };
  }
  return best;
}

/**
 * Fill empty meal slots across days with recipes that together land near the calorie and
 * protein targets. Variety: a recipe is used at most twice a week, unless it's a batch recipe
 * (then up to its number of portions, which is the point of meal prep).
 */
export function autoPlan(input: AutoPlanInput): Proposal[] {
  const random = rng(input.seed ?? 1);
  const pool = input.recipes.filter((m) => m.items.length > 0 && m.deletedAt === null && (input.require ?? []).every((t) => recipeTags(m).includes(t)));
  const uses = new Map<string, number>();
  for (const e of input.existing) if (e.mealId) uses.set(e.mealId, (uses.get(e.mealId) ?? 0) + 1);
  const limit = (m: SavedMeal) => (m.servings > 1 ? m.servings : 2);
  const out: Proposal[] = [];

  for (const date of input.days) {
    const planned = input.existing.filter((e) => e.date === date);
    const empty = input.slots.filter((s) => !planned.some((p) => p.slot === s));
    if (!empty.length) continue;
    let kcalLeft = input.target.kcal - planned.reduce((a, p) => a + p.kcal, 0);
    let proteinLeft = input.target.proteinG - planned.reduce((a, p) => a + p.proteinG, 0);
    // Fill bigger meals first so snacks absorb what's left.
    const order = [...empty].sort((a, b) => SLOT_SHARE[b] - SLOT_SHARE[a]);
    let shareLeft = order.reduce((a, s) => a + SLOT_SHARE[s], 0);
    for (const slot of order) {
      const frac = SLOT_SHARE[slot] / shareLeft;
      const budget = Math.max(100, kcalLeft * frac);
      const proteinAim = Math.max(0, proteinLeft * frac);
      const ranked = pool
        .filter((m) => fitsSlot(m, slot) && (uses.get(m.id) ?? 0) < limit(m))
        .map((m) => {
          const b = bestPortion(m, budget, proteinAim);
          // Small random jitter so shuffles give different, still-sensible weeks; prefer favourites.
          return { m, b, s: b.s + random() * 0.25 - (m.favourite ? 0.08 : 0) };
        })
        .sort((x, y) => x.s - y.s);
      const pick = ranked[0];
      shareLeft -= SLOT_SHARE[slot];
      if (!pick) continue;
      uses.set(pick.m.id, (uses.get(pick.m.id) ?? 0) + 1);
      kcalLeft -= pick.b.kcal;
      proteinLeft -= pick.b.proteinG;
      out.push({ date, slot, mealId: pick.m.id, servings: pick.b.servings, kcal: Math.round(pick.b.kcal), proteinG: Math.round(pick.b.proteinG * 10) / 10 });
    }
  }
  return out;
}

/** Alternatives for one slot, best fit for the calories it should take first. */
export function swapOptions(recipes: SavedMeal[], slot: MealSlot, budget: number, proteinAim: number, excludeId?: string | null, limit = 8) {
  return recipes
    .filter((m) => m.items.length > 0 && m.deletedAt === null && m.id !== excludeId && fitsSlot(m, slot))
    .map((m) => ({ meal: m, ...bestPortion(m, budget, proteinAim) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, limit);
}

/** Sum of proposals + existing per day. */
export function dayKcal(date: ISODate, proposals: Proposal[], existing: AutoPlanInput['existing']) {
  const xs = [...proposals.filter((p) => p.date === date), ...existing.filter((e) => e.date === date)];
  return { kcal: Math.round(xs.reduce((a, x) => a + x.kcal, 0)), proteinG: Math.round(xs.reduce((a, x) => a + x.proteinG, 0)) };
}
