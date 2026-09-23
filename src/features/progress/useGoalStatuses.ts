import { useMemo } from 'react';
import { useGoals, useMeasurements, useWeights } from '../../db/hooks';
import type { Profile } from '../../db/types';
import { bodyweightGoal, evaluateGoal, frequencyGoal, type GoalStatus } from '../../lib/calc/goals';
import { summariseWeight } from '../../lib/calc/weight';
import { useToday } from '../../lib/useToday';
import { useTraining } from '../workout/useTraining';

/** Every goal (profile targets + user goals), evaluated live. `undefined` while loading. */
export function useGoalStatuses(profile: Profile): GoalStatus[] | undefined {
  const today = useToday();
  const weights = useWeights();
  const measurements = useMeasurements();
  const goals = useGoals();
  const t = useTraining();
  return useMemo(() => {
    if (!weights || !measurements || !goals || !t) return undefined;
    const out: GoalStatus[] = [];
    const bw = bodyweightGoal(profile, summariseWeight(weights, profile.startWeightKg, profile.targetWeightKg), today);
    if (bw) out.push(bw);
    out.push(frequencyGoal(profile, t.finished, today));
    for (const g of goals.filter((x) => !x.archived)) out.push(evaluateGoal(g, { history: t.history, measurements, today }));
    return out;
  }, [profile, weights, measurements, goals, t, today]);
}
