import { db } from '../db/db';
import { enqueue } from '../db/repo';
import { notifyLocalChange } from '../sync/signal';
import { SYNC_TABLES, type SyncTable, type SyncTableMap } from '../db/types';
import { toISODate } from './dates';

/** Your data is yours: full JSON backup/restore plus CSV for spreadsheets. */

export const BACKUP_FORMAT = 'fitness-os-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: { [K in SyncTable]?: SyncTableMap[K][] };
}

export async function createBackup(): Promise<Backup> {
  const tables: Backup['tables'] = {};
  for (const t of SYNC_TABLES) {
    (tables as Record<string, unknown[]>)[t] = await db.table(t).toArray();
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

function isRecord(x: unknown): x is { id: string; updatedAt: number } {
  return typeof x === 'object' && x !== null && typeof (x as { id: unknown }).id === 'string' && typeof (x as { updatedAt: unknown }).updatedAt === 'number';
}

/**
 * Merge a backup into this device. Newer versions win (same rule as sync), so restoring
 * an old backup never overwrites newer data. Restored records are queued for cloud sync.
 */
export async function restoreBackup(raw: unknown): Promise<{ restored: number; skipped: number }> {
  const b = raw as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || b.tables === null) {
    throw new Error("This doesn't look like a Fitness OS backup file.");
  }
  if ((b.version ?? 0) > BACKUP_VERSION) throw new Error('This backup is from a newer version of the app. Update first.');
  let restored = 0;
  let skipped = 0;
  for (const t of SYNC_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (!Array.isArray(rows)) continue;
    const table = db.table(t);
    await db.transaction('rw', table, db.outbox, async () => {
      for (const rec of rows) {
        if (!isRecord(rec)) {
          skipped++;
          continue;
        }
        const local = await table.get(rec.id);
        if (local && local.updatedAt >= rec.updatedAt) {
          skipped++;
          continue;
        }
        await table.put(rec);
        await enqueue(t, rec.id);
        restored++;
      }
    });
  }
  if (restored) notifyLocalChange();
  return { restored, skipped };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV<T>(rows: T[], columns: { header: string; get: (r: T) => unknown }[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.get(r))).join(','));
  return lines.join('\n') + '\n';
}

const alive = <T extends { deletedAt: number | null }>(xs: T[]) => xs.filter((x) => x.deletedAt === null);

export async function weightsCSV(): Promise<string> {
  const rows = alive(await db.weights.orderBy('date').toArray());
  return toCSV(rows, [
    { header: 'date', get: (r) => r.date },
    { header: 'weight_kg', get: (r) => r.weightKg },
    { header: 'weight_lb', get: (r) => Math.round((r.weightKg / 0.45359237) * 10) / 10 },
    { header: 'note', get: (r) => r.note },
  ]);
}

export async function sleepCSV(): Promise<string> {
  const rows = alive(await db.sleep.orderBy('date').toArray());
  return toCSV(rows, [
    { header: 'wake_date', get: (r) => r.date },
    { header: 'bed_time', get: (r) => r.bedTime },
    { header: 'wake_time', get: (r) => r.wakeTime },
    { header: 'duration_min', get: (r) => r.durationMin },
    { header: 'quality_1_5', get: (r) => r.quality },
    { header: 'note', get: (r) => r.note },
  ]);
}

export async function foodCSV(): Promise<string> {
  const rows = alive(await db.foodLogs.orderBy('date').toArray());
  return toCSV(rows, [
    { header: 'date', get: (r) => r.date },
    { header: 'meal', get: (r) => r.meal },
    { header: 'name', get: (r) => r.name },
    { header: 'kcal', get: (r) => r.kcal },
    { header: 'protein_g', get: (r) => r.proteinG },
    { header: 'carbs_g', get: (r) => r.carbsG },
    { header: 'fat_g', get: (r) => r.fatG },
    { header: 'fibre_g', get: (r) => r.fibreG },
  ]);
}

export async function waterCSV(): Promise<string> {
  const rows = alive(await db.waterLogs.orderBy('date').toArray());
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.ml);
  return toCSV([...byDate.entries()], [
    { header: 'date', get: ([d]) => d },
    { header: 'total_ml', get: ([, ml]) => ml },
  ]);
}

/** One row per logged set — easy to pivot in a spreadsheet. */
export async function workoutsCSV(): Promise<string> {
  const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
  const workouts = alive(await db.workouts.orderBy('startedAt').toArray()).filter((w) => w.endedAt !== null);
  const rows = workouts.flatMap((w) =>
    w.exercises.flatMap((ex) =>
      ex.sets.map((s, i) => ({ w, ex, s, n: i + 1 })),
    ),
  );
  return toCSV(rows, [
    { header: 'date', get: (r) => r.w.date },
    { header: 'workout', get: (r) => r.w.name },
    { header: 'exercise', get: (r) => exercises.get(r.ex.exerciseId) ?? r.ex.exerciseId },
    { header: 'set', get: (r) => r.n },
    { header: 'type', get: (r) => r.s.kind },
    { header: 'weight_kg', get: (r) => r.s.weightKg },
    { header: 'reps', get: (r) => r.s.reps },
    { header: 'rpe', get: (r) => r.s.rpe },
    { header: 'duration_min', get: (r) => Math.round(((r.w.endedAt ?? r.w.startedAt) - r.w.startedAt) / 60000) },
  ]);
}

export const stampedName = (base: string, ext: string) => `${base}-${toISODate()}.${ext}`;

/**
 * Save a file. On iPhone the share sheet is the natural way (Save to Files, AirDrop, email…);
 * elsewhere fall back to a normal download.
 */
export async function saveFile(content: string, filename: string, type: string): Promise<void> {
  const file = new File([content], filename, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // user cancelled
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Wipe everything on this device (cloud copy, if any, is untouched). */
export async function resetDevice(): Promise<void> {
  db.close();
  await db.delete();
}
