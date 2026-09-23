import { describe, expect, it } from 'vitest';
import type { SleepLog, Workout } from '../../db/types';
import { addDays } from '../dates';
import { formatDuration, lastNight, sleepDuration, sleepVsTraining, summariseSleep } from './sleep';

let n = 0;
function night(date: string, bedTime: string, wakeTime: string, quality = 3): SleepLog {
  return { id: `sl${++n}`, date, bedTime, wakeTime, durationMin: sleepDuration(bedTime, wakeTime), quality, note: null, createdAt: 1, updatedAt: 1, deletedAt: null };
}

function session(date: string, weightKg: number): Workout {
  const startedAt = new Date(date + 'T18:00:00').getTime();
  return {
    id: `w${++n}`,
    routineId: null,
    name: 'Session',
    date,
    startedAt,
    endedAt: startedAt + 3_600_000,
    notes: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    exercises: [
      {
        id: `we${++n}`,
        exerciseId: 'squat',
        supersetGroup: null,
        restSec: 120,
        repMin: 5,
        repMax: 5,
        target: null,
        notes: null,
        sets: [{ id: `s${++n}`, kind: 'normal', weightKg, reps: 5, rpe: null, done: true, completedAt: startedAt }],
      },
    ],
  };
}

describe('sleep duration', () => {
  it('crosses midnight', () => {
    expect(sleepDuration('23:30', '07:00')).toBe(450);
    expect(sleepDuration('01:15', '08:45')).toBe(450);
    expect(sleepDuration('22:00', '22:00')).toBe(24 * 60);
  });
  it('formats hours and minutes', () => {
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(365)).toBe('6h 05m');
  });
});

describe('summariseSleep', () => {
  it('averages, counts short nights and measures bedtime spread across midnight', () => {
    const logs = [night('2026-03-02', '23:30', '07:00', 4), night('2026-03-03', '00:30', '07:00', 2), night('2026-03-04', '23:30', '06:00', 3), night('2026-02-01', '22:00', '06:00')];
    const s = summariseSleep(logs, '2026-03-01', '2026-03-07');
    expect(s.nights).toBe(3);
    expect(s.avgMin).toBeCloseTo((450 + 390 + 390) / 3);
    expect(s.avgQuality).toBe(3);
    expect(s.shortNights).toBe(2);
    // Bedtimes 23:30, 00:30, 23:30 → mean 23:50, spread ≈ 28 min (not ~11 hours).
    expect(s.bedtimeSpreadMin).toBeCloseTo(28.28, 1);
  });
  it('is empty-safe', () => {
    const s = summariseSleep([], '2026-03-01', '2026-03-07');
    expect(s).toMatchObject({ nights: 0, avgMin: null, avgQuality: null, bedtimeSpreadMin: null, shortNights: 0 });
  });
});

describe('sleepVsTraining', () => {
  it('needs enough sessions in both groups', () => {
    expect(sleepVsTraining([], [session('2026-01-01', 100)])).toBeNull();
  });
  it('compares performance after good vs short nights', () => {
    const logs: SleepLog[] = [];
    const ws: Workout[] = [];
    let d = '2026-01-05';
    // Two baseline sessions, then alternate good (heavier) / short (lighter) nights.
    ws.push(session(d, 100));
    d = addDays(d, 2);
    ws.push(session(d, 100));
    for (let i = 0; i < 8; i++) {
      d = addDays(d, 2);
      const good = i % 2 === 0;
      logs.push(good ? night(d, '22:30', '07:00') : night(d, '01:00', '06:30'));
      ws.push(session(d, good ? 105 : 95));
    }
    const r = sleepVsTraining(logs, ws)!;
    expect(r).not.toBeNull();
    expect(r.wellRested.sessions).toBe(4);
    expect(r.short.sessions).toBe(4);
    expect(r.wellRested.performance).toBeGreaterThan(r.short.performance);
    expect(r.differencePct).toBeGreaterThan(5);
  });
});

describe('lastNight', () => {
  it('finds the log filed under today', () => {
    const logs = [night('2026-03-01', '23:00', '07:00'), night('2026-03-02', '23:00', '06:00')];
    expect(lastNight(logs, '2026-03-02')?.durationMin).toBe(420);
    expect(lastNight(logs, '2026-03-03')).toBeNull();
  });
});
