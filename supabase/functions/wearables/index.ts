// Fitness OS — wearables (Supabase Edge Function, Deno). README §5.
//
// Connects Withings, Oura and Fitbit with OAuth. The tokens stay here on the server (table
// `wearable_links`, migration 0011 — the app can't read it); the app asks this function to sync
// and gets back plain weigh-ins + nights, which it saves through its normal outbox (only days you
// haven't logged). Read-only: nothing is ever written to the provider.
//
// Deploy (the OAuth callback arrives without a Supabase login, so JWT checks happen in code):
//   supabase functions deploy wearables --no-verify-jwt
//
// Secrets — set only the providers you use; each needs an app registered in its developer portal
// with the redirect URL  https://<project-ref>.supabase.co/functions/v1/wearables
//   WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET   https://developer.withings.com
//   OURA_CLIENT_ID / OURA_CLIENT_SECRET           https://cloud.ouraring.com/oauth/applications
//   FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET       https://dev.fitbit.com/apps (type "Personal" is fine)
//   WEARABLES_STATE_SECRET   optional — signs the OAuth state (defaults to the service-role key)
//   ALLOWED_ORIGIN           optional — your app's origin; also limits where the callback may return to

import {
  normaliseFitbit,
  normaliseOura,
  normaliseWithings,
  PROVIDER_INFO,
  PROVIDERS,
  signState,
  verifyState,
  type Provider,
  type WearableData,
} from '../_shared/wearables.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/wearables`;
const stateSecret = () => env('WEARABLES_STATE_SECRET') || SERVICE_KEY;
const clientId = (p: Provider) => env(`${p.toUpperCase()}_CLIENT_ID`);
const clientSecret = (p: Provider) => env(`${p.toUpperCase()}_CLIENT_SECRET`);
const configured = (p: Provider) => Boolean(clientId(p) && clientSecret(p));
const MAX_DAYS = 400;

interface Link {
  user_id: string;
  provider: Provider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  connected_at: string;
  last_sync_at: string | null;
}

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') ?? 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });

// ── Database (service role; RLS keeps the app itself out of wearable_links) ──
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Database error ${res.status}: ${await res.text()}`);
  return res;
}

async function links(userId: string): Promise<Link[]> {
  return (await rest(`wearable_links?user_id=eq.${userId}&select=*`)).json();
}

/** Insert or replace a whole link (after the OAuth callback). */
async function saveLink(link: Omit<Link, 'connected_at' | 'last_sync_at'> & Partial<Link>) {
  await rest('wearable_links?on_conflict=user_id,provider', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(link) });
}

async function patchLink(user: string, provider: Provider, patch: Partial<Link>) {
  await rest(`wearable_links?user_id=eq.${user}&provider=eq.${provider}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

async function userId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env('SUPABASE_ANON_KEY') || SERVICE_KEY } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' ? user.id : null;
}

// ── OAuth ────────────────────────────────────────────────────────────────
interface Tokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<Tokens> {
  const form = new URLSearchParams(params);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (p === 'withings') {
    form.set('action', 'requesttoken');
    form.set('client_id', clientId(p));
    form.set('client_secret', clientSecret(p));
  } else if (p === 'fitbit') {
    headers.Authorization = `Basic ${btoa(`${clientId(p)}:${clientSecret(p)}`)}`;
  } else {
    form.set('client_id', clientId(p));
    form.set('client_secret', clientSecret(p));
  }
  const res = await fetch(PROVIDER_INFO[p].token, { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => ({}));
  // Withings wraps everything in { status, body }.
  const t = p === 'withings' ? (data.status === 0 ? data.body : null) : res.ok ? data : null;
  if (!t?.access_token) throw new Error(`${PROVIDER_INFO[p].name} refused the login (${res.status}${data?.error ? `: ${data.error}` : ''})`);
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at: t.expires_in ? new Date(Date.now() + (Number(t.expires_in) - 60) * 1000).toISOString() : null,
  };
}

async function freshToken(link: Link): Promise<string> {
  if (!link.expires_at || new Date(link.expires_at).getTime() > Date.now() || !link.refresh_token) return link.access_token;
  // Refresh tokens rotate for all three providers, so the new one must be stored.
  const t = await tokenRequest(link.provider, { grant_type: 'refresh_token', refresh_token: link.refresh_token });
  await patchLink(link.user_id, link.provider, { ...t, refresh_token: t.refresh_token ?? link.refresh_token });
  return t.access_token;
}

// ── Provider reads ───────────────────────────────────────────────────────
async function getJson(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Provider error ${res.status}`);
  return res.json();
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));

async function withings(token: string, from: string, to: string): Promise<WearableData> {
  const post = async (path: string, params: Record<string, string>) => {
    const data = await getJson(`https://wbsapi.withings.net/${path}`, token, { method: 'POST', body: new URLSearchParams(params) });
    if (data.status !== 0) throw new Error(`Withings error ${data.status}`);
    return data.body as Record<string, unknown>;
  };
  const measures = await post('measure', {
    action: 'getmeas',
    meastype: '1',
    category: '1',
    startdate: String(Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86_400),
    enddate: String(Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000) + 86_400),
  });
  const series: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const body = await post('v2/sleep', {
      action: 'getsummary',
      startdateymd: from,
      enddateymd: to,
      data_fields: 'total_sleep_time,wakeupduration',
      ...(offset ? { offset: String(offset) } : {}),
    });
    series.push(...((body.series as unknown[]) ?? []));
    if (!body.more) break;
    offset = Number(body.offset) || 0;
  }
  return normaliseWithings(measures, series);
}

async function oura(token: string, from: string, to: string): Promise<WearableData> {
  const items: unknown[] = [];
  let next = '';
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ start_date: addDays(from, -1), end_date: addDays(to, 1), ...(next ? { next_token: next } : {}) });
    const data = await getJson(`https://api.ouraring.com/v2/usercollection/sleep?${q}`, token);
    items.push(...((data.data as unknown[]) ?? []));
    next = typeof data.next_token === 'string' ? data.next_token : '';
    if (!next) break;
  }
  return normaliseOura(items);
}

async function fitbit(token: string, from: string, to: string): Promise<WearableData> {
  const weight: unknown[] = [];
  const sleep: unknown[] = [];
  // Fitbit caps ranges: 31 days for weight, 100 for sleep.
  for (let start = from; start <= to; start = addDays(start, 31)) {
    const end = addDays(start, 30) < to ? addDays(start, 30) : to;
    weight.push(...(((await getJson(`https://api.fitbit.com/1/user/-/body/log/weight/date/${start}/${end}.json`, token)).weight as unknown[]) ?? []));
  }
  for (let start = from; start <= to; start = addDays(start, 100)) {
    const end = addDays(start, 99) < to ? addDays(start, 99) : to;
    sleep.push(...(((await getJson(`https://api.fitbit.com/1.2/user/-/sleep/date/${start}/${end}.json`, token)).sleep as unknown[]) ?? []));
  }
  return normaliseFitbit({ weight }, { sleep });
}

const READERS: Record<Provider, (token: string, from: string, to: string) => Promise<WearableData>> = { withings, oura, fitbit };

// ── Handler ──────────────────────────────────────────────────────────────
function allowedReturn(url: string): boolean {
  try {
    const u = new URL(url);
    const origin = env('ALLOWED_ORIGIN');
    return u.protocol === 'https:' && (!origin || origin === '*' || u.origin === origin);
  } catch {
    return false;
  }
}

function done(returnTo: string, provider: Provider, error?: string): Response {
  if (returnTo) {
    const u = new URL(returnTo);
    u.searchParams.set(error ? 'wearable_error' : 'wearable', error ? error.slice(0, 200) : provider);
    return new Response(null, { status: 302, headers: { Location: u.toString() } });
  }
  // (Supabase serves function HTML as plain text, so a plain message it is.)
  const msg = error ? `Couldn't connect ${PROVIDER_INFO[provider].name}: ${error}` : `${PROVIDER_INFO[provider].name} is connected. You can close this page and go back to Fitness OS.`;
  return new Response(msg, { status: error ? 400 : 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function callback(url: URL): Promise<Response> {
  const state = await verifyState(url.searchParams.get('state') ?? '', stateSecret());
  if (!state) return new Response('This link has expired. Start again from Fitness OS.', { status: 400 });
  const err = url.searchParams.get('error');
  if (err) return done(state.r, state.p, err === 'access_denied' ? 'You didn’t allow access' : err);
  try {
    const t = await tokenRequest(state.p, { grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', redirect_uri: REDIRECT_URI });
    await saveLink({ user_id: state.u, provider: state.p, ...t, connected_at: new Date().toISOString(), last_sync_at: null });
    return done(state.r, state.p);
  } catch (e) {
    return done(state.r, state.p, e instanceof Error ? e.message : 'Unknown error');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.has('state')) return callback(url);
    return new Response('Fitness OS wearables', { status: 200 });
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(req, 500, { error: 'Server is missing its Supabase settings' });

  const uid = await userId(req);
  if (!uid) return json(req, 401, { error: 'Sign in to connect devices' });
  const body = await req.json().catch(() => ({}));
  const provider = body.provider as Provider;
  if (body.action !== 'status' && !PROVIDERS.includes(provider)) return json(req, 400, { error: 'Unknown provider' });

  try {
    switch (body.action) {
      case 'status': {
        const mine = await links(uid);
        return json(req, 200, {
          providers: PROVIDERS.map((p) => {
            const l = mine.find((x) => x.provider === p);
            return { provider: p, available: configured(p), connected: !!l, connectedAt: l?.connected_at ?? null, lastSyncAt: l?.last_sync_at ?? null };
          }),
        });
      }
      case 'start': {
        if (!configured(provider)) return json(req, 400, { error: `${PROVIDER_INFO[provider].name} isn’t set up on this server yet` });
        const returnTo = typeof body.returnTo === 'string' && allowedReturn(body.returnTo) ? body.returnTo : '';
        const info = PROVIDER_INFO[provider];
        const state = await signState({ u: uid, p: provider, r: returnTo, exp: Date.now() + 15 * 60_000 }, stateSecret());
        const q = new URLSearchParams({ response_type: 'code', client_id: clientId(provider), redirect_uri: REDIRECT_URI, scope: info.scope, state });
        return json(req, 200, { url: `${info.authorize}?${q.toString().replace(/\+/g, '%20')}` });
      }
      case 'sync': {
        const link = (await links(uid)).find((l) => l.provider === provider);
        if (!link) return json(req, 404, { error: 'Not connected' });
        const to = day(new Date());
        const earliest = addDays(to, -MAX_DAYS);
        const from = typeof body.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from) && body.from > earliest ? body.from : earliest;
        const data = await READERS[provider](await freshToken(link), from, to);
        await patchLink(uid, provider, { last_sync_at: new Date().toISOString() });
        return json(req, 200, { from, to, ...data });
      }
      case 'disconnect': {
        await rest(`wearable_links?user_id=eq.${uid}&provider=eq.${provider}`, { method: 'DELETE' });
        return json(req, 200, { ok: true });
      }
      default:
        return json(req, 400, { error: 'Unknown action' });
    }
  } catch (e) {
    return json(req, 502, { error: e instanceof Error ? e.message : 'Something went wrong' });
  }
});
