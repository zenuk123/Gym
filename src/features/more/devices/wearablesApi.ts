import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../../../db/db';
import { addDays, todayISO } from '../../../lib/dates';
import { invokeFunction } from '../../../sync/functions';
import { PROVIDER_INFO, type Provider, type WearableData } from '../../../../supabase/functions/_shared/wearables';
import { importHealthData, type ImportCounts } from '../health/importHealth';

// Wearables through the `wearables` Edge Function (README §5): tokens live on the server; the app
// asks for weigh-ins + nights and saves only days you haven't logged, via the normal outbox.

export interface ProviderStatus {
  provider: Provider;
  available: boolean;
  connected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

interface Local {
  /** Providers connected when we last asked the server (for background sync). */
  connected: Provider[];
  syncedTo: Partial<Record<Provider, string>>;
  last: Partial<Record<Provider, ImportCounts & { at: number }>>;
  checkedAt: number;
}

const KEY = 'wearables';
const FIRST_DAYS = 365;
const AUTO_EVERY_MS = 6 * 3_600_000;
const EMPTY: Local = { connected: [], syncedTo: {}, last: {}, checkedAt: 0 };

const local = async (): Promise<Local> => ({ ...EMPTY, ...((await getMeta<Local>(KEY)) ?? {}) });

export function useWearablesLocal(): Local | undefined {
  return useLiveQuery(async () => ({ ...EMPTY, ...((await db.meta.get(KEY))?.value as Partial<Local> | undefined) }), []);
}

export async function wearableStatus(): Promise<ProviderStatus[]> {
  const { providers } = await invokeFunction<{ providers: ProviderStatus[] }>('wearables', { action: 'status' });
  const l = await local();
  await setMeta(KEY, { ...l, connected: providers.filter((p) => p.connected).map((p) => p.provider), checkedAt: Date.now() });
  return providers;
}

/** Returns the provider's login page. `returnTo` must be a https page of this app (else the server shows a plain "done" message). */
export async function startConnect(provider: Provider): Promise<string> {
  const here = new URL(window.location.href);
  const returnTo = here.protocol === 'https:' ? `${here.origin}${import.meta.env.BASE_URL}more/devices` : '';
  const { url } = await invokeFunction<{ url: string }>('wearables', { action: 'start', provider, returnTo });
  return url;
}

export async function disconnect(provider: Provider): Promise<void> {
  await invokeFunction('wearables', { action: 'disconnect', provider });
  const l = await local();
  await setMeta(KEY, { ...l, connected: l.connected.filter((p) => p !== provider) });
}

export async function syncWearable(provider: Provider): Promise<ImportCounts> {
  const l = await local();
  const today = todayISO();
  const from = l.syncedTo[provider] ? addDays(l.syncedTo[provider]!, -3) : addDays(today, -FIRST_DAYS);
  const data = await invokeFunction<WearableData & { to: string }>('wearables', { action: 'sync', provider, from });
  const counts = await importHealthData(data, PROVIDER_INFO[provider].name, from);
  const after = await local();
  await setMeta(KEY, { ...after, syncedTo: { ...after.syncedTo, [provider]: data.to ?? today }, last: { ...after.last, [provider]: { ...counts, at: Date.now() } } });
  return counts;
}

/** After a cloud sync: pull new wearable data at most every 6 hours (only for providers you connected). */
export async function autoSyncWearables(): Promise<void> {
  const l = await local();
  for (const p of l.connected) {
    const last = l.last[p]?.at ?? 0;
    if (Date.now() - last < AUTO_EVERY_MS) continue;
    await syncWearable(p).catch((err) => console.warn(`${p} sync failed`, err));
  }
}
