-- Fitness OS — Friends: groups, shared stats and a leaderboard.
--
-- Privacy model:
--   * Nothing about your training, food or body is readable by anyone else (0001–0006 RLS).
--   * To share, your phone computes a small summary ("stats") of the things you chose to share
--     and publishes it to friend_profiles, plus feed events (PBs, goals, streaks). Raw logs never
--     leave your own rows.
--   * A friend_profile / friend_event is readable only by you and by people in a group with you.
--   * Groups are joined with an invite code through fos_join_group(); codes can't be listed.

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.friend_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.friend_members (
  group_id uuid not null references public.friend_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists friend_members_user_idx on public.friend_members (user_id);

create table if not exists public.friend_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  share jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb check (pg_column_size(stats) < 4000),
  updated_at timestamptz not null default now()
);

create table if not exists public.friend_events (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) <= 120),
  kind text not null check (kind in ('pb', 'goal', 'week', 'streak')),
  date text not null,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists friend_events_date_idx on public.friend_events (user_id, date desc);

-- ── Helpers (security definer so policies can look at memberships without recursion) ──
create or replace function public.fos_is_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friend_members where group_id = p_group and user_id = auth.uid());
$$;

create or replace function public.fos_shares_group(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.friend_members a
    join public.friend_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.friend_groups enable row level security;
alter table public.friend_members enable row level security;
alter table public.friend_profiles enable row level security;
alter table public.friend_events enable row level security;

drop policy if exists "members read" on public.friend_groups;
create policy "members read" on public.friend_groups for select to authenticated using (public.fos_is_member(id));

drop policy if exists "members read" on public.friend_members;
create policy "members read" on public.friend_members for select to authenticated using (public.fos_is_member(group_id));
drop policy if exists "leave" on public.friend_members;
create policy "leave" on public.friend_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "group read" on public.friend_profiles;
create policy "group read" on public.friend_profiles for select to authenticated using (public.fos_shares_group(user_id));
drop policy if exists "own write" on public.friend_profiles;
create policy "own write" on public.friend_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "group read" on public.friend_events;
create policy "group read" on public.friend_events for select to authenticated using (public.fos_shares_group(user_id));
drop policy if exists "own write" on public.friend_events;
create policy "own write" on public.friend_events for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Group actions (the only way to create/join; keeps invite codes private) ──
create or replace function public.fos_new_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.friend_groups where invite_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.fos_create_group(p_name text) returns public.friend_groups
language plpgsql volatile security definer set search_path = public as $$
declare
  g public.friend_groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.friend_members where user_id = auth.uid()) >= 10 then
    raise exception 'You can be in up to 10 groups';
  end if;
  insert into public.friend_groups (name, invite_code, created_by)
  values (left(trim(p_name), 40), public.fos_new_invite_code(), auth.uid())
  returning * into g;
  insert into public.friend_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end;
$$;

create or replace function public.fos_join_group(p_code text) returns public.friend_groups
language plpgsql volatile security definer set search_path = public as $$
declare
  g public.friend_groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from public.friend_groups where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if g.id is null then raise exception 'No group with that invite code'; end if;
  if not exists (select 1 from public.friend_members where group_id = g.id and user_id = auth.uid()) then
    if (select count(*) from public.friend_members where group_id = g.id) >= 50 then
      raise exception 'That group is full (50 people)';
    end if;
    if (select count(*) from public.friend_members where user_id = auth.uid()) >= 10 then
      raise exception 'You can be in up to 10 groups';
    end if;
    insert into public.friend_members (group_id, user_id) values (g.id, auth.uid());
  end if;
  return g;
end;
$$;

-- Leaving the last group also removes what you shared; an empty group is deleted.
create or replace function public.fos_leave_group(p_group uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.friend_members where group_id = p_group and user_id = auth.uid();
  if not exists (select 1 from public.friend_members where group_id = p_group) then
    delete from public.friend_groups where id = p_group;
  end if;
  if not exists (select 1 from public.friend_members where user_id = auth.uid()) then
    delete from public.friend_events where user_id = auth.uid();
    delete from public.friend_profiles where user_id = auth.uid();
  end if;
end;
$$;

-- New invite code (e.g. if one was shared too widely). Existing members stay.
create or replace function public.fos_rotate_invite(p_group uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  code text := public.fos_new_invite_code();
begin
  if not public.fos_is_member(p_group) then raise exception 'Not a member of that group'; end if;
  update public.friend_groups set invite_code = code where id = p_group;
  return code;
end;
$$;

revoke all on function public.fos_create_group(text), public.fos_join_group(text), public.fos_leave_group(uuid),
  public.fos_rotate_invite(uuid), public.fos_new_invite_code() from public, anon;
grant execute on function public.fos_create_group(text), public.fos_join_group(text), public.fos_leave_group(uuid),
  public.fos_rotate_invite(uuid) to authenticated;
