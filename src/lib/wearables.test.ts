import { describe, expect, it } from 'vitest';
import { localParts, normaliseFitbit, normaliseOura, normaliseWithings, signState, verifyState } from '../../supabase/functions/_shared/wearables';

describe('wearables', () => {
  it('Withings: kg from value×10^unit in the user’s zone, earliest per day, sleep filed by wake date', () => {
    const t = (s: string) => Date.parse(s) / 1000;
    const out = normaliseWithings(
      {
        timezone: 'Europe/London',
        measuregrps: [
          { date: t('2026-07-01T18:00:00Z'), category: 1, measures: [{ type: 1, value: 81200, unit: -3 }] },
          { date: t('2026-07-01T06:10:00Z'), category: 1, measures: [{ type: 1, value: 8045, unit: -2 }, { type: 6, value: 180, unit: -1 }] },
          { date: t('2026-07-02T06:00:00Z'), category: 2, measures: [{ type: 1, value: 75, unit: 0 }] }, // a goal, not a weigh-in
          { date: t('2026-06-30T23:30:00Z'), category: 1, measures: [{ type: 1, value: 80, unit: 0 }] }, // 00:30 BST on 1 July
        ],
      },
      [{ startdate: t('2026-06-30T22:00:00Z'), enddate: t('2026-07-01T05:45:00Z'), data: { total_sleep_time: 25200 } }],
    );
    expect(out.weights).toEqual([{ date: '2026-07-01', weightKg: 80 }]);
    expect(out.nights).toEqual([{ date: '2026-07-01', bedTime: '23:00', wakeTime: '06:45', durationMin: 420, source: 'Withings' }]);
  });

  it('Oura: main sleep only, local wall-clock times, longest per night', () => {
    const out = normaliseOura([
      { type: 'long_sleep', bedtime_start: '2026-07-01T23:12:00+01:00', bedtime_end: '2026-07-02T07:01:00+01:00', total_sleep_duration: 25080 },
      { type: 'late_nap', bedtime_start: '2026-07-02T14:00:00+01:00', bedtime_end: '2026-07-02T14:40:00+01:00', total_sleep_duration: 2100 },
      { type: 'sleep', bedtime_start: '2026-07-02T05:00:00+01:00', bedtime_end: '2026-07-02T06:00:00+01:00', total_sleep_duration: 3000 },
      { bedtime_start: 'nonsense' },
    ]);
    expect(out.nights).toEqual([{ date: '2026-07-02', bedTime: '23:12', wakeTime: '07:01', durationMin: 418, source: 'Oura' }]);
    expect(out.weights).toEqual([]);
  });

  it('Fitbit: earliest weigh-in, main sleep only', () => {
    const out = normaliseFitbit(
      { weight: [{ date: '2026-07-01', time: '19:00:00', weight: 81 }, { date: '2026-07-01', time: '07:00:00', weight: 80.3 }, { date: 'x', weight: 80 }] },
      {
        sleep: [
          { dateOfSleep: '2026-07-02', startTime: '2026-07-01T23:40:30.000', endTime: '2026-07-02T06:50:30.000', minutesAsleep: 391, isMainSleep: true },
          { dateOfSleep: '2026-07-02', startTime: '2026-07-02T13:00:00.000', endTime: '2026-07-02T16:00:00.000', minutesAsleep: 170, isMainSleep: false },
        ],
      },
    );
    expect(out.weights).toEqual([{ date: '2026-07-01', weightKg: 80.3 }]);
    expect(out.nights).toEqual([{ date: '2026-07-02', bedTime: '23:40', wakeTime: '06:50', durationMin: 391, source: 'Fitbit' }]);
  });

  it('localParts handles bad zones', () => {
    expect(localParts(Date.UTC(2026, 0, 1, 12, 5) / 1000, 'Nowhere/Land')).toEqual({ date: '2026-01-01', time: '12:05' });
  });

  it('OAuth state is signed, expires, and can’t be tampered with', async () => {
    const s = { u: 'user-1', p: 'oura' as const, r: 'https://app.example/', exp: 2_000_000 };
    const token = await signState(s, 'secret');
    expect(await verifyState(token, 'secret', 1_000_000)).toEqual(s);
    expect(await verifyState(token, 'secret', 3_000_000)).toBeNull(); // expired
    expect(await verifyState(token, 'other', 1_000_000)).toBeNull();
    const [payload, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ ...s, u: 'user-2' })).replace(/=+$/, '');
    expect(await verifyState(`${forged}.${sig}`, 'secret', 1_000_000)).toBeNull();
    expect(await verifyState(payload, 'secret', 1_000_000)).toBeNull();
  });
});
