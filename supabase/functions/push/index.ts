// Fitness OS — reminders by Web Push (Supabase Edge Function, Deno). README §5.
//
// iPhone Home Screen apps (iOS 16.4+) can receive Web Push. Each phone that switches reminders on
// saves a row in `push_subscriptions` (migration 0011) with its reminder times and time zone; a
// cron job calls this function every 5 minutes and it sends whatever is due. Messages are
// encrypted end-to-end for the phone (RFC 8291) — the push service can't read them.
//
// Deploy:
//   node scripts/vapid-keys.mjs                       # once; prints the three secrets below
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<random>
//   supabase functions deploy push --no-verify-jwt   # cron calls use CRON_SECRET; app calls are checked in code
//   then schedule it (SQL in README §5).
//
// Calls:
//   POST {action:'config'}                       → { publicKey }            (anyone)
//   POST {action:'test', endpoint}  + user JWT   → sends "Reminders are on" to that device
//   POST {action:'run'}  + Bearer CRON_SECRET    → sends due reminders

import { dueReminders, REMINDER_TEXT, sanitiseReminders } from '../_shared/reminders.ts';
import { pushRequest, type VapidKeys } from '../_shared/webpush.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

interface Sub {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  reminders: unknown;
  last_sent: Record<string, string> | null;
}

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') ?? 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });

const vapid = (): VapidKeys | null =>
  env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY') ? { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') || 'mailto:admin@example.com' } : null;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Database error ${res.status}: ${await res.text()}`);
  return res;
}

const where = (s: Pick<Sub, 'user_id' | 'endpoint'>) => `user_id=eq.${s.user_id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`;

/** Sends one message. Returns false when the subscription is gone (unsubscribed / app deleted). */
async function send(sub: Sub, message: { title: string; body: string; url: string; tag: string }, keys: VapidKeys): Promise<boolean> {
  const res = await fetch(await pushRequest(sub, message, keys));
  if (res.status === 404 || res.status === 410) {
    await rest(`push_subscriptions?${where(sub)}`, { method: 'DELETE' });
    return false;
  }
  if (!res.ok) console.warn('push failed', res.status, await res.text());
  return res.ok;
}

async function run(keys: VapidKeys): Promise<{ checked: number; sent: number }> {
  const subs: Sub[] = await (await rest('push_subscriptions?select=*&limit=5000')).json();
  const now = new Date();
  let sent = 0;
  for (const sub of subs) {
    const due = dueReminders(sanitiseReminders(sub.reminders), sub.last_sent ?? {}, now, sub.tz, 60);
    if (!due.length) continue;
    const lastSent = { ...(sub.last_sent ?? {}) };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: sub.tz || 'UTC' }).format(now); // YYYY-MM-DD
    for (const r of due) {
      const t = REMINDER_TEXT[r.id];
      const ok = await send(sub, { title: t.title, body: t.body, url: t.url, tag: r.id }, keys);
      if (ok) sent++;
      lastSent[r.id] = today; // don't retry a failed send every 5 minutes
    }
    await rest(`push_subscriptions?${where(sub)}`, { method: 'PATCH', body: JSON.stringify({ last_sent: lastSent }) }).catch(() => {});
  }
  return { checked: subs.length, sent };
}

async function userId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env('SUPABASE_ANON_KEY') || SERVICE_KEY } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' ? user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' });
  const body = await req.json().catch(() => ({}));
  const keys = vapid();

  if (body.action === 'config') return json(req, 200, { publicKey: keys?.publicKey ?? null });
  if (!keys) return json(req, 500, { error: 'VAPID keys are not set on the server' });

  if (body.action === 'run') {
    const secret = env('CRON_SECRET');
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json(req, 401, { error: 'Not allowed' });
    return json(req, 200, await run(keys));
  }

  if (body.action === 'test') {
    const uid = await userId(req);
    if (!uid) return json(req, 401, { error: 'Sign in first' });
    if (typeof body.endpoint !== 'string') return json(req, 400, { error: 'endpoint required' });
    const rows: Sub[] = await (await rest(`push_subscriptions?${where({ user_id: uid, endpoint: body.endpoint })}&select=*`)).json();
    if (!rows.length) return json(req, 404, { error: 'This device isn’t registered yet' });
    const ok = await send(rows[0], { title: 'Reminders are on', body: 'This is how Fitness OS reminders will look.', url: '/more/devices', tag: 'test' }, keys);
    return json(req, ok ? 200 : 502, { ok });
  }
  return json(req, 400, { error: 'Unknown action' });
});
