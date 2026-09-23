import { Link } from 'react-router-dom';
import { CardHead, EmptyState } from '../../../components/CardHead';
import type { Profile } from '../../../db/types';
import { PB_LABEL } from '../../../lib/calc/training';
import { addDays, relativeDay } from '../../../lib/dates';
import { formatWeight } from '../../../lib/units';
import type { Training } from '../../workout/useTraining';

/** Latest PBs (last 30 days), one per exercise. Detected automatically from logged sets. */
export function PBsCard({ profile, t, today }: { profile: Profile; t: Training; today: string }) {
  const u = profile.weightUnit;
  const since = addDays(today, -30);
  const seen = new Set<string>();
  const recent = t.pbs
    .filter((p) => p.date >= since && p.kind !== 'volume')
    .filter((p) => (seen.has(p.exerciseId) ? false : (seen.add(p.exerciseId), true)))
    .slice(0, 3);

  return (
    <section className="card">
      <CardHead icon="trophy" tone="var(--pb)" title="Recent PBs" />
      {recent.length === 0 ? (
        <EmptyState icon="trophy">
          {t.finished.length === 0 ? 'Personal bests are detected automatically once you log workouts.' : 'Beat a previous best and it shows up here.'}
        </EmptyState>
      ) : (
        <div className="pb-mini">
          {recent.map((p) => (
            <Link key={`${p.workoutId}-${p.exerciseId}`} to={`/workout/exercises/${p.exerciseId}`} className="pb-mini-row">
              <div className="grow">
                <div className="title">{t.exMap.get(p.exerciseId)?.name}</div>
                <div className="desc">
                  {PB_LABEL[p.kind]} · {relativeDay(p.date, today)}
                </div>
              </div>
              <b className="num">{p.kind === 'e1rm' ? `${formatWeight(p.value, u)}` : `${formatWeight(p.weightKg, u)} × ${p.reps}`}</b>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
