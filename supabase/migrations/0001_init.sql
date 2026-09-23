-- Fitness OS — cloud schema (Phase 1).
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Conventions (the client's sync engine relies on these):
--   * Every table has (user_id, id) as primary key; ids are client-generated.
--   * created_at / updated_at / deleted_at are epoch milliseconds set by the client.
--   * sync_seq is assigned by the server on every write; clients pull "sync_seq > cursor".
--   * Last write wins: an update carrying an older updated_at is ignored.
--   * Row Level Security: users can only ever see and write their own rows.

create sequence if not exists public.fos_sync_seq;

create or replace function public.fos_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- stale write: keep the newer server copy
  end if;
  new.sync_seq := nextval('public.fos_sync_seq');
  return new;
end;
$$;

-- ── Profile (one row per user, id = 'me') ────────────────────────────────
create table if not exists public.profiles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  sex text not null,
  birth_year integer not null,
  height_cm double precision not null,
  activity_level text not null,
  goal text not null,
  start_weight_kg double precision not null,
  start_date text not null,
  target_weight_kg double precision,
  calorie_target integer not null,
  protein_target integer not null,
  carb_target integer,
  fat_target integer,
  water_target_ml integer not null,
  workouts_per_week integer not null,
  weight_unit text not null,
  length_unit text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

-- ── Body weight ──────────────────────────────────────────────────────────
create table if not exists public.weight_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  weight_kg double precision not null,
  note text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

-- ── Food log ─────────────────────────────────────────────────────────────
create table if not exists public.food_logs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  meal text not null,
  name text not null,
  kcal double precision not null,
  protein_g double precision not null,
  carbs_g double precision,
  fat_g double precision,
  fibre_g double precision,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

-- ── Water ────────────────────────────────────────────────────────────────
create table if not exists public.water_logs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  ml integer not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

-- ── Triggers, indexes and RLS for every synced table ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles', 'weight_entries', 'food_logs', 'water_logs'] loop
    execute format('drop trigger if exists fos_before_write on public.%I', t);
    execute format('create trigger fos_before_write before insert or update on public.%I
                    for each row execute function public.fos_before_write()', t);
    execute format('create index if not exists %I on public.%I (user_id, sync_seq)', t || '_sync_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
