import { beforeEach, describe, expect, it } from 'vitest';
import { db, setMeta } from '../db/db';
import { create, remove, update } from '../db/repo';
import { claimDevice, syncOnce } from './engine';
import type { RemoteRow } from './mapping';
import type { RemoteAdapter } from './remote';

/** In-memory stand-in for Supabase that mimics the server trigger (LWW + sync_seq). */
class FakeServer implements RemoteAdapter {
  tables = new Map<string, Map<string, RemoteRow>>();
  seq = 0;
  offline = false;
  upserts = 0;

  private t(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }
  async upsert(table: string, rows: RemoteRow[]) {
    if (this.offline) throw new TypeError('Failed to fetch');
    this.upserts++;
    for (const r of rows) {
      const key = `${r.user_id}:${r.id}`;
      const old = this.t(table).get(key);
      if (old && (r.updated_at as number) < (old.updated_at as number)) continue;
      this.t(table).set(key, { ...r, sync_seq: ++this.seq });
    }
  }
  async pullSince(table: string, after: number, limit: number) {
    if (this.offline) throw new TypeError('Failed to fetch');
    return [...this.t(table).values()]
      .filter((r) => (r.sync_seq as number) > after)
      .sort((a, b) => (a.sync_seq as number) - (b.sync_seq as number))
      .slice(0, limit);
  }
  /** Simulate another device writing directly to the server. */
  write(table: string, row: RemoteRow) {
    return this.upsert(table, [row]);
  }
}

const USER = 'user-1';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('outbox', () => {
  it('queues every write and coalesces repeated edits of one record', async () => {
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await update('weights', w.id, { weightKg: 70.5 });
    await update('weights', w.id, { weightKg: 71 });
    expect(await db.outbox.count()).toBe(1);
  });

  it('soft deletes so deletions can sync', async () => {
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await remove('weights', w.id);
    expect((await db.weights.get(w.id))!.deletedAt).not.toBeNull();
  });

  it('keeps updatedAt monotonic', async () => {
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    const u = await update('weights', w.id, { weightKg: 71 });
    expect(u!.updatedAt).toBeGreaterThan(w.updatedAt);
  });
});

describe('sync engine', () => {
  it('pushes local changes and clears the outbox', async () => {
    const server = new FakeServer();
    await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    const res = await syncOnce(server, USER);
    expect(res.pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    const row = [...server.tables.get('weight_entries')!.values()][0];
    expect(row).toMatchObject({ user_id: USER, weight_kg: 70, date: '2026-01-01' });
  });

  it('keeps changes queued while offline and retries with backoff', async () => {
    const server = new FakeServer();
    server.offline = true;
    await create('waterLogs', { date: '2026-01-01', ml: 250 });
    await expect(syncOnce(server, USER)).rejects.toThrow(); // pull fails offline
    const [entry] = await db.outbox.toArray();
    expect(entry.attempts).toBe(1);
    expect(entry.nextAttemptAt).toBeGreaterThan(Date.now());

    // Back online: a normal pass skips the entry until its backoff expires, a forced pass sends it.
    server.offline = false;
    expect((await syncOnce(server, USER)).pushed).toBe(0);
    expect((await syncOnce(server, USER, { force: true })).pushed).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('never creates duplicates when a push is repeated', async () => {
    const server = new FakeServer();
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await syncOnce(server, USER);
    await update('weights', w.id, { weightKg: 70 }); // re-queue same record
    await syncOnce(server, USER);
    expect(server.tables.get('weight_entries')!.size).toBe(1);
  });

  it('pulls records written by another device', async () => {
    const server = new FakeServer();
    await server.write('food_logs', {
      user_id: USER, id: 'f1', date: '2026-01-01', meal: 'lunch', name: 'Chicken', kcal: 600, protein_g: 50,
      carbs_g: null, fat_g: null, fibre_g: null, created_at: 1, updated_at: 1, deleted_at: null,
    });
    const res = await syncOnce(server, USER);
    expect(res.pulled).toBe(1);
    const local = await db.foodLogs.get('f1');
    expect(local).toMatchObject({ name: 'Chicken', proteinG: 50, meal: 'lunch' });
    expect(local).not.toHaveProperty('userId');
    expect(local).not.toHaveProperty('syncSeq');
    // Pulled records are not echoed back.
    expect(await db.outbox.count()).toBe(0);
  });

  it('resolves conflicts by last write wins', async () => {
    const server = new FakeServer();
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await syncOnce(server, USER);

    // Another device edits later…
    const newer = w.updatedAt + 10_000;
    await server.write('weight_entries', {
      user_id: USER, id: w.id, date: '2026-01-01', weight_kg: 72, note: 'other device',
      created_at: w.createdAt, updated_at: newer, deleted_at: null,
    });
    // …while this device pushes an older offline edit.
    await db.weights.put({ ...w, weightKg: 71, updatedAt: w.updatedAt + 5 });
    await db.outbox.add({ table: 'weights', recordId: w.id, queuedAt: Date.now(), attempts: 0, nextAttemptAt: 0, lastError: null });

    await syncOnce(server, USER);
    expect((await db.weights.get(w.id))!.weightKg).toBe(72);
    expect([...server.tables.get('weight_entries')!.values()][0].weight_kg).toBe(72);
  });

  it('does not clear an entry that was re-queued during an in-flight push', async () => {
    const server = new FakeServer();
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    const original = server.upsert.bind(server);
    server.upsert = async (t, rows) => {
      await update('weights', w.id, { weightKg: 75 }); // edit lands mid-upload
      server.upsert = original;
      return original(t, rows);
    };
    await syncOnce(server, USER);
    expect(await db.outbox.count()).toBe(1);
    await syncOnce(server, USER);
    expect([...server.tables.get('weight_entries')!.values()][0].weight_kg).toBe(75);
  });
});

describe('claimDevice', () => {
  it('adopts existing local data for the first account', async () => {
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await db.outbox.clear();
    expect(await claimDevice(USER)).toBe('adopted');
    expect((await db.outbox.toArray()).map((e) => e.recordId)).toEqual([w.id]);
  });

  it('refuses to switch accounts while another account has unsynced data', async () => {
    await setMeta('ownerUserId', 'someone-else');
    await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await expect(claimDevice(USER)).rejects.toThrow(/another account/);
  });

  it('wipes the previous account’s synced data when switching', async () => {
    await setMeta('ownerUserId', 'someone-else');
    await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    await db.outbox.clear();
    expect(await claimDevice(USER)).toBe('switched');
    expect(await db.weights.count()).toBe(0);
  });
});
