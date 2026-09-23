import { db, getMeta, setMeta } from '../db/db';
import { applyRemote, enqueue } from '../db/repo';
import { REMOTE_TABLES, SYNC_TABLES, type OutboxEntry, type SyncTable, type SyncTableMap } from '../db/types';
import { fromRemoteRow, toRemoteRow } from './mapping';
import type { RemoteAdapter } from './remote';

/**
 * Sync = push the outbox, then pull changes from the cloud.
 *
 * - Duplicates: records have client-generated UUIDs and are upserted, so resending is harmless.
 * - Conflicts: last write wins on `updatedAt`, enforced both here and by a server trigger.
 * - Failures: each outbox entry retries with exponential backoff; nothing is dropped.
 * - Deletes: soft deletes (`deletedAt`) sync like any other change.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
/** Re-read a few sequence numbers on every pull to catch rows committed out of order. */
const PULL_OVERLAP = 50;

export function backoffMs(attempts: number): number {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return base * (0.8 + Math.random() * 0.4);
}

const cursorKey = (t: SyncTable) => `pull:${t}`;

export interface SyncResult {
  pushed: number;
  pulled: number;
  failed: number;
  errors: string[];
}

async function pushTable(adapter: RemoteAdapter, userId: string, table: SyncTable, entries: OutboxEntry[], res: SyncResult) {
  for (let i = 0; i < entries.length; i += PUSH_BATCH) {
    const batch = entries.slice(i, i + PUSH_BATCH);
    const records = await db.table<SyncTableMap[SyncTable], string>(table).bulkGet(batch.map((e) => e.recordId));
    const rows = records.flatMap((r) => (r ? [toRemoteRow(r, userId)] : []));
    try {
      if (rows.length) await adapter.upsert(REMOTE_TABLES[table], rows);
      // Only clear entries that weren't re-queued by an edit made while we were uploading.
      await db.transaction('rw', db.outbox, async () => {
        for (const e of batch) {
          const cur = await db.outbox.get(e.key!);
          if (cur && cur.queuedAt === e.queuedAt) await db.outbox.delete(e.key!);
        }
      });
      res.pushed += rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.failed += batch.length;
      res.errors.push(msg);
      const now = Date.now();
      await db.transaction('rw', db.outbox, async () => {
        for (const e of batch) {
          const cur = await db.outbox.get(e.key!);
          if (!cur) continue;
          const attempts = cur.attempts + 1;
          await db.outbox.update(e.key!, { attempts, nextAttemptAt: now + backoffMs(attempts), lastError: msg });
        }
      });
    }
  }
}

export async function push(adapter: RemoteAdapter, userId: string, res: SyncResult, force = false): Promise<void> {
  const due = force
    ? await db.outbox.toArray()
    : await db.outbox.where('nextAttemptAt').belowOrEqual(Date.now()).toArray();
  for (const table of SYNC_TABLES) {
    const entries = due.filter((e) => e.table === table);
    if (entries.length) await pushTable(adapter, userId, table, entries, res);
  }
}

export async function pull(adapter: RemoteAdapter, res: SyncResult): Promise<void> {
  for (const table of SYNC_TABLES) {
    const saved = (await getMeta<number>(cursorKey(table))) ?? 0;
    let after = Math.max(0, saved - PULL_OVERLAP);
    let cursor = saved;
    for (;;) {
      const rows = await adapter.pullSince(REMOTE_TABLES[table], after, PULL_PAGE);
      if (rows.length === 0) break;
      const records = rows.map((r) => fromRemoteRow<SyncTableMap[typeof table]>(r));
      res.pulled += await applyRemote(table, records);
      after = Number(rows[rows.length - 1].sync_seq);
      cursor = Math.max(cursor, after);
      if (rows.length < PULL_PAGE) break;
    }
    if (cursor !== saved) await setMeta(cursorKey(table), cursor);
  }
}

export const photoPath = (userId: string, photoId: string) => `${userId}/${photoId}.jpg`;

/**
 * Photo files travel separately from rows: upload new ones, delete removed ones.
 * A failure leaves the file queued for the next pass (photos can be large and the
 * gym's signal poor), and never blocks row sync.
 */
export async function syncFiles(adapter: RemoteAdapter, userId: string, res: SyncResult): Promise<void> {
  for (const f of await db.photoFiles.where('remote').anyOf('pending', 'delete').toArray()) {
    try {
      if (f.remote === 'pending' && f.full) {
        await adapter.uploadFile(photoPath(userId, f.id), f.full);
        await db.photoFiles.update(f.id, { remote: 'uploaded' });
      } else if (f.remote === 'delete') {
        await adapter.deleteFile(photoPath(userId, f.id));
        await db.photoFiles.delete(f.id);
      }
    } catch (err) {
      res.errors.push(err instanceof Error ? err.message : String(err));
      return;
    }
  }
}

/** One full sync pass. Pull errors throw; push errors are recorded per entry and reported. */
export async function syncOnce(adapter: RemoteAdapter, userId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const res: SyncResult = { pushed: 0, pulled: 0, failed: 0, errors: [] };
  await push(adapter, userId, res, opts.force);
  await pull(adapter, res);
  await syncFiles(adapter, userId, res);
  return res;
}

/**
 * Called when a user signs in on this device.
 * - First account on this device: adopt the existing local data and upload it.
 * - Same account as before: nothing to do.
 * - Different account: refuse if there is unsynced data, otherwise wipe and re-download.
 */
export async function claimDevice(userId: string): Promise<'adopted' | 'same' | 'switched'> {
  const owner = await getMeta<string>('ownerUserId');
  if (owner === userId) return 'same';
  if (!owner) {
    await setMeta('ownerUserId', userId);
    const now = Date.now();
    for (const table of SYNC_TABLES) {
      // Skip untouched built-ins (updatedAt 0): every device seeds those itself.
      const ids = (await db.table(table).filter((r: { updatedAt: number }) => r.updatedAt > 0).primaryKeys()) as string[];
      await db.transaction('rw', db.outbox, async () => {
        for (const id of ids) await enqueue(table, id, now);
      });
    }
    return 'adopted';
  }
  if ((await db.outbox.count()) > 0 || (await db.photoFiles.where('remote').equals('pending').count()) > 0) {
    throw new Error('This device has unsynced data from another account. Export or reset it in Data & backup first.');
  }
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.meta, db.photoFiles], async () => {
    for (const t of SYNC_TABLES) {
      await db.table(t).clear();
      await db.meta.delete(cursorKey(t));
    }
    await db.photoFiles.clear();
    await db.meta.put({ key: 'ownerUserId', value: userId });
  });
  return 'switched';
}
