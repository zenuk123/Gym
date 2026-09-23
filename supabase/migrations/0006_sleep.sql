-- Fitness OS — Phase 6: sleep log (one row per night, filed under the wake-up date).

create table if not exists public.sleep_logs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date text not null,
  bed_time text not null,
  wake_time text not null,
  duration_min double precision not null,
  quality smallint not null,
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
  foreach t in array array['sleep_logs'] loop
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
