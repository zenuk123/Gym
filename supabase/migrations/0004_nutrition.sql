-- Fitness OS — Phase 4: nutrition (food database, saved meals, richer food log).

alter table public.food_logs add column if not exists food_id text;
alter table public.food_logs add column if not exists amount_g double precision;
alter table public.food_logs add column if not exists saved_meal_id text;
alter table public.food_logs add column if not exists servings double precision;

create table if not exists public.foods (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  brand text,
  category text not null,
  unit text not null default 'g',
  kcal double precision not null,
  protein_g double precision not null,
  carbs_g double precision not null,
  fat_g double precision not null,
  fibre_g double precision,
  serving_g double precision,
  serving_name text,
  barcode text,
  source text not null,
  favourite boolean not null default false,
  archived boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.saved_meals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  slot text,
  servings double precision not null default 1,
  items jsonb not null default '[]'::jsonb,
  notes text,
  favourite boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['foods', 'saved_meals'] loop
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
