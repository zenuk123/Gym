import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from '../db/db';
import { cloudConfigured } from './config';
import { claimDevice, syncOnce } from './engine';
import { getClient, supabaseAdapter, type CloudUser } from './remote';
import { onLocalChange } from './signal';
import { seedExercises } from '../db/seed/exercises';

/**
 * Owns the sync lifecycle: auth state, when to sync, and the status shown in the UI.
 *
 * iOS doesn't support the Background Sync API, so instead we sync:
 *   on launch · when the network comes back · when the app returns to the foreground ·
 *   shortly after any local change · every minute while open.
 */

export type SyncStatus = 'local-only' | 'signed-out' | 'offline' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  user: CloudUser | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}

let state: SyncState = {
  status: cloudConfigured ? 'signed-out' : 'local-only',
  user: null,
  lastSyncedAt: null,
  lastError: null,
};
const subscribers = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
  );
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

let running: Promise<void> | null = null;
let rerun = false;

/** Single-flight: concurrent requests collapse into one follow-up run. */
export function syncNow(opts: { force?: boolean } = {}): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await runSync(opts.force ?? false);
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runSync(force: boolean) {
  const user = state.user;
  if (!cloudConfigured || !user) return;
  if (!isOnline()) {
    setState({ status: 'offline' });
    return;
  }
  setState({ status: 'syncing' });
  try {
    const client = await getClient();
    const res = await syncOnce(supabaseAdapter(client), user.id, { force });
    const now = Date.now();
    await setMeta('lastSyncedAt', now);
    setState({
      status: res.errors.length ? 'error' : 'idle',
      lastSyncedAt: now,
      lastError: res.errors[0] ?? null,
    });
  } catch (err) {
    setState({
      status: isOnline() ? 'error' : 'offline',
      lastError: err instanceof Error ? err.message : String(err),
    });
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(delay = 1500) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(), delay);
}

async function setUser(user: CloudUser | null) {
  if (!user) {
    setState({ user: null, status: 'signed-out' });
    return;
  }
  try {
    // Switching accounts wipes local tables, so put the built-in library back.
    if ((await claimDevice(user.id)) === 'switched') await seedExercises();
  } catch (err) {
    // Another account's unsynced data is on this device — don't mix accounts.
    const client = await getClient();
    await client.auth.signOut();
    setState({ user: null, status: 'error', lastError: err instanceof Error ? err.message : String(err) });
    return;
  }
  setState({ user, status: isOnline() ? 'idle' : 'offline', lastError: null });
  void syncNow();
}

let started = false;

export async function startSync(): Promise<void> {
  if (started || !cloudConfigured) return;
  started = true;
  setState({ lastSyncedAt: (await getMeta<number>('lastSyncedAt')) ?? null });

  onLocalChange(() => scheduleSync());
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => setState({ status: state.user ? 'offline' : state.status }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 60_000);

  const client = await getClient();
  // Reads the persisted session from storage — works offline.
  const { data } = await client.auth.getSession();
  const u = data.session?.user;
  await setUser(u ? { id: u.id, email: u.email ?? null } : null);

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && session.user.id !== state.user?.id) {
      // Defer: Supabase recommends not awaiting other calls inside this callback.
      setTimeout(() => void setUser({ id: session.user.id, email: session.user.email ?? null }), 0);
    } else if (event === 'SIGNED_OUT') {
      setTimeout(() => void setUser(null), 0);
    }
  });
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await setUser({ id: data.user.id, email: data.user.email ?? null });
  if (state.status === 'error' && !state.user) throw new Error(state.lastError ?? 'Sign-in failed');
}

/** Returns true if the account is ready, false if email confirmation is required first. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session || !data.user) return false;
  await setUser({ id: data.user.id, email: data.user.email ?? null });
  return true;
}

export async function signOut(): Promise<void> {
  const client = await getClient();
  // Try to upload anything pending first; local data is kept either way.
  if ((await db.outbox.count()) > 0) await syncNow({ force: true });
  await client.auth.signOut({ scope: 'local' });
  await setUser(null);
}
