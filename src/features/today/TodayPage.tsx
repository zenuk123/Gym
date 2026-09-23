import { useMemo } from 'react';
import { InstallBanner } from '../../components/InstallBanner';
import { SyncBadge } from '../../components/SyncBadge';
import { useFoodLogs, useWeights } from '../../db/hooks';
import type { Profile } from '../../db/types';
import { summariseWeight } from '../../lib/calc/weight';
import { addDays, formatDateLong, greeting } from '../../lib/dates';
import { generateInsights } from '../../lib/insights';
import { sumIntake } from '../../lib/intake';
import { useToday } from '../../lib/useToday';
import { CoachCard } from './cards/CoachCard';
import { ConsistencyCard } from './cards/ConsistencyCard';
import { NutritionCard } from './cards/NutritionCard';
import { PBsCard } from './cards/PBsCard';
import { WaterCard } from './cards/WaterCard';
import { WeightCard } from './cards/WeightCard';
import { WorkoutCard } from './cards/WorkoutCard';
import './today.css';

/** The home screen: answers "what should I do today?" at a glance. */
export function TodayPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const weights = useWeights();
  const foodLogs = useFoodLogs(today);

  const intake = useMemo(() => sumIntake(foodLogs ?? []), [foodLogs]);
  const summary = useMemo(
    () => summariseWeight(weights ?? [], profile.startWeightKg, profile.targetWeightKg),
    [weights, profile.startWeightKg, profile.targetWeightKg],
  );
  const insights = useMemo(() => {
    const since = addDays(today, -20);
    const recentWeighIns = new Set((weights ?? []).filter((w) => w.date >= since).map((w) => w.date)).size;
    return generateInsights({ profile, weight: summary, recentWeighIns, intake, hour: new Date().getHours() });
  }, [profile, summary, weights, intake, today]);

  return (
    <main className="page today">
      <header className="page-header">
        <div>
          <div className="eyebrow">{formatDateLong(today)}</div>
          <h1>
            {greeting()}
            {profile.name ? `, ${profile.name}` : ''}
            {'\u00a0'}👋
          </h1>
        </div>
        <SyncBadge />
      </header>

      <InstallBanner />
      <WorkoutCard profile={profile} />
      <NutritionCard profile={profile} intake={intake} date={today} />
      {weights && <WeightCard profile={profile} weights={weights} summary={summary} today={today} />}
      <WaterCard profile={profile} date={today} />
      <CoachCard insights={insights} />
      <div className="today-pair">
        <PBsCard />
        <ConsistencyCard profile={profile} />
      </div>
    </main>
  );
}
