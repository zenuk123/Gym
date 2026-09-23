import type { ActivityLevel, Goal, Sex } from '../../db/types';

export const ACTIVITY_LEVELS: Record<ActivityLevel, { label: string; hint: string; factor: number }> = {
  sedentary: { label: 'Sedentary', hint: 'Desk job, little exercise', factor: 1.2 },
  light: { label: 'Lightly active', hint: 'Training 1–3 days/week', factor: 1.375 },
  moderate: { label: 'Moderately active', hint: 'Training 3–5 days/week', factor: 1.55 },
  active: { label: 'Very active', hint: 'Training 6–7 days/week', factor: 1.725 },
  very_active: { label: 'Extremely active', hint: 'Physical job + hard training', factor: 1.9 },
};

export const GOALS: Record<Goal, { label: string; hint: string; kcalAdjust: number; proteinPerKg: number }> = {
  lose: { label: 'Lose weight', hint: 'Lose fat, keep muscle', kcalAdjust: -500, proteinPerKg: 2.2 },
  maintain: { label: 'Maintain', hint: 'Stay the same weight', kcalAdjust: 0, proteinPerKg: 1.8 },
  gain_weight: { label: 'Gain weight', hint: 'Put on size steadily', kcalAdjust: 400, proteinPerKg: 1.8 },
  gain_muscle: { label: 'Build muscle', hint: 'Lean gain, minimise fat', kcalAdjust: 250, proteinPerKg: 2.0 },
};

export interface BodyStats {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

/** Mifflin–St Jeor basal metabolic rate (kcal/day). "other" uses the midpoint of the sex constants. */
export function calcBMR({ sex, age, heightCm, weightKg }: BodyStats): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const sexConstant = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return base + sexConstant;
}

export function calcTDEE(stats: BodyStats, activity: ActivityLevel): number {
  return calcBMR(stats) * ACTIVITY_LEVELS[activity].factor;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export interface CalorieEstimate {
  bmr: number;
  maintenance: number;
  adjustment: number;
  target: number;
}

/** Suggested daily calories. Never below a safe floor (1,200 kcal or BMR, whichever is lower). */
export function estimateCalories(stats: BodyStats, activity: ActivityLevel, goal: Goal): CalorieEstimate {
  const bmr = calcBMR(stats);
  const maintenance = bmr * ACTIVITY_LEVELS[activity].factor;
  const adjustment = GOALS[goal].kcalAdjust;
  const floor = Math.min(1200, bmr);
  return {
    bmr: Math.round(bmr),
    maintenance: roundTo(maintenance, 10),
    adjustment,
    target: roundTo(Math.max(floor, maintenance + adjustment), 10),
  };
}

export function estimateProtein(weightKg: number, goal: Goal): number {
  return roundTo(weightKg * GOALS[goal].proteinPerKg, 5);
}

/** Split remaining calories after protein: 25% fat, rest carbs. */
export function estimateMacros(calories: number, proteinG: number): { carbsG: number; fatG: number } {
  const fatG = roundTo((calories * 0.25) / 9, 5);
  const carbsG = Math.max(0, roundTo((calories - proteinG * 4 - fatG * 9) / 4, 5));
  return { carbsG, fatG };
}

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

export interface TargetInputs {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
}

export function suggestTargets(i: TargetInputs, now = new Date()) {
  const stats = { sex: i.sex, age: ageFromBirthYear(i.birthYear, now), heightCm: i.heightCm, weightKg: i.weightKg };
  const calories = estimateCalories(stats, i.activityLevel, i.goal);
  const protein = estimateProtein(i.weightKg, i.goal);
  return { calories, protein, ...estimateMacros(calories.target, protein) };
}
