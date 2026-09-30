import type { Allergen, Diet, MealItem, SavedMeal } from '../../db/types';

// What's in a recipe, worked out from ingredient names: diet (vegan → vegetarian → pescatarian →
// everything), allergens, and pricier ingredients. Reliable for the built-in foods; for your own
// foods it's a best guess from the name — the UI always says to check labels for allergies.

export type Flag = 'meat' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'honey' | 'gluten' | 'peanut' | 'tree-nut' | 'soy' | 'premium';

const RULES: [Flag, RegExp][] = [
  ['meat', /\b(chicken|turkey|beef|steak|sirloin|pork|sausage|bacon|ham|chorizo|lamb|mince|duck|venison|salami|pepperoni)\b/],
  ['fish', /\b(salmon|cod|tuna|mackerel|haddock|sardines?|anchov(y|ies)|trout|fish|sea bass)\b/],
  ['shellfish', /\b(prawns?|shrimps?|crab|mussels?|lobster|scallops?|squid)\b/],
  ['dairy', /\b(milk|yogh?urt|skyr|cheese|cheddar|mozzarella|feta|butter|cream|halloumi|paneer|parmesan|whey|latte|cottage|pesto|protein bar)\b/],
  ['egg', /\b(eggs?|mayonnaise|egg noodles)\b/],
  ['honey', /\bhoney\b/],
  ['gluten', /\b(bread|bagel|pasta|noodles|couscous|wrap|weetabix|granola|digestive|cornflakes|lager|pitta|oats|soy sauce|biscuit|flour|spaghetti|barley)\b/],
  ['peanut', /\bpeanuts?\b/],
  ['tree-nut', /\b(almonds?|walnuts?|cashews?|hazelnuts?|pecans?|pistachios?|mixed nuts|pesto)\b/],
  ['soy', /\b(tofu|soy|soya|edamame|tempeh)\b/],
  ['premium', /\b(steak|sirloin|salmon|smoked salmon|prawns?|halloumi|paneer|avocado|almonds|mixed nuts|pine nuts|parmesan|chorizo)\b/],
];

// Plant "milks", peanut butter and rice noodles aren't dairy / gluten: strip them before matching.
const STRIP: Partial<Record<Flag, RegExp>> = {
  dairy: /\b(oat|coconut|almond|soy|soya|rice) milk\b|\bpeanut butter\b/g,
  gluten: /\brice noodles\b/g,
};

export function ingredientFlags(name: string): Set<Flag> {
  const n = name.toLowerCase();
  const out = new Set<Flag>();
  for (const [flag, re] of RULES) {
    const strip = STRIP[flag];
    if (re.test(strip ? n.replace(strip, '') : n)) out.add(flag);
  }
  return out;
}

export function recipeFlags(m: Pick<SavedMeal, 'items' | 'name'>): Set<Flag> {
  const out = new Set<Flag>();
  for (const it of m.items as MealItem[]) for (const f of ingredientFlags(it.name)) out.add(f);
  return out;
}

/** The most plant-based diet a recipe suits. */
export function recipeDiet(m: Pick<SavedMeal, 'items' | 'name'>): Exclude<Diet, 'everything'> | 'everything' {
  const f = recipeFlags(m);
  if (f.has('meat')) return 'everything';
  if (f.has('fish') || f.has('shellfish')) return 'pescatarian';
  if (f.has('dairy') || f.has('egg') || f.has('honey')) return 'vegetarian';
  return 'vegan';
}

const DIET_RANK: Record<Diet, number> = { vegan: 0, vegetarian: 1, pescatarian: 2, everything: 3 };

/** Does a recipe suit someone eating `diet`? */
export const suitsDiet = (m: Pick<SavedMeal, 'items' | 'name'>, diet: Diet) => DIET_RANK[recipeDiet(m)] <= DIET_RANK[diet];

/** Allergens present (by ingredient name). */
export function recipeAllergens(m: Pick<SavedMeal, 'items' | 'name'>): Allergen[] {
  const f = recipeFlags(m);
  const out: Allergen[] = [];
  if (f.has('gluten')) out.push('gluten');
  if (f.has('dairy')) out.push('dairy');
  if (f.has('egg')) out.push('egg');
  if (f.has('peanut')) out.push('peanut');
  if (f.has('tree-nut')) out.push('tree-nut');
  if (f.has('fish')) out.push('fish');
  if (f.has('shellfish')) out.push('shellfish');
  if (f.has('soy')) out.push('soy');
  return out;
}

/** 1 = budget-friendly, 3 = pricier (by the number of premium ingredients). */
export function costTier(m: Pick<SavedMeal, 'items' | 'name'>): 1 | 2 | 3 {
  const n = (m.items as MealItem[]).filter((i) => ingredientFlags(i.name).has('premium')).length;
  return n === 0 ? 1 : n === 1 ? 2 : 3;
}

export const ALLERGEN_LABEL: Record<Allergen, string> = {
  gluten: 'Gluten',
  dairy: 'Dairy',
  egg: 'Eggs',
  peanut: 'Peanuts',
  'tree-nut': 'Tree nuts',
  fish: 'Fish',
  shellfish: 'Shellfish',
  soy: 'Soy',
};
