-- Fitness OS — "Tell me how you eat" answers and recipe cuisines. Nullable; existing rows unaffected.

alter table public.profiles add column if not exists food_prefs jsonb;
alter table public.saved_meals add column if not exists cuisine text;
