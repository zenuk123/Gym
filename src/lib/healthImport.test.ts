import { describe, expect, it } from 'vitest';
import { HealthScanner, parseHealthDate } from './healthImport';

const tz = (() => {
  const o = -new Date('2026-03-01T12:00:00').getTimezoneOffset();
  const s = o >= 0 ? '+' : '-';
  return `${s}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}${String(Math.abs(o) % 60).padStart(2, '0')}`;
})();
const at = (d: string, t: string) => `${d} ${t}:00 ${tz}`;
const weight = (d: string, t: string, v: number, unit = 'kg', src = 'Scale') =>
  `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="${src}" unit="${unit}" creationDate="${at(d, t)}" startDate="${at(d, t)}" endDate="${at(d, t)}" value="${v}"/>`;
const sleep = (s: [string, string], e: [string, string], value: string, src = 'Apple Watch') =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${src}" startDate="${at(...s)}" endDate="${at(...e)}" value="HKCategoryValueSleepAnalysis${value}">\n  <MetadataEntry key="x" value="y"/>\n</Record>`;

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_GB">',
  '<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-03-01 10:00:00 +0000" endDate="2026-03-01 10:05:00 +0000" value="300"/>',
  weight('2026-03-01', '07:10', 80.4),
  weight('2026-03-01', '21:00', 81.6),
  weight('2026-03-02', '07:05', 177, 'lb'),
  // Night into 2 March: watch stages (asleep 23:30–03:00 + 03:10–06:40, awake gap) and an overlapping phone "in bed".
  sleep(['2026-03-01', '23:30'], ['2026-03-02', '03:00'], 'AsleepCore'),
  sleep(['2026-03-02', '03:00'], ['2026-03-02', '03:10'], 'Awake'),
  sleep(['2026-03-02', '03:10'], ['2026-03-02', '06:40'], 'AsleepREM'),
  sleep(['2026-03-01', '23:00'], ['2026-03-02', '07:00'], 'InBed', 'iPhone'),
  // A nap — ignored.
  sleep(['2026-03-02', '14:00'], ['2026-03-02', '14:40'], 'AsleepUnspecified'),
  '</HealthData>',
].join('\n');

describe('Apple Health import', () => {
  it('parses Health timestamps with offsets', () => {
    expect(parseHealthDate('2026-03-01 07:10:00 +0000')?.toISOString()).toBe('2026-03-01T07:10:00.000Z');
    expect(parseHealthDate('nope')).toBeNull();
  });

  it('extracts one weigh-in per day and one night per wake date, across chunk boundaries', () => {
    const s = new HealthScanner();
    for (let i = 0; i < XML.length; i += 37) s.push(XML.slice(i, i + 37)); // awkward chunk size splits tags
    const { weights, nights } = s.result();
    expect(weights).toEqual([
      { date: '2026-03-01', weightKg: 80.4 },
      { date: '2026-03-02', weightKg: 80.29 },
    ]);
    expect(nights).toHaveLength(1);
    // The watch's staged sleep (420 min, awake gap excluded) wins over the phone's longer "in bed" estimate.
    expect(nights[0]).toMatchObject({ date: '2026-03-02', bedTime: '23:30', wakeTime: '06:40', durationMin: 420, source: 'Apple Watch' });
  });

  it('prefers a source with asleep stages over its own in-bed records', () => {
    const s = new HealthScanner();
    s.push(sleep(['2026-03-01', '22:30'], ['2026-03-02', '07:00'], 'InBed', 'Watch') + sleep(['2026-03-01', '23:00'], ['2026-03-02', '06:30'], 'AsleepCore', 'Watch'));
    expect(s.result().nights[0]).toMatchObject({ bedTime: '22:30', wakeTime: '07:00', durationMin: 450 });
  });
});
