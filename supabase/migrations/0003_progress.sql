-- Fitness OS — Phase 3: progress (measurements, goals, progress photos).
-- Run after 0002_training.sql. Same row conventions as before.

create table if not exists public.measurements (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  chest_cm double precision,
  waist_cm double precision,
  arms_cm double precision,
  thighs_cm double precision,
  shoulders_cm double precision,
  hips_cm double precision,
  neck_cm double precision,
  note text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

create table if not exists public.goals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  kind text not null,
  exercise_id text,
  metric text,
  site text,
  start_value double precision not null,
  target_value double precision not null,
  start_date text not null,
  target_date text,
  archived boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

-- Photo metadata only; the images live in the private storage bucket below.
create table if not exists public.progress_photos (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  pose text not null,
  width integer not null,
  height integer not null,
  note text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['measurements', 'goals', 'progress_photos'] loop
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

-- ── Private photo storage: files at "<user id>/<photo id>.jpg", owner-only ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update set public = false;

drop policy if exists "progress photos: own folder read" on storage.objects;
create policy "progress photos: own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "progress photos: own folder insert" on storage.objects;
create policy "progress photos: own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "progress photos: own folder update" on storage.objects;
create policy "progress photos: own folder update" on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "progress photos: own folder delete" on storage.objects;
create policy "progress photos: own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
