-- Fitness OS — Phase 2: training (exercise library, routines, workouts).
-- Run after 0001_init.sql. Same conventions: (user_id, id) PK, client epoch-ms timestamps,
-- server-assigned sync_seq, last-write-wins trigger and owner-only RLS.
-- Nested lists (routine exercises, workout exercises + sets) are stored as jsonb so a
-- whole workout saves and syncs atomically.

create table if not exists public.exercises (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  muscle text not null,
  equipment text not null,
  bodyweight boolean not null default false,
  increment_kg double precision not null,
  built_in boolean not null default false,
  archived boolean not null default false,
  notes text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.routines (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  notes text,
  sort_order integer not null default 0,
  exercises jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.workouts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  routine_id text,
  name text not null,
  date text not null,
  started_at bigint not null,
  ended_at bigint,
  notes text,
  exercises jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['exercises', 'routines', 'workouts'] loop
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
