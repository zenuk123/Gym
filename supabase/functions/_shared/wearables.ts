// Wearables — provider settings and pure normalisers shared by the `wearables` Edge Function
// (Deno) and the app's unit tests (Vitest). No imports, no I/O: every provider's JSON is turned
// into the same shape the Apple Health import uses — one weigh-in per day and one night per
// wake-up date, with local times taken from the provider's own time zone.

export type Provider = 'withings' | 'oura' | 'fitbit';
export const PROVIDERS: Provider[] = ['withings', 'oura', 'fitbit'];

export interface ProviderInfo {
  name: string;
  authorize: string;
  token: string;
  scope: string;
  /** Scope separator in the authorize URL. */
  sep: string;
  gives: string;
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  withings: {
    name: 'Withings',
    authorize: 'https://account.withings.com/oauth2_user/authorize2',
    token: 'https://wbsapi.withings.net/v2/oauth2',
    scope: 'user.metrics,user.activity',
    sep: ',',
    gives: 'Weight from your scale, sleep from Sleep Analyzer or a watch',
  },
  oura: {
    name: 'Oura',
    authorize: 'https://cloud.ouraring.com/oauth/authorize',
    token: 'https://api.ouraring.com/oauth/token',
    scope: 'personal daily',
    sep: ' ',
    gives: 'Sleep from your ring',
  },
  fitbit: {
    name: 'Fitbit',
    authorize: 'https://www.fitbit.com/oauth2/authorize',
    token: 'https://api.fitbit.com/oauth2/token',
    scope: 'weight sleep',
    sep: ' ',
    gives: 'Weight (Aria scale or logged) and sleep',
  },
};

export interface WeighIn {
  date: string;
  weightKg: number;
}

export interface Night {
  date: string;
  bedTime: string;
  wakeTime: string;
  durationMin: number;
  source: string;
}

export interface WearableData {
  weights: WeighIn[];
  nights: Night[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Local date + HH:MM of a unix time in an IANA time zone (falls back to UTC). */
export function localParts(unixSec: number, tz: string | undefined): { date: string; time: string } {
  const at = new Date(unixSec * 1000);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return { date: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` };
}

/** "2026-05-01T23:12:30+01:00" (or without offset) → the local date and HH:MM as written. */
function wallClock(iso: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? { date: m[1], time: m[2] } : null;
}

const sane = (kg: number) => kg > 20 && kg < 400;

/** Keep one weigh-in per day (the earliest) and the longest night per wake-up date. */
function tidy(weights: (WeighIn & { at: number })[], nights: Night[]): WearableData {
  const w = new Map<string, WeighIn & { at: number }>();
  for (const x of weights) {
    const prev = w.get(x.date);
    if (sane(x.weightKg) && (!prev || x.at < prev.at)) w.set(x.date, x);
  }
  const n = new Map<string, Night>();
  for (const x of nights) {
    if (x.durationMin < 120 || x.durationMin > 16 * 60) continue;
    const prev = n.get(x.date);
    if (!prev || x.durationMin > prev.durationMin) n.set(x.date, x);
  }
  return {
    weights: [...w.values()].map(({ date, weightKg }) => ({ date, weightKg: Math.round(weightKg * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date)),
    nights: [...n.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Withings: `measure?action=getmeas` body + `v2/sleep?action=getsummary` series. */
export function normaliseWithings(measureBody: unknown, sleepSeries: unknown[]): WearableData {
  const body = obj(measureBody);
  const tz = str(body.timezone);
  const weights: (WeighIn & { at: number })[] = [];
  for (const g of arr(body.measuregrps)) {
    const grp = obj(g);
    const at = num(grp.date);
    if (at === null || (num(grp.category) ?? 1) !== 1) continue; // 2 = user objectives, not measurements
    for (const m of arr(grp.measures)) {
      const x = obj(m);
      if (num(x.type) !== 1) continue;
      const value = num(x.value);
      const unit = num(x.unit);
      if (value === null || unit === null) continue;
      weights.push({ date: localParts(at, tz).date, weightKg: value * 10 ** unit, at });
    }
  }
  const nights: Night[] = [];
  for (const s of sleepSeries) {
    const x = obj(s);
    const start = num(x.startdate);
    const end = num(x.enddate);
    if (start === null || end === null || end <= start) continue;
    const zone = str(x.timezone) || tz;
    const data = obj(x.data);
    const asleep = num(data.total_sleep_time) ?? (end - start - (num(data.wakeupduration) ?? 0));
    const wake = localParts(end, zone);
    nights.push({ date: wake.date, bedTime: localParts(start, zone).time, wakeTime: wake.time, durationMin: Math.round(asleep / 60), source: 'Withings' });
  }
  return tidy(weights, nights);
}

/** Oura: `v2/usercollection/sleep` items (all pages concatenated). */
export function normaliseOura(sleepItems: unknown[]): WearableData {
  const nights: Night[] = [];
  for (const s of sleepItems) {
    const x = obj(s);
    const type = str(x.type);
    if (type && type !== 'long_sleep' && type !== 'sleep') continue; // skip naps / rest
    const bed = wallClock(str(x.bedtime_start));
    const wake = wallClock(str(x.bedtime_end));
    const total = num(x.total_sleep_duration);
    if (!bed || !wake || total === null) continue;
    nights.push({ date: wake.date, bedTime: bed.time, wakeTime: wake.time, durationMin: Math.round(total / 60), source: 'Oura' });
  }
  return tidy([], nights);
}

/** Fitbit: `body/log/weight` (metric — no Accept-Language header) + `1.2 sleep` responses. */
export function normaliseFitbit(weightJson: unknown, sleepJson: unknown): WearableData {
  const weights: (WeighIn & { at: number })[] = [];
  for (const w of arr(obj(weightJson).weight)) {
    const x = obj(w);
    const kg = num(x.weight);
    const date = str(x.date);
    if (kg === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const [h, m, s] = (str(x.time) || '00:00:00').split(':').map(Number);
    weights.push({ date, weightKg: kg, at: (h || 0) * 3600 + (m || 0) * 60 + (s || 0) });
  }
  const nights: Night[] = [];
  for (const s of arr(obj(sleepJson).sleep)) {
    const x = obj(s);
    if (x.isMainSleep === false) continue;
    const bed = wallClock(str(x.startTime));
    const wake = wallClock(str(x.endTime));
    const mins = num(x.minutesAsleep);
    if (!bed || !wake || mins === null) continue;
    nights.push({ date: str(x.dateOfSleep) || wake.date, bedTime: bed.time, wakeTime: wake.time, durationMin: Math.round(mins), source: 'Fitbit' });
  }
  return tidy(weights, nights);
}

/** Signed OAuth `state` (so the callback knows which account connected, and can't be forged). */
export interface OAuthState {
  u: string;
  p: Provider;
  r: string;
  exp: number;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

export async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(state)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifyState(token: string, secret: string, now = Date.now()): Promise<OAuthState | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(secret, payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as OAuthState;
    return s.exp > now && PROVIDERS.includes(s.p) ? s : null;
  } catch {
    return null;
  }
}
