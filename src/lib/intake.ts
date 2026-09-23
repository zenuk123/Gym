import type { FoodLog, Profile } from '../db/types';
import { estimateMacros } from './calc/nutrition';

export interface Intake {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number;
}

export function sumIntake(logs: FoodLog[]): Intake {
  return logs.reduce(
    (t, l) => ({
      kcal: t.kcal + l.kcal,
      proteinG: t.proteinG + l.proteinG,
      carbsG: t.carbsG + (l.carbsG ?? 0),
      fatG: t.fatG + (l.fatG ?? 0),
      fibreG: t.fibreG + (l.fibreG ?? 0),
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 },
  );
}

/** Carb/fat targets: manual values if set, otherwise derived from calories + protein. */
export function macroTargets(p: Profile): { carbsG: number; fatG: number } {
  const derived = estimateMacros(p.calorieTarget, p.proteinTarget);
  return { carbsG: p.carbTarget ?? derived.carbsG, fatG: p.fatTarget ?? derived.fatG };
}
