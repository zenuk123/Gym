-- Fitness OS — devices: wearables (OAuth tokens) and web-push reminders. README §5.
-- Neither table is part of the app's Dexie sync; the Edge Functions `wearables` and `push` use them.

-- ── Wearable links ───────────────────────────────────────────────────────
-- OAuth tokens for Withings / Oura / Fitbit. Only the `wearables` Edge Function (service role)
-- touches this table: RLS is on with no policies and the app's roles have no grants, so tokens
-- can never be read from a phone.
create table if not exists public.wearable_links (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('withings', 'oura', 'fitbit')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  primary key (user_id, provider)
);
alter table public.wearable_links enable row level security;
revoke all on public.wearable_links from anon, authenticated;

-- ── Push subscriptions ───────────────────────────────────────────────────
-- One row per installed app that allowed notifications. The phone writes its own row (endpoint,
-- keys, time zone and reminder times); the `push` Edge Function sends due reminders and records
-- what it sent in last_sent (reminder id → local date).
create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  tz text not null default 'UTC' check (char_length(tz) <= 64),
  reminders jsonb not null default '[]'::jsonb check (pg_column_size(reminders) < 4000),
  last_sent jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
