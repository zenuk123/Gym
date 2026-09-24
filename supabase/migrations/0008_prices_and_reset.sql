-- Fitness OS — shopping-list price book, and "Reset" on Today's workout.

-- Profile: pinned next routine (Reset → restart rotation) and the price-book currency.
-- Nullable, so existing profiles are unaffected.
alter table public.profiles add column if not exists next_routine_id text;
alter table public.profiles add column if not exists next_routine_set_at bigint;
alter table public.profiles add column if not exists currency text;

-- Price book: what an item costs at a shop, entered by the user.
create table if not exists public.prices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  item_key text not null,
  name text not null,
  shop text not null,
  price double precision not null,
  pack_g double precision,
  updated_on text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  sync_seq bigint not null default 0,
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['prices'] loop
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
