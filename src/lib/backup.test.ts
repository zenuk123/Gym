import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { create, update } from '../db/repo';
import { createBackup, restoreBackup, toCSV } from './backup';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('backup', () => {
  it('round-trips through JSON and queues restored records for sync', async () => {
    await create('weights', { date: '2026-01-01', weightKg: 70, note: 'a, "quoted" note' });
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await db.delete();
    await db.open();
    const res = await restoreBackup(backup);
    expect(res.restored).toBe(1);
    expect(await db.weights.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('never overwrites newer local data with an older backup', async () => {
    const w = await create('weights', { date: '2026-01-01', weightKg: 70, note: null });
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await update('weights', w.id, { weightKg: 72 });
    const res = await restoreBackup(backup);
    expect(res.skipped).toBe(1);
    expect((await db.weights.get(w.id))!.weightKg).toBe(72);
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup({ hello: 'world' })).rejects.toThrow(/backup/);
  });

  it('escapes CSV cells', () => {
    expect(toCSV([{ a: 'x,y', b: 'say "hi"' }], [{ header: 'a', get: (r) => r.a }, { header: 'b', get: (r) => r.b }])).toBe(
      'a,b\n"x,y","say ""hi"""\n',
    );
  });
});

describe('workout CSV', () => {
  it('writes one row per set with the exercise name', async () => {
    const { workoutsCSV } = await import('./backup');
    await db.exercises.put({ id: 'ex-bench-press', name: 'Bench Press', muscle: 'chest', equipment: 'barbell', bodyweight: false, incrementKg: 2.5, builtIn: true, archived: false, notes: null, createdAt: 0, updatedAt: 0, deletedAt: null });
    await create('workouts', {
      routineId: null, name: 'Push', date: '2026-01-01', startedAt: 0, endedAt: 3_600_000, notes: null,
      exercises: [{ id: 'e', exerciseId: 'ex-bench-press', supersetGroup: null, restSec: 90, repMin: 6, repMax: 8, target: null, notes: null,
        sets: [{ id: 's', kind: 'normal', weightKg: 60, reps: 8, rpe: 8, done: true, completedAt: 1 }] }],
    });
    expect(await workoutsCSV()).toBe('date,workout,exercise,set,type,weight_kg,reps,rpe,duration_min\n2026-01-01,Push,Bench Press,1,normal,60,8,8,60\n');
  });
});
