// Fitness OS — Claude proxy (Supabase Edge Function, Deno).
//
// Lets the app use the AI coach without storing an Anthropic API key on the phone:
// the key lives in this function's secrets, and only signed-in users on the allow-list
// can use it. The app's SDK client points its baseURL here, so requests arrive as
// POST /claude/v1/messages and are forwarded unchanged (streaming included).
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_EMAILS=you@example.com
//   supabase functions deploy claude
//
// Secrets:
//   ANTHROPIC_API_KEY  required
//   ALLOWED_EMAILS     required — comma-separated; anyone else who signs up is refused
//   ALLOWED_ORIGIN     optional — e.g. https://your-app.vercel.app (default: *)

const API = 'https://api.anthropic.com';
const MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
const FORWARD_HEADERS = ['anthropic-version', 'anthropic-beta', 'content-type'];

const env = (k: string) => Deno.env.get(k) ?? '';
const allowed = () =>
  env('ALLOWED_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') ?? 'authorization, content-type, anthropic-version, anthropic-beta',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function error(req: Request, status: number, message: string) {
  // Same shape as the Anthropic API, so the SDK raises its usual typed errors.
  return new Response(JSON.stringify({ type: 'error', error: { type: status === 401 ? 'authentication_error' : status === 403 ? 'permission_error' : 'invalid_request_error', message } }), {
    status,
    headers: { ...cors(req), 'content-type': 'application/json' },
  });
}

async function userEmail(auth: string): Promise<string | null> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: env('SUPABASE_ANON_KEY') } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.email === 'string' ? user.email.toLowerCase() : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return error(req, 405, 'Method not allowed');

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/claude/, '');
  if (path !== '/v1/messages') return error(req, 404, `Only /v1/messages is proxied (got ${path})`);

  if (!env('ANTHROPIC_API_KEY')) return error(req, 500, 'ANTHROPIC_API_KEY is not set on the server');
  const list = allowed();
  if (!list.length) return error(req, 403, 'ALLOWED_EMAILS is not set on the server');
  const auth = req.headers.get('authorization') ?? '';
  const email = auth.startsWith('Bearer ') ? await userEmail(auth) : null;
  if (!email) return error(req, 401, 'Sign in to use the coach');
  if (!list.includes(email)) return error(req, 403, 'This account is not allowed to use the coach');

  const body = await req.text();
  let model = '';
  try {
    model = JSON.parse(body).model;
  } catch {
    return error(req, 400, 'Body must be JSON');
  }
  if (!MODELS.has(model)) return error(req, 400, `Model ${model} is not enabled on this proxy`);

  const headers = new Headers({ 'x-api-key': env('ANTHROPIC_API_KEY') });
  for (const h of FORWARD_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const upstream = await fetch(`${API}/v1/messages${url.search}`, { method: 'POST', headers, body, signal: req.signal });
  const out = new Headers(cors(req));
  for (const h of ['content-type', 'request-id', 'retry-after']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
