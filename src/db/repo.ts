import { db } from './db';
import { newId } from '../lib/id';
import { notifyLocalChange } from '../sync/signal';
import { PROFILE_ID, type Profile, type SyncTable, type SyncTableMap } from './types';

/**
 * All writes to synced tables go through here so that every change is
 * (1) timestamped for last-write-wins conflict resolution and
 * (2) queued in the outbox for upload — in the same transaction, so a crash
 *     can never leave a change that won't sync.
 */

type NewRecord<T extends SyncTable> = Omit<SyncTableMap[T], 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  id?: string;
};

function table<T extends SyncTable>(name: T) {
  return db.table<SyncTableMap[T], string>(name);
}

/** Monotonic per record: survives the device clock going backwards. */
function nextTimestamp(prev?: number): number {
  const now = Date.now();
  return prev !== undefined && prev >= now ? prev + 1 : now;
}

export async function enqueue(tableName: SyncTable, recordId: string, queuedAt = Date.now()): Promise<void> {
  const existing = await db.outbox.where({ table: tableName, recordId }).first();
  if (existing) {
    await db.outbox.update(existing.key!, { queuedAt, attempts: 0, nextAttemptAt: 0, lastError: null });
  } else {
    await db.outbox.add({ table: tableName, recordId, queuedAt, attempts: 0, nextAttemptAt: 0, lastError: null });
  }
}

/** Insert a new record (id generated unless provided). */
export async function create<T extends SyncTable>(name: T, data: NewRecord<T>): Promise<SyncTableMap[T]> {
  const t = table(name);
  let saved!: SyncTableMap[T];
  await db.transaction('rw', t, db.outbox, async () => {
    const id = data.id ?? newId();
    const prev = await t.get(id);
    const now = nextTimestamp(prev?.updatedAt);
    saved = { ...data, id, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null } as SyncTableMap[T];
    await t.put(saved);
    await enqueue(name, id, now);
  });
  notifyLocalChange();
  return saved;
}

/** Patch an existing record. Returns undefined if it doesn't exist. */
export async function update<T extends SyncTable>(
  name: T,
  id: string,
  patch: Partial<Omit<SyncTableMap[T], 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<SyncTableMap[T] | undefined> {
  const t = table(name);
  let saved: SyncTableMap[T] | undefined;
  await db.transaction('rw', t, db.outbox, async () => {
    const prev = await t.get(id);
    if (!prev) return;
    const now = nextTimestamp(prev.updatedAt);
    saved = { ...prev, ...patch, updatedAt: now } as SyncTableMap[T];
    await t.put(saved);
    await enqueue(name, id, now);
  });
  if (saved) notifyLocalChange();
  return saved;
}

/** Soft delete so the deletion propagates to other devices. */
export function remove<T extends SyncTable>(name: T, id: string) {
  return update(name, id, { deletedAt: Date.now() } as Partial<SyncTableMap[T]>);
}

export async function saveProfile(data: Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
  return create('profile', { ...data, id: PROFILE_ID });
}

export function updateProfile(patch: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>) {
  return update('profile', PROFILE_ID, patch);
}

/** Write records received from the cloud WITHOUT queueing them for upload. */
export async function applyRemote<T extends SyncTable>(name: T, records: SyncTableMap[T][]): Promise<number> {
  const t = table(name);
  let applied = 0;
  await db.transaction('rw', t, async () => {
    for (const rec of records) {
      const local = await t.get(rec.id);
      // Last write wins. Equal timestamps = same version (usually our own echo).
      if (!local || rec.updatedAt > local.updatedAt) {
        await t.put(rec);
        applied++;
      }
    }
  });
  return applied;
}
