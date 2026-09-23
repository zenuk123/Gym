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
import { daysBetween, startOfWeek } from '../../lib/dates';
import { nextRoutine } from '../../lib/calc/training';
import { useTraining } from '../workout/useTraining';
import { CoachCard } from './cards/CoachCard';
import { ConsistencyCard } from './cards/ConsistencyCard';
import { NutritionCard } from './cards/NutritionCard';
import { PBsCard } from './cards/PBsCard';
import { ReviewCard } from './cards/ReviewCard';
import { SleepCard } from './cards/SleepCard';
import { WaterCard } from './cards/WaterCard';
import { WeightCard } from './cards/WeightCard';
import { WorkoutCard } from './cards/WorkoutCard';
import { GoalsCard } from './cards/GoalsCard';
import './today.css';

/** The home screen: answers "what should I do today?" at a glance. */
export function TodayPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const weights = useWeights();
  const foodLogs = useFoodLogs(today);
  const t = useTraining();

  const intake = useMemo(() => sumIntake(foodLogs ?? []), [foodLogs]);
  const summary = useMemo(
    () => summariseWeight(weights ?? [], profile.startWeightKg, profile.targetWeightKg),
    [weights, profile.startWeightKg, profile.targetWeightKg],
  );
  const insights = useMemo(() => {
    const since = addDays(today, -20);
    const recentWeighIns = new Set((weights ?? []).filter((w) => w.date >= since).map((w) => w.date)).size;
    const training = t && {
      daysSinceLast: t.finished.length ? daysBetween(t.finished.at(-1)!.date, today) : null,
      pbsThisWeek: t.pbs.filter((p) => p.date >= startOfWeek(today)).length,
      nextRoutine: nextRoutine(t.routines, t.finished)?.name ?? null,
      active: !!t.active,
    };
    return generateInsights({ profile, weight: summary, recentWeighIns, intake, hour: new Date().getHours(), training });
  }, [profile, summary, weights, intake, today, t]);

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
      <ReviewCard profile={profile} today={today} />
      {t && <WorkoutCard profile={profile} t={t} today={today} />}
      <NutritionCard profile={profile} intake={intake} date={today} />
      {weights && <WeightCard profile={profile} weights={weights} summary={summary} today={today} />}
      <WaterCard profile={profile} date={today} />
      <SleepCard today={today} />
      {t && <GoalsCard profile={profile} t={t} />}
      <CoachCard insights={insights} />
      <div className="today-pair">
        {t && <PBsCard profile={profile} t={t} today={today} />}
        {t && <ConsistencyCard profile={profile} t={t} today={today} />}
      </div>
    </main>
  );
}
