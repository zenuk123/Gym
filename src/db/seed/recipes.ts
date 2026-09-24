import type { MealSlot, RecipeTag, SavedMeal } from '../types';
import { nutritionFor } from '../../lib/calc/food';
import { seedLocal } from '../repo';
import { slug } from './exercises';
import { BUILT_IN_FOODS } from './foods';

/**
 * Built-in recipe library: simple, fitness-friendly meals made from the built-in foods, so
 * nutrition is calculated from the food database (not typed in). Ids are stable
 * ("recipe-<slug>"); never change an existing one. Only vegetarian/vegan are declared —
 * high-protein, quick, meal-prep and low-calorie are worked out (see lib/calc/recipes.ts).
 */
type Def = {
  name: string;
  slot: MealSlot;
  servings: number;
  prepMin: number;
  cover: string;
  diet?: Extract<RecipeTag, 'vegetarian' | 'vegan'>;
  /** [built-in food name, grams for the whole recipe] */
  items: [string, number][];
  steps: string[];
};

const DEFS: Def[] = [
  // ── Breakfast ──────────────────────────────────────────────────────────
  {
    name: 'Protein overnight oats',
    slot: 'breakfast', servings: 1, prepMin: 5, cover: '🥣', diet: 'vegetarian',
    items: [['Rolled oats', 60], ['Semi-skimmed milk', 200], ['Whey protein powder', 30], ['Blueberries', 80], ['Honey', 10]],
    steps: ['Stir the oats, milk and protein powder together in a jar or tub.', 'Cover and leave in the fridge overnight (at least 4 hours).', 'Top with blueberries and a drizzle of honey. Eat cold, or warm for 1–2 minutes.'],
  },
  {
    name: 'Greek yoghurt berry bowl',
    slot: 'breakfast', servings: 1, prepMin: 3, cover: '🫐', diet: 'vegetarian',
    items: [['Greek yoghurt, 0% fat', 250], ['Granola', 40], ['Strawberries', 80], ['Raspberries', 50], ['Honey', 10]],
    steps: ['Spoon the yoghurt into a bowl.', 'Slice the strawberries and add with the raspberries.', 'Scatter over the granola and drizzle with honey.'],
  },
  {
    name: 'Spinach & mushroom scramble on toast',
    slot: 'breakfast', servings: 1, prepMin: 10, cover: '🍳', diet: 'vegetarian',
    items: [['Egg (large)', 150], ['Spinach', 50], ['Mushrooms', 80], ['Wholemeal bread', 80], ['Butter', 5]],
    steps: ['Slice the mushrooms and fry in the butter for 3 minutes.', 'Add the spinach and stir until wilted.', 'Beat the eggs, pour in and stir gently over a low heat until just set.', 'Serve on the toasted bread.'],
  },
  {
    name: 'Peanut butter banana porridge',
    slot: 'breakfast', servings: 1, prepMin: 6, cover: '🍌', diet: 'vegetarian',
    items: [['Rolled oats', 60], ['Skimmed milk', 250], ['Banana', 100], ['Peanut butter', 15]],
    steps: ['Simmer the oats and milk for 4–5 minutes, stirring, until creamy (or microwave 2½ minutes).', 'Slice the banana on top and add a spoon of peanut butter.'],
  },
  {
    name: 'Egg & bacon breakfast wrap',
    slot: 'breakfast', servings: 1, prepMin: 10, cover: '🌯',
    items: [['Tortilla wrap', 62], ['Egg (large)', 100], ['Back bacon (raw)', 50], ['Tomatoes', 60]],
    steps: ['Grill the bacon for 6–8 minutes, turning once.', 'Scramble the eggs in a non-stick pan.', 'Warm the wrap, fill with egg, bacon and sliced tomato, then roll up.'],
  },
  {
    name: 'Weetabix with berries',
    slot: 'breakfast', servings: 1, prepMin: 2, cover: '🥛', diet: 'vegetarian',
    items: [['Weetabix', 38], ['Semi-skimmed milk', 200], ['Blueberries', 80]],
    steps: ['Pour the milk over two Weetabix and top with blueberries.'],
  },

  // ── Lunch ──────────────────────────────────────────────────────────────
  {
    name: 'Chicken & quinoa power bowl',
    slot: 'lunch', servings: 1, prepMin: 25, cover: '🥗',
    items: [['Chicken breast (raw)', 150], ['Quinoa (dry)', 60], ['Avocado', 50], ['Cucumber', 80], ['Tomatoes', 80], ['Feta', 30], ['Olive oil', 5]],
    steps: ['Rinse the quinoa and simmer in plenty of water for 15 minutes; drain.', 'Season and pan-fry the chicken in the oil for 6–7 minutes a side until cooked through, then slice.', 'Chop the cucumber, tomatoes and avocado.', 'Pile everything into a bowl and crumble over the feta.'],
  },
  {
    name: 'Tuna & chickpea salad',
    slot: 'lunch', servings: 1, prepMin: 8, cover: '🐟',
    items: [['Tuna in spring water (drained)', 112], ['Chickpeas (canned, drained)', 120], ['Cucumber', 80], ['Red pepper', 80], ['Mixed salad leaves', 40], ['Olive oil', 10]],
    steps: ['Dice the cucumber and pepper.', 'Toss with the chickpeas, salad leaves and flaked tuna.', 'Dress with the olive oil, a squeeze of lemon, salt and pepper.'],
  },
  {
    name: 'Chicken caesar-style wrap',
    slot: 'lunch', servings: 1, prepMin: 5, cover: '🌯',
    items: [['Tortilla wrap', 62], ['Chicken breast (cooked)', 120], ['Mixed salad leaves', 30], ['Greek yoghurt, 0% fat', 30], ['Cheddar cheese', 15]],
    steps: ['Mix the yoghurt with a pinch of garlic, lemon juice and black pepper for a light dressing.', 'Fill the wrap with leaves, sliced chicken, grated cheese and the dressing. Roll tightly.'],
  },
  {
    name: 'Hummus veggie wrap',
    slot: 'lunch', servings: 1, prepMin: 5, cover: '🫓', diet: 'vegetarian',
    items: [['Tortilla wrap', 62], ['Hummus', 60], ['Feta', 30], ['Spinach', 30], ['Red pepper', 60], ['Cucumber', 50]],
    steps: ['Spread the hummus over the wrap.', 'Add spinach, sliced pepper and cucumber, and crumble over the feta.', 'Roll up and cut in half.'],
  },
  {
    name: 'Egg fried rice',
    slot: 'lunch', servings: 1, prepMin: 10, cover: '🍚', diet: 'vegetarian',
    items: [['White rice (cooked)', 200], ['Egg (large)', 100], ['Peas (frozen)', 80], ['Sweetcorn', 40], ['Onion', 40], ['Olive oil', 10]],
    steps: ['Fry the chopped onion in the oil for 2 minutes.', 'Add the peas, sweetcorn and rice and stir-fry for 3–4 minutes until piping hot.', 'Push to one side, scramble the eggs in the gap, then mix through. Season with soy sauce.'],
  },
  {
    name: 'Prawn noodle stir-fry',
    slot: 'lunch', servings: 1, prepMin: 15, cover: '🍜',
    items: [['Egg noodles (dry)', 75], ['King prawns (cooked)', 150], ['Red pepper', 80], ['Broccoli', 80], ['Onion', 50], ['Olive oil', 5]],
    steps: ['Cook the noodles as the packet says; drain.', 'Stir-fry the sliced onion, pepper and broccoli in the oil over a high heat for 4 minutes.', 'Add the prawns and noodles, toss for 2 minutes until hot. Season with soy sauce, garlic and chilli.'],
  },

  // ── Dinner ─────────────────────────────────────────────────────────────
  {
    name: 'Turkey chilli with rice',
    slot: 'dinner', servings: 4, prepMin: 45, cover: '🌶️',
    items: [['Turkey mince, 5% fat (raw)', 500], ['Kidney beans (canned, drained)', 400], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Red pepper', 160], ['Brown rice (dry)', 300], ['Olive oil', 15]],
    steps: ['Fry the chopped onion and pepper in the oil for 5 minutes.', 'Add the mince and brown it, breaking it up.', 'Stir in 2 tsp chilli powder, 1 tsp cumin, the tomatoes and beans. Simmer for 25 minutes.', 'Meanwhile cook the rice. Split into 4 boxes — keeps 3 days in the fridge, or freeze.'],
  },
  {
    name: 'Beef bolognese',
    slot: 'dinner', servings: 4, prepMin: 40, cover: '🍝',
    items: [['Beef mince, 5% fat (raw)', 500], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Carrots', 150], ['Mushrooms', 200], ['Pasta (dry)', 320], ['Olive oil', 15]],
    steps: ['Soften the finely chopped onion and carrot in the oil for 6 minutes.', 'Add the mince and brown it, then the sliced mushrooms.', 'Pour in the tomatoes with a little stock or water and dried herbs; simmer for 20 minutes.', 'Cook the pasta, drain, and portion with the sauce into 4.'],
  },
  {
    name: 'Chicken & sweet potato traybake',
    slot: 'dinner', servings: 1, prepMin: 40, cover: '🍗',
    items: [['Chicken breast (raw)', 150], ['Sweet potato (raw)', 200], ['Courgette', 100], ['Red pepper', 80], ['Onion', 50], ['Olive oil', 10]],
    steps: ['Heat the oven to 200 °C (180 °C fan).', 'Chop the sweet potato, courgette, pepper and onion into chunks and toss with the oil and paprika.', 'Roast for 15 minutes, add the chicken on top and roast for 20–25 minutes more until cooked through.'],
  },
  {
    name: 'Salmon, rice & greens',
    slot: 'dinner', servings: 1, prepMin: 20, cover: '🍣',
    items: [['Salmon fillet (raw)', 120], ['White rice (dry)', 75], ['Broccoli', 100], ['Green beans', 80]],
    steps: ['Cook the rice.', 'Bake the salmon at 200 °C for 12–15 minutes (or pan-fry skin-side down for 4 minutes, then 2 minutes on the other side).', 'Steam the broccoli and beans for 4–5 minutes. Serve with lemon.'],
  },
  {
    name: 'Chicken & spinach curry',
    slot: 'dinner', servings: 4, prepMin: 35, cover: '🍛',
    items: [['Chicken breast (raw)', 600], ['Chopped tomatoes (canned)', 400], ['Spinach', 100], ['Onion', 150], ['Greek yoghurt, 0% fat', 150], ['Brown rice (dry)', 300]],
    steps: ['Fry the onion with a little oil and 2 tbsp curry powder for 5 minutes.', 'Add the diced chicken and brown for 5 minutes.', 'Pour in the tomatoes and simmer for 15 minutes; stir in the spinach until wilted.', 'Take off the heat and stir through the yoghurt. Serve with the rice, split into 4.'],
  },
  {
    name: 'Red lentil & sweet potato dahl',
    slot: 'dinner', servings: 4, prepMin: 35, cover: '🥘', diet: 'vegan',
    items: [['Red lentils (dry)', 250], ['Sweet potato (raw)', 400], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Spinach', 100], ['Olive oil', 15], ['White rice (dry)', 240]],
    steps: ['Fry the onion in the oil with garlic, ginger and 2 tsp each of cumin and turmeric.', 'Add the diced sweet potato, lentils, tomatoes and 700 ml water. Simmer for 20–25 minutes.', 'Stir in the spinach. Serve with the rice.'],
  },
  {
    name: 'Steak, potatoes & salad',
    slot: 'dinner', servings: 1, prepMin: 30, cover: '🥩',
    items: [['Sirloin steak (raw)', 225], ['Potatoes (raw)', 250], ['Mixed salad leaves', 50], ['Tomatoes', 80], ['Olive oil', 10]],
    steps: ['Cut the potatoes into wedges, toss with half the oil and roast at 220 °C for 25 minutes.', 'Season the steak and sear in the remaining oil for 2–4 minutes a side. Rest for 5 minutes.', 'Serve with the salad and tomatoes.'],
  },
  {
    name: 'Cod with crushed potatoes & peas',
    slot: 'dinner', servings: 1, prepMin: 25, cover: '🐠',
    items: [['Cod fillet (raw)', 140], ['Potatoes (raw)', 250], ['Peas (frozen)', 100], ['Butter', 10]],
    steps: ['Boil the potatoes for 15 minutes; add the peas for the last 3 minutes.', 'Bake the cod at 200 °C for 12 minutes (or pan-fry 3 minutes a side).', 'Drain the potatoes and peas and roughly crush with the butter, salt and pepper.'],
  },
  {
    name: 'Tofu veggie stir-fry',
    slot: 'dinner', servings: 1, prepMin: 20, cover: '🥦', diet: 'vegan',
    items: [['Tofu, firm', 200], ['Brown rice (dry)', 70], ['Broccoli', 100], ['Red pepper', 80], ['Mushrooms', 80], ['Olive oil', 10]],
    steps: ['Cook the rice.', 'Press the tofu dry, cube it and fry in the oil until golden, about 8 minutes.', 'Add the vegetables and stir-fry for 4 minutes. Season with soy sauce, garlic and ginger. Serve on the rice.'],
  },

  // ── Snacks ─────────────────────────────────────────────────────────────
  {
    name: 'Cottage cheese & pineapple',
    slot: 'snack', servings: 1, prepMin: 2, cover: '🍍', diet: 'vegetarian',
    items: [['Cottage cheese', 150], ['Pineapple', 100]],
    steps: ['Spoon the cottage cheese into a bowl and top with chopped pineapple.'],
  },
  {
    name: 'Protein shake & banana',
    slot: 'snack', servings: 1, prepMin: 2, cover: '🥤', diet: 'vegetarian',
    items: [['Whey protein powder', 30], ['Semi-skimmed milk', 300], ['Banana', 100]],
    steps: ['Shake the protein powder with the milk (or blend it with the banana).'],
  },
  {
    name: 'Rice cakes with peanut butter & banana',
    slot: 'snack', servings: 1, prepMin: 3, cover: '🥜', diet: 'vegan',
    items: [['Rice cakes', 27], ['Peanut butter', 20], ['Banana', 60]],
    steps: ['Spread the rice cakes with peanut butter and top with banana slices.'],
  },
  {
    name: 'Apple & almonds',
    slot: 'snack', servings: 1, prepMin: 1, cover: '🍎', diet: 'vegan',
    items: [['Apple', 150], ['Almonds', 25]],
    steps: ['Slice the apple and eat with a small handful of almonds.'],
  },
  {
    name: 'Skyr with blueberries',
    slot: 'snack', servings: 1, prepMin: 1, cover: '🍨', diet: 'vegetarian',
    items: [['Skyr', 150], ['Blueberries', 80]],
    steps: ['Top the skyr with blueberries.'],
  },
];

export const builtInRecipeId = (name: string) => `recipe-${slug(name)}`;
const FOODS = new Map(BUILT_IN_FOODS.map((f) => [f.name, f]));

export const BUILT_IN_RECIPES: SavedMeal[] = DEFS.map((d) => {
  const id = builtInRecipeId(d.name);
  return {
    id,
    name: d.name,
    slot: d.slot,
    servings: d.servings,
    items: d.items.map(([foodName, grams], i) => {
      const food = FOODS.get(foodName);
      if (!food) throw new Error(`Recipe "${d.name}" uses unknown food "${foodName}"`);
      return { key: `${id}-${i}`, foodId: food.id, name: food.name, grams, category: food.category, ...nutritionFor(food, grams) };
    }),
    notes: null,
    favourite: false,
    image: null,
    steps: d.steps,
    prepMin: d.prepMin,
    tags: d.diet === 'vegan' ? ['vegan', 'vegetarian'] : d.diet ? [d.diet] : [],
    source: 'builtin',
    cover: d.cover,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
});

export function seedRecipes(): Promise<number> {
  return seedLocal('meals', BUILT_IN_RECIPES);
}
