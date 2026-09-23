import type { Profile } from '../db/types';
import { GOALS } from './calc/nutrition';
import type { WeightSummary } from './calc/weight';
import { formatWeight } from './units';

/**
 * Rule-based coach insights. Every insight declares what kind of statement it is,
 * so the UI can clearly separate recorded facts, calculations and suggestions.
 * Suggestions never change targets automatically — the user decides.
 */
export type InsightKind = 'fact' | 'calculation' | 'suggestion';

export interface Insight {
  id: string;
  kind: InsightKind;
  text: string;
  /** Higher = shown first. */
  priority: number;
}

export interface InsightInput {
  profile: Profile;
  weight: WeightSummary;
  /** Number of daily weigh-ins in the last 21 days. */
  recentWeighIns: number;
  intake: { kcal: number; proteinG: number };
  hour: number;
}

const STABLE_KG_PER_WEEK = 0.1;

export function generateInsights({ profile, weight, recentWeighIns, intake, hour }: InsightInput): Insight[] {
  const out: Insight[] = [];
  const u = profile.weightUnit;
  const { rate } = weight;
  const goal = profile.goal;

  if (!weight.latest) {
    out.push({
      id: 'log-weight',
      kind: 'suggestion',
      priority: 50,
      text: 'Weigh yourself first thing in the morning, a few times a week. After 2–3 weeks I can show you your real trend.',
    });
  } else if (rate === null) {
    out.push({
      id: 'need-more-weight',
      kind: 'fact',
      priority: 20,
      text: `You have ${recentWeighIns} weigh-in${recentWeighIns === 1 ? '' : 's'} in the last 3 weeks. A few more and your weekly trend will appear.`,
    });
  } else {
    const perWeek = formatWeight(rate, u, { signed: true, decimals: 2 });
    const stable = Math.abs(rate) < STABLE_KG_PER_WEEK;
    if ((goal === 'gain_weight' || goal === 'gain_muscle') && (stable || rate < 0)) {
      out.push({
        id: 'gain-stalled',
        kind: 'suggestion',
        priority: 90,
        text: `Your average weight has ${stable ? 'been stable' : 'dropped'} (${perWeek}/week) over the last three weeks. If gaining is still your goal, consider raising your calorie target by around 150–250 kcal.`,
      });
    } else if (goal === 'lose' && (stable || rate > 0)) {
      out.push({
        id: 'loss-stalled',
        kind: 'suggestion',
        priority: 90,
        text: `Your average weight has ${stable ? 'been stable' : 'gone up'} (${perWeek}/week) over the last three weeks. If losing is still your goal, consider lowering your calorie target by around 150–250 kcal.`,
      });
    } else if (goal === 'maintain' && !stable) {
      out.push({
        id: 'maintain-drift',
        kind: 'calculation',
        priority: 60,
        text: `Your trend is ${perWeek}/week. That's more movement than "maintain" — keep an eye on it.`,
      });
    } else {
      out.push({
        id: 'on-track',
        kind: 'calculation',
        priority: 40,
        text: `Your trend is ${perWeek}/week — on track for "${GOALS[goal].label.toLowerCase()}". Keep doing what you're doing.`,
      });
    }
  }

  const proteinLeft = profile.proteinTarget - intake.proteinG;
  if (hour >= 17 && proteinLeft > 30) {
    out.push({
      id: 'protein-evening',
      kind: 'fact',
      priority: 70,
      text: `You still need ${Math.round(proteinLeft)} g of protein today. A protein-heavy dinner or shake would close the gap.`,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}
