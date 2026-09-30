import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../../../db/db';
import { addDays, todayISO } from '../../../lib/dates';
import { fromNativeSamples, type HealthData, type NativeSample } from '../../../lib/healthData';
import { isNative, nativePlatform } from '../../../pwa/platform';
import { importHealthData, type ImportCounts } from './importHealth';

// Live Apple Health (HealthKit) / Health Connect sync — only inside the native app (README §5).
// The plugin is imported on demand, so the web bundle never loads it. Reads weight + sleep only;
// imports days you haven't logged; never writes to Health and never overwrites your entries.

const KEY = 'health.native';
const FIRST_SYNC_DAYS = 365;
const WINDOW_DAYS = 60; // read in slices so a year of watch sleep stages never hits a limit
const AUTO_EVERY_MS = 30 * 60_000;

export interface NativeHealthState {
  enabled: boolean;
  /** Date the last successful sync covered up to. */
  syncedTo: string | null;
  lastSyncAt: number | null;
  last: ImportCounts | null;
}

const DEFAULT: NativeHealthState = { enabled: false, syncedTo: null, lastSyncAt: null, last: null };

export const healthName = () => (nativePlatform() === 'android' ? 'Health Connect' : 'Apple Health');

export function useNativeHealth(): NativeHealthState | undefined {
  return useLiveQuery(async () => ({ ...DEFAULT, ...((await db.meta.get(KEY))?.value as Partial<NativeHealthState> | undefined) }), []);
}

// Returns the module, not the plugin: Capacitor plugins are proxies, and resolving a promise with
// one makes it look up `.then`, which Capacitor treats as an unknown native method.
const loadPlugin = () => import('@capgo/capacitor-health');

export async function healthAvailable(): Promise<{ available: boolean; reason?: string }> {
  if (!isNative()) return { available: false, reason: 'Live Health sync needs the native app.' };
  try {
    const r = await (await loadPlugin()).Health.isAvailable();
    return { available: r.available, reason: r.reason };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Shows the system permission sheet. iOS never reveals whether reading was allowed, so we just try. */
export async function connectHealth(): Promise<void> {
  const { Health: h } = await loadPlugin();
  await h.requestAuthorization({ read: ['weight', 'sleep'], requestHistoryAccess: true });
  const prev = (await getMeta<NativeHealthState>(KEY)) ?? DEFAULT;
  await setMeta(KEY, { ...prev, enabled: true });
}

export async function disconnectHealth(): Promise<void> {
  const prev = (await getMeta<NativeHealthState>(KEY)) ?? DEFAULT;
  await setMeta(KEY, { ...prev, enabled: false });
}

export async function openHealthSettings(): Promise<void> {
  if (nativePlatform() === 'android') await (await loadPlugin()).Health.openHealthConnectSettings();
}

async function readRange(from: string, to: string): Promise<HealthData> {
  const { Health: h } = await loadPlugin();
  const weight: NativeSample[] = [];
  const sleep: NativeSample[] = [];
  for (let start = from; start <= to; start = addDays(start, WINDOW_DAYS)) {
    const end = addDays(start, WINDOW_DAYS) > to ? addDays(to, 1) : addDays(start, WINDOW_DAYS);
    const range = { startDate: new Date(`${start}T00:00:00`).toISOString(), endDate: new Date(`${end}T00:00:00`).toISOString(), limit: 10_000, ascending: true };
    const [w, s] = await Promise.all([h.readSamples({ dataType: 'weight', ...range }), h.readSamples({ dataType: 'sleep', ...range })]);
    weight.push(...w.samples);
    sleep.push(...s.samples);
  }
  return fromNativeSamples(weight, sleep);
}

let running: Promise<ImportCounts> | null = null;

/**
 * Reads from the last synced day (minus two, for late watch uploads) up to today and imports
 * what's new. The first sync reaches back a year.
 */
export function syncHealth(): Promise<ImportCounts> {
  running ??= (async () => {
    const state = { ...DEFAULT, ...((await getMeta<NativeHealthState>(KEY)) ?? {}) };
    const today = todayISO();
    const from = state.syncedTo ? addDays(state.syncedTo, -2) : addDays(today, -FIRST_SYNC_DAYS);
    const found = await readRange(from, today);
    const counts = await importHealthData(found, healthName(), from);
    await setMeta(KEY, { ...state, syncedTo: today, lastSyncAt: Date.now(), last: counts });
    return counts;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Called once at start-up in the native app: syncs now and whenever the app comes back to the front. */
export function startHealthAutoSync(): void {
  if (!isNative()) return;
  const maybe = async () => {
    const s = await getMeta<NativeHealthState>(KEY);
    if (!s?.enabled || (s.lastSyncAt && Date.now() - s.lastSyncAt < AUTO_EVERY_MS)) return;
    await syncHealth().catch((err) => console.warn('Health sync failed', err));
  };
  void maybe();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybe();
  });
}
