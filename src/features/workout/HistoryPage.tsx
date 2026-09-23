import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import type { Profile } from '../../db/types';
import { workoutStats } from '../../lib/calc/training';
import { formatDateShort, parseISODate, startOfWeek } from '../../lib/dates';
import { formatWeight } from '../../lib/units';
import { plural } from '../../lib/format';
import { useTraining } from './useTraining';
import './workout.css';

/** All finished workouts, grouped by week. */
export function HistoryPage({ profile }: { profile: Profile }) {
  const t = useTraining();
  if (!t) return <main className="page" />;
  const list = [...t.finished].reverse();
  const weeks = new Map<string, typeof list>();
  for (const w of list) weeks.set(startOfWeek(w.date), [...(weeks.get(startOfWeek(w.date)) ?? []), w]);

  return (
    <main className="page">
      <SubHeader title="Workout history" back="/workout" />
      {list.length === 0 && <EmptyState icon="history">Finished workouts will appear here.</EmptyState>}
      {[...weeks.entries()].map(([week, ws]) => (
        <section key={week}>
          <h2 className="section-title section-row" style={{ marginBottom: 8 }}>
            <span>Week of {formatDateShort(week)}</span>
            <span>
              {ws.length} workout{ws.length === 1 ? '' : 's'}
            </span>
          </h2>
          <div className="list">
            {ws.map((w) => {
              const s = workoutStats(w);
              const pbCount = t.pbs.filter((p) => p.workoutId === w.id).length;
              return (
                <Link key={w.id} to={`/workout/session/${w.id}`} className="list-row">
                  <div className="date-badge">
                    <b>{parseISODate(w.date).getDate()}</b>
                    <small>{parseISODate(w.date).toLocaleDateString('en-GB', { weekday: 'short' })}</small>
                  </div>
                  <div className="grow">
                    <div className="title">
                      {w.name} {pbCount > 0 && <span className="pill pb-pill">🏆 {pbCount}</span>}
                    </div>
                    <div className="desc">
                      {s.durationMin} min · {plural(s.exercises, 'exercise')} · {plural(s.sets, 'set')} · {formatWeight(s.volumeKg, profile.weightUnit, { decimals: 0 })}
                    </div>
                  </div>
                  <span className="trail">
                    <Icon name="chevronRight" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
