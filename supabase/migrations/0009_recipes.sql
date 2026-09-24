-- Fitness OS — recipes: photos, method steps, time and tags on saved meals.
-- All nullable, so existing meals are unaffected. Built-in recipes are seeded on each device
-- and only reach the cloud once you edit one (e.g. add your own photo).

alter table public.saved_meals add column if not exists image text;
alter table public.saved_meals add column if not exists steps jsonb;
alter table public.saved_meals add column if not exists prep_min integer;
alter table public.saved_meals add column if not exists tags jsonb;
alter table public.saved_meals add column if not exists source text;
alter table public.saved_meals add column if not exists cover text;
