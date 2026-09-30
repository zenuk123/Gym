import type { Cuisine, MealSlot, SavedMeal } from '../types';
import { recipeDiet } from '../../lib/calc/ingredients';
import { nutritionFor } from '../../lib/calc/food';
import { seedLocal } from '../repo';
import { slug } from './exercises';
import { BUILT_IN_FOODS } from './foods';

/**
 * Built-in recipe library: simple, fitness-friendly meals made from the built-in foods, so
 * nutrition is calculated from the food database (not typed in). Ids are stable
 * ("recipe-<slug>"); never change an existing one. Diet (vegan/vegetarian/…), allergens and
 * tags like high-protein are worked out from the ingredients (lib/calc/ingredients.ts, recipes.ts).
 */
type Def = {
  name: string;
  slot: MealSlot;
  servings: number;
  prepMin: number;
  cover: string;
  cuisine: Cuisine;
  /** [built-in food name, grams for the whole recipe] */
  items: [string, number][];
  steps: string[];
};

const DEFS: Def[] = [
  // ── Breakfast ──────────────────────────────────────────────────────────
  {
    name: 'Protein overnight oats',
    slot: 'breakfast', servings: 1, prepMin: 5, cover: '🥣', cuisine: 'british',
    items: [['Rolled oats', 60], ['Semi-skimmed milk', 200], ['Whey protein powder', 30], ['Blueberries', 80], ['Honey', 10]],
    steps: ['Stir the oats, milk and protein powder together in a jar or tub.', 'Cover and leave in the fridge overnight (at least 4 hours).', 'Top with blueberries and a drizzle of honey. Eat cold, or warm for 1–2 minutes.'],
  },
  {
    name: 'Greek yoghurt berry bowl',
    slot: 'breakfast', servings: 1, prepMin: 3, cover: '🫐', cuisine: 'mediterranean',
    items: [['Greek yoghurt, 0% fat', 250], ['Granola', 40], ['Strawberries', 80], ['Raspberries', 50], ['Honey', 10]],
    steps: ['Spoon the yoghurt into a bowl.', 'Slice the strawberries and add with the raspberries.', 'Scatter over the granola and drizzle with honey.'],
  },
  {
    name: 'Spinach & mushroom scramble on toast',
    slot: 'breakfast', servings: 1, prepMin: 10, cover: '🍳', cuisine: 'british',
    items: [['Egg (large)', 150], ['Spinach', 50], ['Mushrooms', 80], ['Wholemeal bread', 80], ['Butter', 5]],
    steps: ['Slice the mushrooms and fry in the butter for 3 minutes.', 'Add the spinach and stir until wilted.', 'Beat the eggs, pour in and stir gently over a low heat until just set.', 'Serve on the toasted bread.'],
  },
  {
    name: 'Peanut butter banana porridge',
    slot: 'breakfast', servings: 1, prepMin: 6, cover: '🍌', cuisine: 'british',
    items: [['Rolled oats', 60], ['Skimmed milk', 250], ['Banana', 100], ['Peanut butter', 15]],
    steps: ['Simmer the oats and milk for 4–5 minutes, stirring, until creamy (or microwave 2½ minutes).', 'Slice the banana on top and add a spoon of peanut butter.'],
  },
  {
    name: 'Egg & bacon breakfast wrap',
    slot: 'breakfast', servings: 1, prepMin: 10, cover: '🌯', cuisine: 'british',
    items: [['Tortilla wrap', 62], ['Egg (large)', 100], ['Back bacon (raw)', 50], ['Tomatoes', 60]],
    steps: ['Grill the bacon for 6–8 minutes, turning once.', 'Scramble the eggs in a non-stick pan.', 'Warm the wrap, fill with egg, bacon and sliced tomato, then roll up.'],
  },
  {
    name: 'Weetabix with berries',
    slot: 'breakfast', servings: 1, prepMin: 2, cover: '🥛', cuisine: 'british',
    items: [['Weetabix', 38], ['Semi-skimmed milk', 200], ['Blueberries', 80]],
    steps: ['Pour the milk over two Weetabix and top with blueberries.'],
  },

  // ── Lunch ──────────────────────────────────────────────────────────────
  {
    name: 'Chicken & quinoa power bowl',
    slot: 'lunch', servings: 1, prepMin: 25, cover: '🥗', cuisine: 'mediterranean',
    items: [['Chicken breast (raw)', 150], ['Quinoa (dry)', 60], ['Avocado', 50], ['Cucumber', 80], ['Tomatoes', 80], ['Feta', 30], ['Olive oil', 5]],
    steps: ['Rinse the quinoa and simmer in plenty of water for 15 minutes; drain.', 'Season and pan-fry the chicken in the oil for 6–7 minutes a side until cooked through, then slice.', 'Chop the cucumber, tomatoes and avocado.', 'Pile everything into a bowl and crumble over the feta.'],
  },
  {
    name: 'Tuna & chickpea salad',
    slot: 'lunch', servings: 1, prepMin: 8, cover: '🐟', cuisine: 'mediterranean',
    items: [['Tuna in spring water (drained)', 112], ['Chickpeas (canned, drained)', 120], ['Cucumber', 80], ['Red pepper', 80], ['Mixed salad leaves', 40], ['Olive oil', 10]],
    steps: ['Dice the cucumber and pepper.', 'Toss with the chickpeas, salad leaves and flaked tuna.', 'Dress with the olive oil, a squeeze of lemon, salt and pepper.'],
  },
  {
    name: 'Chicken caesar-style wrap',
    slot: 'lunch', servings: 1, prepMin: 5, cover: '🌯', cuisine: 'british',
    items: [['Tortilla wrap', 62], ['Chicken breast (cooked)', 120], ['Mixed salad leaves', 30], ['Greek yoghurt, 0% fat', 30], ['Cheddar cheese', 15]],
    steps: ['Mix the yoghurt with a pinch of garlic, lemon juice and black pepper for a light dressing.', 'Fill the wrap with leaves, sliced chicken, grated cheese and the dressing. Roll tightly.'],
  },
  {
    name: 'Hummus veggie wrap',
    slot: 'lunch', servings: 1, prepMin: 5, cover: '🫓', cuisine: 'middle-eastern',
    items: [['Tortilla wrap', 62], ['Hummus', 60], ['Feta', 30], ['Spinach', 30], ['Red pepper', 60], ['Cucumber', 50]],
    steps: ['Spread the hummus over the wrap.', 'Add spinach, sliced pepper and cucumber, and crumble over the feta.', 'Roll up and cut in half.'],
  },
  {
    name: 'Egg fried rice',
    slot: 'lunch', servings: 1, prepMin: 10, cover: '🍚', cuisine: 'asian',
    items: [['White rice (cooked)', 200], ['Egg (large)', 100], ['Peas (frozen)', 80], ['Sweetcorn', 40], ['Onion', 40], ['Olive oil', 10]],
    steps: ['Fry the chopped onion in the oil for 2 minutes.', 'Add the peas, sweetcorn and rice and stir-fry for 3–4 minutes until piping hot.', 'Push to one side, scramble the eggs in the gap, then mix through. Season with soy sauce.'],
  },
  {
    name: 'Prawn noodle stir-fry',
    slot: 'lunch', servings: 1, prepMin: 15, cover: '🍜', cuisine: 'asian',
    items: [['Egg noodles (dry)', 75], ['King prawns (cooked)', 150], ['Red pepper', 80], ['Broccoli', 80], ['Onion', 50], ['Olive oil', 5]],
    steps: ['Cook the noodles as the packet says; drain.', 'Stir-fry the sliced onion, pepper and broccoli in the oil over a high heat for 4 minutes.', 'Add the prawns and noodles, toss for 2 minutes until hot. Season with soy sauce, garlic and chilli.'],
  },

  // ── Dinner ─────────────────────────────────────────────────────────────
  {
    name: 'Turkey chilli with rice',
    slot: 'dinner', servings: 4, prepMin: 45, cover: '🌶️', cuisine: 'mexican',
    items: [['Turkey mince, 5% fat (raw)', 500], ['Kidney beans (canned, drained)', 400], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Red pepper', 160], ['Brown rice (dry)', 300], ['Olive oil', 15]],
    steps: ['Fry the chopped onion and pepper in the oil for 5 minutes.', 'Add the mince and brown it, breaking it up.', 'Stir in 2 tsp chilli powder, 1 tsp cumin, the tomatoes and beans. Simmer for 25 minutes.', 'Meanwhile cook the rice. Split into 4 boxes — keeps 3 days in the fridge, or freeze.'],
  },
  {
    name: 'Beef bolognese',
    slot: 'dinner', servings: 4, prepMin: 40, cover: '🍝', cuisine: 'italian',
    items: [['Beef mince, 5% fat (raw)', 500], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Carrots', 150], ['Mushrooms', 200], ['Pasta (dry)', 320], ['Olive oil', 15]],
    steps: ['Soften the finely chopped onion and carrot in the oil for 6 minutes.', 'Add the mince and brown it, then the sliced mushrooms.', 'Pour in the tomatoes with a little stock or water and dried herbs; simmer for 20 minutes.', 'Cook the pasta, drain, and portion with the sauce into 4.'],
  },
  {
    name: 'Chicken & sweet potato traybake',
    slot: 'dinner', servings: 1, prepMin: 40, cover: '🍗', cuisine: 'british',
    items: [['Chicken breast (raw)', 150], ['Sweet potato (raw)', 200], ['Courgette', 100], ['Red pepper', 80], ['Onion', 50], ['Olive oil', 10]],
    steps: ['Heat the oven to 200 °C (180 °C fan).', 'Chop the sweet potato, courgette, pepper and onion into chunks and toss with the oil and paprika.', 'Roast for 15 minutes, add the chicken on top and roast for 20–25 minutes more until cooked through.'],
  },
  {
    name: 'Salmon, rice & greens',
    slot: 'dinner', servings: 1, prepMin: 20, cover: '🍣', cuisine: 'british',
    items: [['Salmon fillet (raw)', 120], ['White rice (dry)', 75], ['Broccoli', 100], ['Green beans', 80]],
    steps: ['Cook the rice.', 'Bake the salmon at 200 °C for 12–15 minutes (or pan-fry skin-side down for 4 minutes, then 2 minutes on the other side).', 'Steam the broccoli and beans for 4–5 minutes. Serve with lemon.'],
  },
  {
    name: 'Chicken & spinach curry',
    slot: 'dinner', servings: 4, prepMin: 35, cover: '🍛', cuisine: 'indian',
    items: [['Chicken breast (raw)', 600], ['Chopped tomatoes (canned)', 400], ['Spinach', 100], ['Onion', 150], ['Greek yoghurt, 0% fat', 150], ['Brown rice (dry)', 300]],
    steps: ['Fry the onion with a little oil and 2 tbsp curry powder for 5 minutes.', 'Add the diced chicken and brown for 5 minutes.', 'Pour in the tomatoes and simmer for 15 minutes; stir in the spinach until wilted.', 'Take off the heat and stir through the yoghurt. Serve with the rice, split into 4.'],
  },
  {
    name: 'Red lentil & sweet potato dahl',
    slot: 'dinner', servings: 4, prepMin: 35, cover: '🥘', cuisine: 'indian',
    items: [['Red lentils (dry)', 250], ['Sweet potato (raw)', 400], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Spinach', 100], ['Olive oil', 15], ['White rice (dry)', 240]],
    steps: ['Fry the onion in the oil with garlic, ginger and 2 tsp each of cumin and turmeric.', 'Add the diced sweet potato, lentils, tomatoes and 700 ml water. Simmer for 20–25 minutes.', 'Stir in the spinach. Serve with the rice.'],
  },
  {
    name: 'Steak, potatoes & salad',
    slot: 'dinner', servings: 1, prepMin: 30, cover: '🥩', cuisine: 'british',
    items: [['Sirloin steak (raw)', 225], ['Potatoes (raw)', 250], ['Mixed salad leaves', 50], ['Tomatoes', 80], ['Olive oil', 10]],
    steps: ['Cut the potatoes into wedges, toss with half the oil and roast at 220 °C for 25 minutes.', 'Season the steak and sear in the remaining oil for 2–4 minutes a side. Rest for 5 minutes.', 'Serve with the salad and tomatoes.'],
  },
  {
    name: 'Cod with crushed potatoes & peas',
    slot: 'dinner', servings: 1, prepMin: 25, cover: '🐠', cuisine: 'british',
    items: [['Cod fillet (raw)', 140], ['Potatoes (raw)', 250], ['Peas (frozen)', 100], ['Butter', 10]],
    steps: ['Boil the potatoes for 15 minutes; add the peas for the last 3 minutes.', 'Bake the cod at 200 °C for 12 minutes (or pan-fry 3 minutes a side).', 'Drain the potatoes and peas and roughly crush with the butter, salt and pepper.'],
  },
  {
    name: 'Tofu veggie stir-fry',
    slot: 'dinner', servings: 1, prepMin: 20, cover: '🥦', cuisine: 'asian',
    items: [['Tofu, firm', 200], ['Brown rice (dry)', 70], ['Broccoli', 100], ['Red pepper', 80], ['Mushrooms', 80], ['Olive oil', 10]],
    steps: ['Cook the rice.', 'Press the tofu dry, cube it and fry in the oil until golden, about 8 minutes.', 'Add the vegetables and stir-fry for 4 minutes. Season with soy sauce, garlic and ginger. Serve on the rice.'],
  },

  // ── Snacks ─────────────────────────────────────────────────────────────
  {
    name: 'Cottage cheese & pineapple',
    slot: 'snack', servings: 1, prepMin: 2, cover: '🍍', cuisine: 'british',
    items: [['Cottage cheese', 150], ['Pineapple', 100]],
    steps: ['Spoon the cottage cheese into a bowl and top with chopped pineapple.'],
  },
  {
    name: 'Protein shake & banana',
    slot: 'snack', servings: 1, prepMin: 2, cover: '🥤', cuisine: 'british',
    items: [['Whey protein powder', 30], ['Semi-skimmed milk', 300], ['Banana', 100]],
    steps: ['Shake the protein powder with the milk (or blend it with the banana).'],
  },
  {
    name: 'Rice cakes with peanut butter & banana',
    slot: 'snack', servings: 1, prepMin: 3, cover: '🥜', cuisine: 'british',
    items: [['Rice cakes', 27], ['Peanut butter', 20], ['Banana', 60]],
    steps: ['Spread the rice cakes with peanut butter and top with banana slices.'],
  },
  {
    name: 'Apple & almonds',
    slot: 'snack', servings: 1, prepMin: 1, cover: '🍎', cuisine: 'british',
    items: [['Apple', 150], ['Almonds', 25]],
    steps: ['Slice the apple and eat with a small handful of almonds.'],
  },
  {
    name: 'Skyr with blueberries',
    slot: 'snack', servings: 1, prepMin: 1, cover: '🍨', cuisine: 'british',
    items: [['Skyr', 150], ['Blueberries', 80]],
    steps: ['Top the skyr with blueberries.'],
  },
];

// ── More recipes (compact form: name, slot, portions, minutes, cover, cuisine, [food, g][], steps) ──
const r = (name: string, slot: MealSlot, servings: number, prepMin: number, cover: string, cuisine: Cuisine, items: [string, number][], steps: string[]): Def => ({
  name,
  slot,
  servings,
  prepMin,
  cover,
  cuisine,
  items,
  steps,
});

const MORE: Def[] = [
  // Breakfast
  r('Smoked salmon & scrambled eggs on toast', 'breakfast', 1, 10, '🍳', 'british', [['Egg (large)', 150], ['Smoked salmon', 60], ['Wholemeal bread', 80], ['Butter', 5]], ['Toast the bread.', 'Scramble the eggs in the butter over a low heat, stirring, until just set.', 'Pile onto the toast and top with the smoked salmon and black pepper.']),
  r('Shakshuka with feta', 'breakfast', 2, 25, '🍅', 'middle-eastern', [['Egg (large)', 232], ['Chopped tomatoes (canned)', 400], ['Red pepper', 160], ['Onion', 100], ['Olive oil', 10], ['Feta', 40], ['Pitta bread', 120]], ['Soften the sliced onion and pepper in the oil for 6 minutes with 1 tsp each cumin and paprika.', 'Add the tomatoes and simmer for 8 minutes until thick.', 'Make 4 wells, crack in the eggs, cover and cook for 5–7 minutes.', 'Crumble over the feta and serve with warm pitta.']),
  r('Berry protein smoothie', 'breakfast', 1, 5, '🥤', 'british', [['Frozen mixed berries', 150], ['Banana', 100], ['Whey protein powder', 30], ['Semi-skimmed milk', 250], ['Rolled oats', 30]], ['Blend everything until smooth. Add a splash more milk if it’s too thick.']),
  r('Breakfast burrito', 'breakfast', 1, 15, '🌯', 'mexican', [['Tortilla wrap', 62], ['Egg (large)', 150], ['Black beans (canned, drained)', 60], ['Tomato salsa', 50], ['Cheddar cheese', 20]], ['Warm the beans in a pan, then scramble in the eggs.', 'Fill the warmed wrap with the egg and beans, salsa and grated cheese. Roll up.']),
  r('Avocado & egg toast', 'breakfast', 1, 8, '🥑', 'british', [['Wholemeal bread', 80], ['Avocado', 70], ['Egg (large)', 116]], ['Poach or fry the eggs.', 'Mash the avocado with lemon, salt and chilli flakes and spread on the toast.', 'Top with the eggs.']),
  r('Blueberry baked oats', 'breakfast', 2, 30, '🫐', 'british', [['Rolled oats', 120], ['Egg (large)', 116], ['Banana', 120], ['Semi-skimmed milk', 200], ['Blueberries', 150], ['Whey protein powder', 30]], ['Heat the oven to 190 °C (170 °C fan).', 'Mash the banana, whisk in the eggs, milk and protein powder, then stir in the oats and half the blueberries.', 'Pour into a small dish, top with the rest of the berries and bake for 25 minutes. Keeps 2 days in the fridge.']),
  r('Lighter full English', 'breakfast', 1, 20, '🍳', 'british', [['Pork sausage', 114], ['Back bacon (raw)', 50], ['Egg (large)', 58], ['Baked beans', 150], ['Mushrooms', 80], ['Tomatoes', 80], ['Wholemeal bread', 40]], ['Grill the sausages (15 minutes) and bacon (6–8 minutes).', 'Grill the halved tomatoes and fry the mushrooms in a dry pan.', 'Poach the egg, warm the beans and serve with toast.']),
  r('Tofu scramble on toast', 'breakfast', 1, 12, '🍳', 'british', [['Tofu, firm', 200], ['Spinach', 50], ['Mushrooms', 80], ['Tomatoes', 60], ['Olive oil', 5], ['Wholemeal bread', 80]], ['Fry the mushrooms in the oil for 3 minutes.', 'Crumble in the tofu with ½ tsp turmeric, salt and pepper; cook for 4 minutes.', 'Stir through the spinach and chopped tomato. Serve on toast.']),
  r('Smoked salmon & soft cheese bagel', 'breakfast', 1, 5, '🥯', 'british', [['Bagel', 85], ['Light soft cheese', 30], ['Smoked salmon', 60], ['Cucumber', 40]], ['Toast the bagel, spread with the soft cheese and top with salmon and sliced cucumber.']),
  r('Vegan PB overnight oats', 'breakfast', 1, 5, '🥜', 'british', [['Rolled oats', 60], ['Oat milk', 200], ['Peanut butter', 20], ['Banana', 100], ['Frozen mixed berries', 50]], ['Stir the oats, oat milk and peanut butter together and chill overnight.', 'Top with sliced banana and berries.']),
  r('Ham & spinach egg-white omelette', 'breakfast', 1, 10, '🍳', 'british', [['Egg whites (liquid)', 200], ['Egg (large)', 58], ['Ham, sliced', 60], ['Spinach', 40], ['Mushrooms', 60], ['Cheddar cheese', 15]], ['Fry the mushrooms in a non-stick pan for 3 minutes, add the spinach to wilt.', 'Whisk the egg whites and egg, pour in and cook for 3 minutes.', 'Add the ham and cheese, fold over and serve.']),

  // Gluten-free breakfasts (no oats, bread or wraps)
  r('Veggie omelette', 'breakfast', 1, 10, '🍳', 'british', [['Egg (large)', 174], ['Red pepper', 60], ['Spinach', 40], ['Tomatoes', 60], ['Cheddar cheese', 20], ['Olive oil', 5]], ['Soften the diced pepper in the oil for 3 minutes, add the spinach to wilt.', 'Pour in the beaten eggs, cook for 3 minutes, scatter over the cheese and chopped tomato, fold and serve.']),
  r('Smoked salmon, eggs & avocado', 'breakfast', 1, 10, '🥑', 'british', [['Egg (large)', 116], ['Smoked salmon', 60], ['Avocado', 60], ['Spinach', 30]], ['Poach or softly scramble the eggs.', 'Serve on the spinach with the salmon and sliced avocado, lemon and black pepper.']),
  r('Greek yoghurt, fruit & nut bowl', 'breakfast', 1, 3, '🍓', 'mediterranean', [['Greek yoghurt, 0% fat', 250], ['Blueberries', 80], ['Banana', 60], ['Almonds', 15], ['Honey', 10]], ['Top the yoghurt with the fruit, chopped almonds and honey.']),
  r('Tofu & sweet potato breakfast hash', 'breakfast', 2, 20, '🍠', 'british', [['Tofu, firm', 300], ['Sweet potato (raw)', 400], ['Red pepper', 160], ['Onion', 100], ['Spinach', 80], ['Olive oil', 15]], ['Microwave the diced sweet potato for 4 minutes.', 'Fry it in the oil with the onion and pepper until crisp, about 8 minutes.', 'Crumble in the tofu with paprika and turmeric for 4 minutes, then stir in the spinach. Keeps for tomorrow.']),
  r('Tropical skyr smoothie', 'breakfast', 1, 5, '🥭', 'british', [['Skyr', 150], ['Mango', 100], ['Pineapple', 80], ['Banana', 80], ['Semi-skimmed milk', 150]], ['Blend everything with a few ice cubes.']),
  r('Avocado & edamame rice cakes', 'breakfast', 1, 8, '🍘', 'asian', [['Rice cakes', 27], ['Avocado', 60], ['Edamame beans (frozen)', 80], ['Tomatoes', 60]], ['Cook the edamame for 3 minutes, then roughly crush with the avocado, lime and chilli.', 'Spread on the rice cakes and top with sliced tomato.']),
  r('Cottage cheese & berry bowl', 'breakfast', 1, 3, '🫐', 'british', [['Cottage cheese', 200], ['Strawberries', 100], ['Blueberries', 60], ['Almonds', 10]], ['Top the cottage cheese with the berries and chopped almonds.']),
  r('Egg & potato breakfast hash', 'breakfast', 1, 20, '🥔', 'british', [['Potatoes (raw)', 200], ['Egg (large)', 116], ['Red pepper', 60], ['Onion', 50], ['Spinach', 30], ['Olive oil', 10]], ['Microwave the diced potato for 4 minutes, then fry in the oil with the onion and pepper until golden.', 'Stir in the spinach, make two wells and cook the eggs in them, covered, for 4 minutes.']),

  // Lunch
  r('Greek chicken pitta', 'lunch', 1, 20, '🥙', 'mediterranean', [['Chicken breast (raw)', 150], ['Pitta bread', 60], ['Greek yoghurt, 0% fat', 60], ['Cucumber', 60], ['Tomatoes', 60], ['Mixed salad leaves', 20], ['Olive oil', 5]], ['Rub the chicken with oregano, lemon and the oil; grill for 6–7 minutes a side and slice.', 'Grate half the cucumber into the yoghurt with garlic for a quick tzatziki.', 'Stuff the warm pitta with leaves, tomato, chicken and tzatziki.']),
  r('Halloumi & roasted veg couscous', 'lunch', 1, 30, '🧀', 'middle-eastern', [['Halloumi', 80], ['Couscous (dry)', 60], ['Courgette', 100], ['Red pepper', 100], ['Onion', 50], ['Chickpeas (canned, drained)', 80], ['Olive oil', 10]], ['Roast the chopped veg and chickpeas with the oil at 200 °C for 20 minutes.', 'Pour boiling water over the couscous, cover for 5 minutes, then fluff.', 'Griddle the sliced halloumi for 2 minutes a side and serve on top.']),
  r('Chicken pesto pasta salad', 'lunch', 1, 20, '🍝', 'italian', [['Pasta (dry)', 75], ['Chicken breast (cooked)', 120], ['Green pesto', 20], ['Tomatoes', 80], ['Spinach', 30]], ['Cook the pasta, drain and cool under cold water.', 'Toss with the pesto, sliced chicken, halved tomatoes and spinach. Great cold in a lunchbox.']),
  r('Tuna melt toastie', 'lunch', 1, 10, '🥪', 'british', [['Wholemeal bread', 80], ['Tuna in spring water (drained)', 112], ['Cheddar cheese', 25], ['Mayonnaise', 10], ['Sweetcorn', 30]], ['Mix the tuna, mayo and sweetcorn.', 'Sandwich with the grated cheese and toast in a dry pan for 3 minutes a side, pressing down.']),
  r('Chicken burrito bowl', 'lunch', 1, 25, '🌮', 'mexican', [['Chicken breast (raw)', 150], ['Brown rice (dry)', 60], ['Black beans (canned, drained)', 80], ['Sweetcorn', 50], ['Tomato salsa', 60], ['Avocado', 40], ['Mixed salad leaves', 30]], ['Cook the rice.', 'Season the chicken with smoked paprika and cumin, pan-fry 6–7 minutes a side and slice.', 'Build the bowl: rice, beans, corn, leaves, chicken, salsa and avocado.']),
  r('Salmon & edamame rice bowl', 'lunch', 1, 20, '🍣', 'asian', [['Salmon fillet (raw)', 120], ['White rice (dry)', 70], ['Edamame beans (frozen)', 80], ['Cucumber', 60], ['Carrots', 50], ['Avocado', 30], ['Soy sauce', 15]], ['Cook the rice, adding the edamame for the last 3 minutes.', 'Bake the salmon at 200 °C for 12 minutes and flake.', 'Top the rice with salmon, edamame, cucumber, grated carrot and avocado; drizzle with soy sauce.']),
  r('Red lentil & carrot soup', 'lunch', 4, 35, '🥣', 'british', [['Red lentils (dry)', 200], ['Carrots', 300], ['Onion', 150], ['Chopped tomatoes (canned)', 400], ['Olive oil', 15], ['Wholemeal bread', 160]], ['Soften the onion and grated carrot in the oil for 5 minutes with 1 tsp cumin.', 'Add the lentils, tomatoes and 1 litre veg stock; simmer for 20 minutes.', 'Blend until smooth. Serve with bread; freezes well.']),
  r('Chicken noodle soup', 'lunch', 2, 25, '🍜', 'asian', [['Chicken breast (raw)', 250], ['Egg noodles (dry)', 100], ['Carrots', 100], ['Spinach', 60], ['Onion', 60], ['Soy sauce', 20]], ['Simmer the whole chicken breasts in 1 litre stock with sliced onion and carrot for 15 minutes, then shred.', 'Add the noodles for 4 minutes, then the spinach and soy sauce.', 'Return the chicken and serve.']),
  r('Chickpea & spinach curry', 'lunch', 3, 25, '🍛', 'indian', [['Chickpeas (canned, drained)', 480], ['Spinach', 150], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Coconut milk, light (canned)', 200], ['Curry paste (tikka)', 45], ['Brown rice (dry)', 210]], ['Fry the onion with a splash of water and the curry paste for 5 minutes.', 'Add the chickpeas, tomatoes and coconut milk and simmer for 12 minutes.', 'Stir in the spinach. Serve with the rice.']),
  r('Chicken & hummus wrap', 'lunch', 1, 5, '🌯', 'middle-eastern', [['Tortilla wrap', 62], ['Chicken breast (cooked)', 100], ['Hummus', 40], ['Spinach', 30], ['Red pepper', 50]], ['Spread the wrap with hummus, add spinach, sliced pepper and chicken, and roll.']),
  r('Mackerel & potato salad', 'lunch', 1, 20, '🐟', 'british', [['Mackerel in tomato sauce (canned)', 125], ['Potatoes (raw)', 200], ['Mixed salad leaves', 40], ['Cucumber', 60], ['Greek yoghurt, 0% fat', 30]], ['Boil the potatoes for 15 minutes, drain and cool slightly.', 'Toss with the yoghurt, chives if you have them, leaves and cucumber.', 'Top with the mackerel.']),
  r('Egg & chickpea protein salad', 'lunch', 1, 15, '🥗', 'mediterranean', [['Egg (large)', 116], ['Chickpeas (canned, drained)', 120], ['Cucumber', 80], ['Tomatoes', 80], ['Feta', 30], ['Mixed salad leaves', 30], ['Olive oil', 5]], ['Boil the eggs for 8 minutes, cool and quarter.', 'Toss everything else with the oil and lemon; top with the eggs and feta.']),
  r('Prawn & mango rice salad', 'lunch', 1, 15, '🥭', 'asian', [['King prawns (cooked)', 150], ['White rice (cooked)', 180], ['Mango', 80], ['Cucumber', 60], ['Edamame beans (frozen)', 50], ['Soy sauce', 10]], ['Cook the edamame for 3 minutes and cool.', 'Mix the rice, prawns, diced mango and cucumber with the edamame.', 'Dress with soy sauce, lime and chilli.']),
  r('Pizza-style pitta', 'lunch', 1, 12, '🍕', 'italian', [['Pitta bread', 120], ['Chopped tomatoes (canned)', 80], ['Mozzarella', 60], ['Ham, sliced', 40], ['Mushrooms', 40], ['Mixed salad leaves', 30]], ['Spread the pittas with the tomatoes and oregano.', 'Top with torn mozzarella, ham and sliced mushrooms.', 'Grill for 5–6 minutes until bubbling. Serve with the leaves.']),
  r('Jacket potato with tuna & sweetcorn', 'lunch', 1, 15, '🥔', 'british', [['Potatoes (raw)', 300], ['Tuna in spring water (drained)', 112], ['Sweetcorn', 50], ['Greek yoghurt, 0% fat', 40], ['Mixed salad leaves', 30]], ['Prick the potato and microwave for 8–10 minutes, turning halfway (or bake 1 hour).', 'Mix the tuna, sweetcorn and yoghurt; spoon into the split potato.']),
  r('Sweet potato with beans & cheese', 'lunch', 1, 15, '🍠', 'british', [['Sweet potato (raw)', 300], ['Baked beans', 200], ['Cheddar cheese', 25]], ['Microwave the pricked sweet potato for 8–10 minutes until soft.', 'Split, fill with hot beans and top with grated cheese.']),

  r('Quinoa, black bean & mango salad', 'lunch', 1, 20, '🥗', 'mexican', [['Quinoa (dry)', 60], ['Black beans (canned, drained)', 100], ['Mango', 80], ['Red pepper', 60], ['Avocado', 40], ['Mixed salad leaves', 30], ['Olive oil', 5]], ['Rinse the quinoa and simmer for 15 minutes; drain and cool.', 'Toss with the beans, diced mango and pepper, leaves and avocado; dress with the oil, lime and chilli.']),
  r('Tofu, edamame & rice bowl', 'lunch', 1, 25, '🍚', 'asian', [['Tofu, firm', 150], ['Brown rice (dry)', 60], ['Edamame beans (frozen)', 80], ['Carrots', 50], ['Cucumber', 60], ['Olive oil', 5]], ['Cook the rice, adding the edamame for the last 3 minutes.', 'Fry the cubed tofu in the oil until golden.', 'Top the rice with tofu, grated carrot and cucumber; season with lime, chilli and tamari (gluten-free soy sauce) if you like.']),
  r('Hummus & roasted veg bowl', 'lunch', 1, 30, '🥙', 'middle-eastern', [['Chickpeas (canned, drained)', 120], ['Hummus', 50], ['Sweet potato (raw)', 150], ['Red pepper', 80], ['Spinach', 40], ['Olive oil', 5]], ['Roast the cubed sweet potato, pepper and chickpeas with the oil and cumin at 200 °C for 25 minutes.', 'Serve on the spinach with a big spoon of hummus.']),

  // Dinner
  r('Lighter chicken tikka masala', 'dinner', 4, 35, '🍛', 'indian', [['Chicken breast (raw)', 600], ['Curry paste (tikka)', 90], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Greek yoghurt, 0% fat', 200], ['White rice (dry)', 300]], ['Coat the diced chicken in half the paste and half the yoghurt; leave 10 minutes if you can.', 'Fry the onion with the rest of the paste for 5 minutes, add the chicken and brown.', 'Add the tomatoes and simmer 15 minutes; off the heat stir in the remaining yoghurt.', 'Serve with the rice, split into 4.']),
  r('Coconut chicken curry', 'dinner', 4, 30, '🥥', 'asian', [['Chicken thigh, skinless (raw)', 600], ['Coconut milk, light (canned)', 400], ['Curry paste (tikka)', 60], ['Red pepper', 200], ['Spinach', 100], ['White rice (dry)', 300]], ['Brown the diced chicken with the curry paste for 5 minutes.', 'Add the coconut milk and sliced peppers; simmer for 15 minutes.', 'Stir in the spinach and serve with the rice.']),
  r('Paneer & pea curry', 'dinner', 3, 30, '🧀', 'indian', [['Paneer', 300], ['Peas (frozen)', 300], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Curry paste (tikka)', 60], ['Brown rice (dry)', 225]], ['Fry the cubed paneer until golden, then set aside.', 'Cook the onion with the paste for 5 minutes, add the tomatoes and simmer for 10.', 'Add the peas and paneer for 5 minutes more. Serve with rice.']),
  r('Beef chilli con carne', 'dinner', 4, 45, '🌶️', 'mexican', [['Beef mince, 5% fat (raw)', 500], ['Kidney beans (canned, drained)', 400], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Red pepper', 160], ['White rice (dry)', 300], ['Olive oil', 10]], ['Fry the onion and pepper in the oil, then brown the mince.', 'Add chilli, cumin, the tomatoes and beans; simmer for 25 minutes.', 'Serve with rice. Freezes brilliantly.']),
  r('Chicken fajitas', 'dinner', 2, 20, '🌮', 'mexican', [['Chicken breast (raw)', 350], ['Red pepper', 240], ['Onion', 150], ['Tortilla wrap', 248], ['Tomato salsa', 100], ['Greek yoghurt, 0% fat', 80], ['Olive oil', 10]], ['Slice the chicken, peppers and onion; toss with fajita spices and the oil.', 'Stir-fry in a very hot pan for 8–10 minutes.', 'Serve in warm wraps with salsa and yoghurt (2 each).']),
  r('Beef & broccoli noodles', 'dinner', 2, 20, '🥦', 'asian', [['Sirloin steak (raw)', 300], ['Broccoli', 250], ['Onion', 100], ['Soy sauce', 30], ['Egg noodles (dry)', 150], ['Olive oil', 10]], ['Cook the noodles.', 'Sear the thinly sliced steak in the oil for 2 minutes and remove.', 'Stir-fry the broccoli and onion for 4 minutes, return the beef with the soy sauce, garlic and ginger, toss with the noodles.']),
  r('Sticky salmon & rice noodles', 'dinner', 1, 20, '🍣', 'asian', [['Salmon fillet (raw)', 120], ['Rice noodles (dry)', 65], ['Broccoli', 80], ['Edamame beans (frozen)', 50], ['Soy sauce', 15], ['Honey', 10]], ['Mix the soy sauce and honey; brush over the salmon and bake at 200 °C for 12 minutes.', 'Cook the noodles, adding the broccoli and edamame for the last 3 minutes.', 'Serve the salmon on the noodles with any leftover glaze.']),
  r('Pesto salmon & new potatoes', 'dinner', 1, 25, '🐟', 'italian', [['Salmon fillet (raw)', 120], ['Green pesto', 15], ['Potatoes (raw)', 250], ['Green beans', 100]], ['Boil the potatoes for 15 minutes; add the beans for the last 4.', 'Spread the pesto on the salmon and bake at 200 °C for 12 minutes.', 'Serve together.']),
  r('Turkey meatball spaghetti', 'dinner', 4, 35, '🍝', 'italian', [['Turkey mince, 5% fat (raw)', 500], ['Egg (large)', 58], ['Onion', 100], ['Chopped tomatoes (canned)', 800], ['Wholemeal pasta (dry)', 320], ['Parmesan', 20], ['Olive oil', 10]], ['Mix the mince, egg, half the finely chopped onion and dried herbs; roll into 20 balls.', 'Brown in the oil, add the rest of the onion and the tomatoes, and simmer for 15 minutes.', 'Cook the pasta and serve with the meatballs and parmesan.']),
  r('Chicken & chorizo pasta', 'dinner', 2, 25, '🍝', 'italian', [['Chicken breast (raw)', 300], ['Chorizo', 40], ['Chopped tomatoes (canned)', 400], ['Pasta (dry)', 160], ['Spinach', 60], ['Onion', 80]], ['Fry the diced chorizo until it releases its oil, then brown the chicken pieces.', 'Add the onion and tomatoes and simmer 10 minutes.', 'Toss with the cooked pasta and spinach.']),
  r('Lighter cottage pie', 'dinner', 4, 60, '🥧', 'british', [['Beef mince, 5% fat (raw)', 500], ['Carrots', 200], ['Onion', 150], ['Peas (frozen)', 200], ['Chopped tomatoes (canned)', 200], ['Potatoes (raw)', 900], ['Semi-skimmed milk', 80], ['Butter', 15]], ['Boil the potatoes for 15 minutes and mash with the milk and butter.', 'Brown the mince with the onion and carrot, add the tomatoes, Worcestershire sauce and a splash of stock; simmer 15 minutes, stir in the peas.', 'Top with the mash and bake at 200 °C for 25 minutes.']),
  r('Cod fish tacos', 'dinner', 2, 20, '🌮', 'mexican', [['Cod fillet (raw)', 280], ['Tortilla wrap', 248], ['Mixed salad leaves', 60], ['Tomato salsa', 100], ['Avocado', 80], ['Greek yoghurt, 0% fat', 60]], ['Season the cod with paprika and lime and bake at 200 °C for 10 minutes.', 'Flake into warm wraps with leaves, salsa, avocado and yoghurt.']),
  r('Butternut & chickpea tagine', 'dinner', 4, 45, '🍲', 'middle-eastern', [['Butternut squash', 600], ['Chickpeas (canned, drained)', 480], ['Chopped tomatoes (canned)', 400], ['Onion', 150], ['Raisins', 40], ['Olive oil', 15], ['Couscous (dry)', 240]], ['Soften the onion in the oil with 2 tsp ras el hanout or cumin and cinnamon.', 'Add the cubed squash, chickpeas, tomatoes, raisins and 300 ml water; simmer 25 minutes.', 'Serve with couscous.']),
  r('Mushroom & pea risotto', 'dinner', 2, 35, '🍄', 'italian', [['White rice (dry)', 150], ['Mushrooms', 250], ['Spinach', 80], ['Onion', 80], ['Peas (frozen)', 100], ['Parmesan', 30], ['Butter', 10]], ['Soften the onion in the butter, add the mushrooms for 5 minutes.', 'Stir in the rice, then add 700 ml hot stock a ladle at a time over 20 minutes, stirring.', 'Stir in the peas, spinach and parmesan.']),
  r('Pork loin, sweet potato mash & greens', 'dinner', 1, 30, '🍖', 'british', [['Pork loin chop (raw)', 150], ['Sweet potato (raw)', 250], ['Broccoli', 100], ['Green beans', 60]], ['Boil the peeled sweet potato for 12 minutes and mash.', 'Grill the pork chop for 5–6 minutes a side.', 'Steam the greens and serve.']),
  r('Prawn & chorizo paella', 'dinner', 3, 30, '🥘', 'mediterranean', [['King prawns (cooked)', 300], ['Chorizo', 60], ['White rice (dry)', 210], ['Red pepper', 160], ['Peas (frozen)', 150], ['Onion', 100], ['Chopped tomatoes (canned)', 200], ['Olive oil', 10]], ['Fry the chorizo, onion and pepper in the oil for 5 minutes.', 'Stir in the rice, paprika and a pinch of turmeric, then the tomatoes and 600 ml stock; simmer 18 minutes without stirring.', 'Add the prawns and peas for the last 4 minutes.']),
  r('Turkey steak with roasted veg couscous', 'dinner', 1, 30, '🦃', 'mediterranean', [['Turkey breast steak (raw)', 150], ['Couscous (dry)', 70], ['Courgette', 100], ['Red pepper', 100], ['Onion', 50], ['Olive oil', 10]], ['Roast the chopped veg with the oil at 200 °C for 20 minutes.', 'Griddle the seasoned turkey for 4 minutes a side.', 'Soak the couscous in boiling water and mix with the veg.']),
  r('Tofu & edamame noodle bowl', 'dinner', 1, 20, '🍜', 'asian', [['Tofu, firm', 150], ['Edamame beans (frozen)', 80], ['Rice noodles (dry)', 65], ['Carrots', 60], ['Red pepper', 60], ['Soy sauce', 15], ['Olive oil', 5]], ['Fry the cubed tofu in the oil until golden.', 'Cook the noodles with the edamame; drain.', 'Toss everything with the sliced veg, soy sauce and chilli.']),
  r('Black bean & sweet potato chilli', 'dinner', 4, 40, '🌶️', 'mexican', [['Black beans (canned, drained)', 480], ['Kidney beans (canned, drained)', 240], ['Sweet potato (raw)', 500], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Red pepper', 160], ['Brown rice (dry)', 280], ['Olive oil', 15]], ['Fry the onion and pepper in the oil with chilli and cumin.', 'Add the diced sweet potato, beans and tomatoes; simmer 25 minutes.', 'Serve with rice.']),
  r('Sausage & bean casserole', 'dinner', 4, 40, '🍲', 'british', [['Pork sausage', 454], ['Kidney beans (canned, drained)', 400], ['Chopped tomatoes (canned)', 800], ['Onion', 150], ['Carrots', 200], ['Red pepper', 160], ['Wholemeal bread', 160]], ['Brown the sausages, then slice.', 'Soften the onion, carrot and pepper, add the tomatoes, beans, paprika and sausages.', 'Simmer for 25 minutes. Serve with bread.']),
  r('Halloumi & veg traybake', 'dinner', 2, 35, '🧀', 'mediterranean', [['Halloumi', 160], ['Sweet potato (raw)', 300], ['Red pepper', 160], ['Courgette', 150], ['Chickpeas (canned, drained)', 200], ['Olive oil', 15]], ['Toss the chopped veg and chickpeas with the oil and smoked paprika; roast at 200 °C for 25 minutes.', 'Add the sliced halloumi for the last 10 minutes.']),

  // Snacks
  r('Hummus & veg sticks', 'snack', 1, 5, '🥕', 'middle-eastern', [['Hummus', 60], ['Carrots', 80], ['Cucumber', 80], ['Red pepper', 60]], ['Cut the veg into sticks and dip.']),
  r('Salted edamame', 'snack', 1, 5, '🫛', 'asian', [['Edamame beans (frozen)', 120]], ['Boil for 3 minutes, drain and sprinkle with sea salt (and chilli flakes).']),
  r('Greek yoghurt, honey & almonds', 'snack', 1, 2, '🍯', 'mediterranean', [['Greek yoghurt, 0% fat', 200], ['Honey', 10], ['Almonds', 15]], ['Top the yoghurt with honey and chopped almonds.']),
  r('Protein bar & apple', 'snack', 1, 1, '🍏', 'british', [['Protein bar', 60], ['Apple', 150]], ['Grab and go.']),
  r('Boiled eggs & tomatoes', 'snack', 1, 10, '🥚', 'british', [['Egg (large)', 116], ['Tomatoes', 100]], ['Boil the eggs for 8 minutes, cool and season. Eat with the tomatoes.']),
  r('Dark chocolate & strawberries', 'snack', 1, 2, '🍫', 'british', [['Dark chocolate (70%)', 20], ['Strawberries', 150]], ['A few squares of dark chocolate with a bowl of strawberries.']),
  r('Cottage cheese rice cakes', 'snack', 1, 3, '🍘', 'british', [['Rice cakes', 27], ['Cottage cheese', 100], ['Cucumber', 40]], ['Top the rice cakes with cottage cheese, sliced cucumber and black pepper.']),
  r('Tuna rice cakes', 'snack', 1, 3, '🐟', 'british', [['Rice cakes', 27], ['Tuna in spring water (drained)', 56], ['Light soft cheese', 20]], ['Spread the rice cakes with soft cheese and top with tuna and pepper.']),
  r('Mango lassi shake', 'snack', 1, 3, '🥭', 'indian', [['Greek yoghurt, 0% fat', 150], ['Mango', 100], ['Semi-skimmed milk', 100]], ['Blend with ice and a pinch of cardamom.']),
];

export const builtInRecipeId = (name: string) => `recipe-${slug(name)}`;
const FOODS = new Map(BUILT_IN_FOODS.map((f) => [f.name, f]));

export const BUILT_IN_RECIPES: SavedMeal[] = [...DEFS, ...MORE].map((d): SavedMeal => {
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
    tags: [],
    source: 'builtin',
    cover: d.cover,
    cuisine: d.cuisine,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}).map((r): SavedMeal => {
  const diet = recipeDiet(r);
  return { ...r, tags: diet === 'vegan' ? ['vegan', 'vegetarian'] : diet === 'vegetarian' ? ['vegetarian'] : [] };
});

export function seedRecipes(): Promise<number> {
  return seedLocal('meals', BUILT_IN_RECIPES);
}
