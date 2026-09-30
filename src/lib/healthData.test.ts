import { describe, expect, it } from 'vitest';
import { freshOnly, fromNativeSamples, weightsFrom } from './healthData';

const iso = (s: string) => new Date(s).toISOString();

describe('native Health samples', () => {
  it('keeps the earliest weigh-in per day and drops nonsense', () => {
    const w = weightsFrom([
      { at: new Date('2026-05-01T19:00:00'), kg: 81 },
      { at: new Date('2026-05-01T07:10:00'), kg: 80.456 },
      { at: new Date('2026-05-02T07:00:00'), kg: 5 },
    ]);
    expect(w).toEqual([{ date: '2026-05-01', weightKg: 80.46 }]);
  });

  it('builds a night from iOS stage samples (awake gaps excluded, in-bed ignored when staged)', () => {
    const stage = (a: string, b: string, stage: string) => ({ value: 0, startDate: iso(a), endDate: iso(b), sourceName: 'Watch', sleepState: stage, stages: [{ startDate: iso(a), endDate: iso(b), stage }] });
    const { nights } = fromNativeSamples(
      [],
      [
        stage('2026-05-01T22:30:00', '2026-05-02T07:00:00', 'inBed'),
        stage('2026-05-01T23:00:00', '2026-05-02T02:00:00', 'light'),
        stage('2026-05-02T02:00:00', '2026-05-02T02:20:00', 'awake'),
        stage('2026-05-02T02:20:00', '2026-05-02T04:00:00', 'deep'),
        stage('2026-05-02T04:00:00', '2026-05-02T06:40:00', 'rem'),
      ],
    );
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ date: '2026-05-02', bedTime: '22:30', wakeTime: '07:00', durationMin: 440, source: 'Watch' });
  });

  it('counts an Android session without stages as asleep, and ignores naps', () => {
    const { nights } = fromNativeSamples(
      [{ value: 80, unit: 'kilogram', startDate: iso('2026-05-03T07:00:00'), endDate: iso('2026-05-03T07:00:00') }],
      [
        { value: 420, startDate: iso('2026-05-02T23:30:00'), endDate: iso('2026-05-03T06:30:00'), sourceName: 'Fitbit' },
        { value: 40, startDate: iso('2026-05-03T14:00:00'), endDate: iso('2026-05-03T14:40:00'), sourceName: 'Fitbit' },
      ],
    );
    expect(nights).toEqual([{ date: '2026-05-03', bedTime: '23:30', wakeTime: '06:30', durationMin: 420, source: 'Fitbit' }]);
  });

  it('freshOnly keeps only days you have not logged', () => {
    const found = {
      weights: [
        { date: '2026-05-01', weightKg: 80 },
        { date: '2026-05-02', weightKg: 79.8 },
      ],
      nights: [{ date: '2026-05-02', bedTime: '23:00', wakeTime: '07:00', durationMin: 480, source: 'x' }],
    };
    const fresh = freshOnly(found, { weights: ['2026-05-01'], nights: ['2026-05-02'] });
    expect(fresh.weights.map((w) => w.date)).toEqual(['2026-05-02']);
    expect(fresh.nights).toEqual([]);
    expect(freshOnly(found, { weights: [], nights: [] }, '2026-05-02').weights).toHaveLength(1);
  });
});
