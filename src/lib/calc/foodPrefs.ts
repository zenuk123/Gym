import type { Cuisine, FoodChallenge, FoodPrefs, Goal, ISODate, MealSlot, Profile, SavedMeal } from '../../db/types';
import { parseISODate } from '../dates';
import type { InsightKind } from '../insights';
import { mealPerServing, mealTotal } from './food';
import { costTier, recipeAllergens, suitsDiet } from './ingredients';

// Turns the "Tell me how you eat" answers into recipe filtering, goal-aware ranking (with
// reasons you can read), tips for your biggest challenges, and settings for auto-fill.
// Nothing here changes targets — it only chooses and explains recipes.

export const CUISINE_LABEL: Record<Cuisine, string> = {
  british: 'British',
  italian: 'Italian',
  asian: 'Asian',
  indian: 'Indian',
  mexican: 'Mexican',
  mediterranean: 'Mediterranean',
  'middle-eastern': 'Middle Eastern',
};

const FOCUS_FOR_GOAL: Record<Goal, FoodPrefs['focus']> = { lose: 'fullness', maintain: 'healthy', gain_weight: 'fuel', gain_muscle: 'protein' };

export function defaultPrefs(profile: Pick<Profile, 'goal'>): FoodPrefs {
  return {
    focus: FOCUS_FOR_GOAL[profile.goal],
    diet: 'everything',
    avoid: [],
    dislikes: [],
    breakfast: true,
    snacks: 1,
    weekdayMin: 30,
    weekendMin: null,
    batch: 'sometimes',
    budget: 'normal',
    cuisines: [],
    challenges: [],
    sameBreakfast: false,
    answeredAt: 0,
  };
}

export const prefsOf = (p: Profile): FoodPrefs => ({ ...defaultPrefs(p), ...(p.foodPrefs ?? {}) });

const isWeekend = (date: ISODate) => [0, 6].includes(parseISODate(date).getDay());

export interface FitResult {
  ok: boolean;
  /** Why it was ruled out (first reason). */
  why?: string;
}

/** Hard rules: diet, allergens, dislikes, and (for main meals) the time you have that day. */
export function recipeFits(m: SavedMeal, prefs: FoodPrefs, opts: { date?: ISODate; slot?: MealSlot } = {}): FitResult {
  if (!suitsDiet(m, prefs.diet)) return { ok: false, why: `Not ${prefs.diet}` };
  const allergens = recipeAllergens(m);
  const hit = prefs.avoid.find((a) => allergens.includes(a));
  if (hit) return { ok: false, why: `Contains ${hit}` };
  const text = [m.name, ...m.items.map((i) => i.name)].join(' ').toLowerCase();
  const dislike = prefs.dislikes.find((d) => d.trim() && text.includes(d.trim().toLowerCase().replace(/s$/, '')));
  if (dislike) return { ok: false, why: `Has ${dislike}` };
  const slot = opts.slot ?? m.slot;
  if (m.prepMin != null && (slot === 'lunch' || slot === 'dinner' || slot === null)) {
    const limit = opts.date ? (isWeekend(opts.date) ? prefs.weekendMin : prefs.weekdayMin) : Math.max(prefs.weekdayMin ?? Infinity, prefs.weekendMin ?? Infinity);
    // Batch recipes are cooked once for several meals, so allow them 2× the time.
    if (limit != null && Number.isFinite(limit) && m.prepMin > (m.servings > 1 ? limit * 2 : limit)) return { ok: false, why: `Takes ${m.prepMin} min` };
  }
  return { ok: true };
}

export interface Scored {
  meal: SavedMeal;
  /** Higher is better. Roughly 0–10. */
  score: number;
  /** Short reasons, most important first. */
  reasons: string[];
}

/** kcal per 100 g of the finished recipe (lower = more filling for the calories). */
export function energyDensity(m: SavedMeal): number | null {
  const grams = m.items.reduce((a, i) => a + i.grams, 0);
  if (!grams) return null;
  return (mealTotal(m).kcal / grams) * 100;
}

/** How well a recipe supports your goal and preferences, with reasons you can read. */
export function scoreRecipe(m: SavedMeal, profile: Pick<Profile, 'goal' | 'proteinTarget'>, prefs: FoodPrefs): Scored {
  const n = mealPerServing(m);
  const density = energyDensity(m) ?? 150;
  const proteinPer100 = n.kcal > 0 ? (n.proteinG / n.kcal) * 100 : 0;
  const fibre = n.fibreG ?? 0;
  const veg = m.items.filter((i) => i.category === 'vegetables' || i.category === 'fruit').length;
  const reasons: [number, string][] = [];
  let score = 0;
  const add = (pts: number, reason?: string) => {
    score += pts;
    if (reason && pts > 0.4) reasons.push([pts, reason]);
  };

  const challenges = new Set<FoodChallenge>(prefs.challenges);
  const focus = prefs.focus;
  // Protein: everyone benefits; the protein focus / challenge doubles it.
  const proteinWeight = focus === 'protein' || challenges.has('protein') ? 2 : 1;
  add(Math.min(2, n.proteinG / 20) * proteinWeight, `${Math.round(n.proteinG)} g protein`);
  if (proteinPer100 >= 8) add(proteinWeight * 0.8, `Lean: ${Math.round(proteinPer100)} g protein per 100 kcal`);

  if (focus === 'fullness' || challenges.has('hungry') || challenges.has('snacking')) {
    const w = focus === 'fullness' ? 1.5 : 1;
    if (density <= 110) add(1.5 * w, `Filling: only ${Math.round(density)} kcal per 100 g`);
    else if (density <= 150) add(0.8 * w, `Filling: ${Math.round(density)} kcal per 100 g`);
    else add(-0.5 * w);
    if (fibre >= 8) add(0.8 * w, `${Math.round(fibre)} g fibre`);
  }
  if (focus === 'fuel' || challenges.has('low-appetite')) {
    const w = focus === 'fuel' ? 1.5 : 1;
    if (n.kcal >= 600) add(1.2 * w, `${Math.round(n.kcal)} kcal a portion — helps you eat enough`);
    if (density >= 180) add(0.8 * w, 'Energy-dense, easier to eat when you’re not hungry');
  }
  if (focus === 'healthy') {
    if (veg >= 3) add(1.2, `${veg} kinds of fruit & veg`);
    if (fibre >= 8) add(0.8, `${Math.round(fibre)} g fibre`);
  }
  const quick = m.prepMin != null && m.prepMin <= 15;
  if (focus === 'time' || challenges.has('no-time')) {
    if (quick) add(1.5, `Ready in ${m.prepMin} min`);
    if (m.servings > 1) add(1.2, `Cook once, ${m.servings} portions`);
  } else if (quick) add(0.3);
  if (prefs.batch === 'love' && m.servings > 1) add(1.2, `Batch-cooks ${m.servings} portions`);
  if (prefs.batch === 'fresh' && m.servings > 1) add(-0.6);
  if (m.cuisine && prefs.cuisines.includes(m.cuisine)) add(1, `${CUISINE_LABEL[m.cuisine]} — you like this`);
  const tier = costTier(m);
  if (prefs.budget === 'tight') add(tier === 1 ? 0.8 : tier === 3 ? -1 : -0.3, tier === 1 ? 'Budget-friendly' : undefined);
  if (m.favourite) add(1, 'One of your favourites');
  // Fat-loss goal: nudge away from very calorie-heavy portions.
  if (profile.goal === 'lose' && n.kcal > 750) add(-0.8);

  reasons.sort((a, b) => b[0] - a[0]);
  return { meal: m, score: Math.round(score * 10) / 10, reasons: reasons.map((r) => r[1]).slice(0, 3) };
}

/** Recipes that fit your answers, best for your goal first. */
export function recommend(meals: SavedMeal[], profile: Pick<Profile, 'goal' | 'proteinTarget'>, prefs: FoodPrefs, slot?: MealSlot): Scored[] {
  return meals
    .filter((m) => m.deletedAt === null && m.items.length > 0 && recipeFits(m, prefs, { slot }).ok)
    .filter((m) => !slot || m.slot === slot || (slot !== 'breakfast' && slot !== 'snack' && (m.slot === 'lunch' || m.slot === 'dinner' || m.slot === null)))
    .map((m) => scoreRecipe(m, profile, prefs))
    .sort((a, b) => b.score - a.score || a.meal.name.localeCompare(b.meal.name));
}

export interface Tip {
  kind: InsightKind | 'general';
  text: string;
}

/** Tips aimed at your goal and the challenges you picked. */
export function prefTips(prefs: FoodPrefs, profile: Pick<Profile, 'goal' | 'proteinTarget' | 'calorieTarget'>): Tip[] {
  const meals = (prefs.breakfast ? 3 : 2) + (prefs.snacks > 0 ? 1 : 0);
  const perMeal = Math.round(profile.proteinTarget / meals / 5) * 5;
  const tips: Tip[] = [
    { kind: 'calculation', text: `To reach ${profile.proteinTarget} g protein over ${meals} meals, aim for about ${perMeal} g each.` },
  ];
  const c = new Set(prefs.challenges);
  if (c.has('snacking')) tips.push({ kind: 'suggestion', text: 'Plan an evening snack instead of fighting it: something high-protein around 150–250 kcal (skyr with berries, cottage cheese rice cakes) keeps it in your numbers.' });
  if (c.has('hungry')) tips.push({ kind: 'suggestion', text: 'Build meals around protein and veg — recipes marked “Filling” have under 150 kcal per 100 g, so you get more food for your calories.' });
  if (c.has('low-appetite')) tips.push({ kind: 'suggestion', text: 'Drink some of your calories (shakes, smoothies, milk) and add easy extras like olive oil, nut butter or cheese — it’s easier than bigger plates.' });
  if (c.has('protein')) tips.push({ kind: 'suggestion', text: `Start each meal with the protein: ${perMeal} g is roughly a chicken breast, a can of tuna, 250 g Greek yoghurt or a scoop of whey with milk.` });
  if (c.has('eating-out')) tips.push({ kind: 'suggestion', text: 'Eating out: pick a grilled protein with veg or salad, and log a quick estimate — close enough beats not logging.' });
  if (c.has('no-time')) tips.push({ kind: 'suggestion', text: 'Batch-cook twice a week: one meal-prep recipe makes 4 portions, so two sessions cover most lunches and dinners.' });
  if (c.has('bored')) tips.push({ kind: 'suggestion', text: 'Try one new cuisine a week — Auto-fill’s Shuffle gives a different plan each time, and your favourites keep coming back.' });
  if (profile.goal === 'lose') tips.push({ kind: 'general', text: 'For fat loss, protein and fibre keep you fuller for longer on fewer calories.' });
  if (profile.goal === 'gain_weight' || profile.goal === 'gain_muscle') tips.push({ kind: 'general', text: 'To gain, consistency matters most: eat at your target most days and spread protein across your meals.' });
  return tips;
}

/** Everything auto-fill needs from your answers. */
export function planSettings(prefs: FoodPrefs, profile: Pick<Profile, 'goal' | 'proteinTarget'>) {
  const slots: MealSlot[] = [...(prefs.breakfast ? (['breakfast'] as MealSlot[]) : []), 'lunch', 'dinner', ...Array<MealSlot>(prefs.snacks).fill('snack')];
  const bonus = new Map<string, number>();
  return {
    slots,
    allow: (m: SavedMeal, date: ISODate, slot: MealSlot) => recipeFits(m, prefs, { date, slot }).ok,
    /** Preference bonus (≈0–1) used to break ties in favour of what suits you. */
    bonus: (m: SavedMeal) => {
      if (!bonus.has(m.id)) bonus.set(m.id, Math.max(0, Math.min(1, scoreRecipe(m, profile, prefs).score / 10)));
      return bonus.get(m.id)!;
    },
    portions: profile.goal === 'gain_weight' || prefs.focus === 'fuel' ? [1, 1.25, 1.5, 2] : [0.75, 1, 1.25, 1.5],
    sameBreakfast: prefs.sameBreakfast,
  };
}


/** One-line summary of the answers, for AI prompts. */
export function prefsSummary(p: FoodPrefs): string {
  const parts = [
    p.diet !== 'everything' ? p.diet : '',
    p.avoid.length ? `allergies/intolerances: ${p.avoid.join(', ')}` : '',
    p.dislikes.length ? `dislikes: ${p.dislikes.join(', ')}` : '',
    p.weekdayMin ? `weekday cooking max ${p.weekdayMin} min` : '',
    p.budget === 'tight' ? 'budget-friendly ingredients' : '',
    p.cuisines.length ? `likes ${p.cuisines.map((c) => CUISINE_LABEL[c]).join(', ')} food` : '',
    p.batch === 'love' ? 'loves batch cooking' : p.batch === 'fresh' ? 'prefers cooking fresh' : '',
  ];
  return parts.filter(Boolean).join('; ');
}
