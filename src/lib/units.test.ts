import { describe, expect, it } from 'vitest';
import { formatWeight, fromDisplayWeight, parseDecimal, toDisplayWeight } from './units';

describe('units', () => {
  it('parses comma and dot decimals', () => {
    expect(parseDecimal('62,4')).toBe(62.4);
    expect(parseDecimal(' 62.4 ')).toBe(62.4);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });

  it('round-trips kg ↔ lb', () => {
    expect(fromDisplayWeight(toDisplayWeight(70, 'lb'), 'lb')).toBeCloseTo(70);
    expect(formatWeight(70, 'lb')).toBe('154.3 lb');
    expect(formatWeight(0.25, 'kg', { signed: true })).toBe('+0.3 kg');
  });
});

describe('formatWeight', () => {
  it('never prints negative zero', () => {
    expect(formatWeight(-0.01, 'kg', { signed: true })).toBe('0 kg');
  });
});
