import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import type { Profile } from '../../db/types';
import { exerciseBests, REP_MAXES } from '../../lib/calc/training';
import { relativeDayInline } from '../../lib/dates';
import { plural } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { formatWeight, round, toDisplayWeight } from '../../lib/units';
import { LogRecordSheet } from './LogRecordSheet';
import { matchesExercise } from './logic';
import { useTraining } from './useTraining';
import './workout.css';

/** Every exercise's bests in one place — from workouts and PRs logged on their own. */
export function RecordsPage({ profile }: { profile: Profile }) {
  const t = useTraining();
  const today = useToday();
  const [q, setQ] = useState('');
  const [logging, setLogging] = useState<string | true | null>(null);
  const u = profile.weightUnit;
  const short = (kg: number) => String(round(toDisplayWeight(kg, u), 1));

  const rows = useMemo(() => {
    if (!t) return [];
    return [...t.bests.entries()]
      .flatMap(([id, sessions]) => {
        const ex = t.exMap.get(id);
        return ex ? [{ ex, bests: exerciseBests(sessions), recordCount: t.records.filter((r) => r.exerciseId === id).length }] : [];
      })
      .filter((r) => matchesExercise(r.ex.name, q))
      .sort((a, b) => (b.bests.lastImproved ?? '').localeCompare(a.bests.lastImproved ?? '') || a.ex.name.localeCompare(b.ex.name));
  }, [t, q]);

  if (!t) return <main className="page" />;

  return (
    <main className="page">
      <SubHeader title="Personal records" back="/workout" />
      <button className="btn btn-primary btn-lg btn-block" onClick={() => setLogging(true)}>
        <Icon name="trophy" /> Log a PR
      </button>
      <p className="faint" style={{ fontSize: 13 }}>
        Bests come from your workouts automatically. Log a PR for lifts done elsewhere — a test day, another gym, or before you used the app.
      </p>

      {t.bests.size > 6 && (
        <div className="input-wrap">
          <Icon name="search" width={20} height={20} color="var(--text-3)" />
          <input type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} aria-label="Search records" />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="trophy">{t.bests.size ? 'No exercise matches.' : 'No lifts yet. Log a PR, or finish a workout, and your bests appear here.'}</EmptyState>
      ) : (
        rows.map(({ ex, bests, recordCount }) => (
          <section key={ex.id} className="card record-card">
            <div className="record-head">
              <Link to={`/workout/exercises/${ex.id}`} className="grow record-title">
                <b>{ex.name}</b>
                <span className="faint">
                  {bests.lastImproved ? `Last PR ${relativeDayInline(bests.lastImproved, today)}` : ''}
                  {recordCount ? ` · ${plural(recordCount, 'logged PR')}` : ''}
                </span>
              </Link>
              <button className="chip" onClick={() => setLogging(ex.id)} aria-label={`Log a PR for ${ex.name}`}>
                <Icon name="plus" width={14} height={14} /> PR
              </button>
            </div>
            {ex.bodyweight && !(bests.heaviest && bests.heaviest.weightKg > 0) ? (
              <div className="record-main">
                <span className="faint">Most reps</span>
                <b className="num">{bests.mostReps ? `${bests.mostReps.reps} reps` : '—'}</b>
              </div>
            ) : (
              <>
                <div className="record-main">
                  <span className="faint">Heaviest</span>
                  <b className="num">{bests.heaviest ? `${formatWeight(bests.heaviest.weightKg, u)} × ${bests.heaviest.reps}` : '—'}</b>
                  {!ex.bodyweight && bests.e1rm && (
                    <>
                      <span className="faint">Best e1RM</span>
                      <b className="num">{formatWeight(bests.e1rm.value, u)}</b>
                    </>
                  )}
                </div>
                <div className="rep-maxes" role="table" aria-label={`${ex.name} rep maxes`}>
                  {REP_MAXES.map((n) => (
                    <div key={n} role="row" className={bests.repMaxes[n] ? '' : 'empty'}>
                      <span role="rowheader">{n}RM</span>
                      <b role="cell" className="num">{bests.repMaxes[n] ? short(bests.repMaxes[n]!.weightKg) : '—'}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        ))
      )}

      {logging && <LogRecordSheet t={t} profile={profile} exerciseId={logging === true ? undefined : logging} onClose={() => setLogging(null)} />}
    </main>
  );
}
