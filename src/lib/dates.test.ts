import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isISODate, isLoggableDate, startOfWeek } from './dates';

describe('dates', () => {
  it('isISODate accepts real dates only', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2028-02-29')).toBe(true);
    for (const bad of ['', '2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', 'today']) expect(isISODate(bad)).toBe(false);
  });

  it('isLoggableDate rejects cleared pickers and the future', () => {
    expect(isLoggableDate('', '2026-10-12')).toBe(false); // '' <= '2026-…' used to pass
    expect(isLoggableDate('2026-10-13', '2026-10-12')).toBe(false);
    expect(isLoggableDate('2026-10-12', '2026-10-12')).toBe(true);
  });

  it('day maths survives DST changes', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
  });
});

describe('relativeDayInline', () => {
  it('lowercases only today/yesterday', async () => {
    const { relativeDayInline } = await import('./dates');
    expect(relativeDayInline('2026-10-12', '2026-10-12')).toBe('today');
    expect(relativeDayInline('2026-10-11', '2026-10-12')).toBe('yesterday');
    expect(relativeDayInline('2026-05-01', '2026-10-12')).toBe('1 May');
  });
});
