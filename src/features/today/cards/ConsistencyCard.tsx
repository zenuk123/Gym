import { CardHead } from '../../../components/CardHead';
import type { Profile } from '../../../db/types';
import { finishedWorkoutsInWeek, weekStreak } from '../../../lib/calc/training';
import { relativeDay, startOfWeek } from '../../../lib/dates';
import type { Training } from '../../workout/useTraining';

/** Sessions this week vs target, and consecutive weeks on target. */
export function ConsistencyCard({ profile, t, today }: { profile: Profile; t: Training; today: string }) {
  const target = profile.workoutsPerWeek;
  const done = finishedWorkoutsInWeek(t.finished, startOfWeek(today)).length;
  const streak = weekStreak(t.finished, target, today);
  const last = t.finished.at(-1);

  return (
    <section className="card">
      <CardHead icon="flame" tone="var(--streak)" title="Consistency" />
      <div className="big-num">
        {done}
        <small>/ {target} this week</small>
      </div>
      <div className="dots" aria-hidden="true">
        {Array.from({ length: Math.max(target, done) }, (_, i) => (
          <span key={i} className={i < done ? 'on' : ''} />
        ))}
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        {streak > 0 ? `🔥 ${streak}-week streak on target` : 'Hit your weekly target to start a streak'}
        {last && ` · last workout ${relativeDay(last.date, today).toLowerCase()}`}
      </p>
    </section>
  );
}
