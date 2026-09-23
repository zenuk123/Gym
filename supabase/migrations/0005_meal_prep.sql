-- Fitness OS — Phase 5: meal planner + shopping list.

create table if not exists public.plan_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  slot text not null,
  kind text not null,
  food_id text,
  meal_id text,
  name text not null,
  amount_g double precision,
  servings double precision,
  kcal double precision not null,
  protein_g double precision not null,
  carbs_g double precision not null,
  fat_g double precision not null,
  fibre_g double precision,
  items jsonb not null default '[]'::jsonb,
  logged_id text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.shopping_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  week_start text not null,
  name text not null,
  category text not null,
  quantity text,
  amount_g double precision,
  food_id text,
  checked boolean not null default false,
  source text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['plan_items', 'shopping_items'] loop
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
