import type { LengthUnit, WeightUnit } from '../db/types';

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;

export const toDisplayWeight = (kg: number, unit: WeightUnit) => (unit === 'kg' ? kg : kgToLb(kg));
export const fromDisplayWeight = (v: number, unit: WeightUnit) => (unit === 'kg' ? v : lbToKg(v));
export const toDisplayLength = (cm: number, unit: LengthUnit) => (unit === 'cm' ? cm : cmToIn(cm));
export const fromDisplayLength = (v: number, unit: LengthUnit) => (unit === 'cm' ? v : inToCm(v));

export function round(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function formatWeight(kg: number, unit: WeightUnit, opts: { signed?: boolean; decimals?: number } = {}): string {
  const v = round(toDisplayWeight(kg, unit), opts.decimals ?? 1) || 0; // avoid "-0"
  const sign = opts.signed && v > 0 ? '+' : '';
  return `${sign}${v.toLocaleString('en-GB', { maximumFractionDigits: opts.decimals ?? 1 })} ${unit}`;
}

/** Accepts "62,4" as well as "62.4" (European keypads). Returns null if not a finite number. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (s === '' || !/^-?\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
