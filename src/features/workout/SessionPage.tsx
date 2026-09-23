import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { usePendingSyncCount } from '../../db/hooks';
import type { Profile } from '../../db/types';
import { e1rm, PB_LABEL, workingSets, workoutStats } from '../../lib/calc/training';
import { formatDateLong } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { formatWeight, round, toDisplayWeight } from '../../lib/units';
import { useOnline } from '../../pwa/platform';
import { useSyncState } from '../../sync/manager';
import { createRoutine, discardWorkout, routineExercise } from './actions';
import { setLabel } from './gym/SetTable';
import { useTraining } from './useTraining';
import './workout.css';

/** A finished workout. With `celebrate`, it's the summary shown right after Finish. */
export function SessionPage({ profile, celebrate = false }: { profile: Profile; celebrate?: boolean }) {
  const { id } = useParams();
  const t = useTraining();
  const navigate = useNavigate();
  const toast = useToast();
  const sync = useSyncState();
  const pending = usePendingSyncCount() ?? 0;
  const online = useOnline();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const u = profile.weightUnit;

  if (!t) return <main className="page" />;
  const w = t.finished.find((x) => x.id === id);
  if (!w) {
    return (
      <main className="page">
        <SubHeader title="Workout" back="/workout" />
        <p className="muted">Workout not found.</p>
      </main>
    );
  }
  const s = workoutStats(w);
  const pbs = t.pbs.filter((p) => p.workoutId === w.id);
  const fmtW = (kg: number) => formatWeight(kg, u);
  const shortW = (kg: number) => String(round(toDisplayWeight(kg, u), 2));

  const syncLine =
    sync.status === 'local-only'
      ? 'Saved on this phone ✓'
      : !sync.user
        ? 'Saved on this phone ✓ · sign in to back it up'
        : pending > 0
          ? online
            ? 'Saved on this phone ✓ · syncing…'
            : 'Saved on this phone ✓ · will sync when you’re back online'
          : 'Saved ✓ · synced to the cloud ✓';

  return (
    <main className="page">
      {celebrate ? (
        <section className="card hero celebrate">
          <div className="celebrate-emoji">{pbs.length ? '🏆' : '💪'}</div>
          <h1>Workout complete</h1>
          <p className="muted">
            {w.name} · {formatDateLong(w.date)}
          </p>
          <p className="sync-line">{syncLine}</p>
        </section>
      ) : (
        <SubHeader title={w.name} back="/workout/history" />
      )}

      {!celebrate && <p className="muted" style={{ marginTop: -8 }}>{formatDateLong(w.date)}</p>}

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Time</div>
          <div className="value">{s.durationMin} min</div>
        </div>
        <div className="stat">
          <div className="label">Sets</div>
          <div className="value">{s.sets}</div>
        </div>
        <div className="stat">
          <div className="label">Reps</div>
          <div className="value">{formatInt(s.reps)}</div>
        </div>
        <div className="stat">
          <div className="label">Volume</div>
          <div className="value">{formatWeight(s.volumeKg, u, { decimals: 0 })}</div>
        </div>
      </div>

      {pbs.length > 0 && (
        <section className="card pb-card">
          <div className="card-head" style={{ '--tone': 'var(--pb)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="trophy" />
            </span>
            <h2>
              {pbs.length} new PB{pbs.length === 1 ? '' : 's'}
            </h2>
          </div>
          {pbs.map((p, k) => (
            <div key={k} className="pb-row">
              <div className="grow">
                <div className="title">{t.exMap.get(p.exerciseId)?.name}</div>
                <div className="desc">{PB_LABEL[p.kind]}</div>
              </div>
              <div className="pb-values">
                <b className="num">
                  {p.kind === 'volume' ? formatWeight(p.value, u, { decimals: 0 }) : p.kind === 'e1rm' ? `${fmtW(p.value)} e1RM` : `${fmtW(p.weightKg)} × ${p.reps}`}
                </b>
                <span className="faint num">
                  was{' '}
                  {p.kind === 'volume'
                    ? formatWeight(p.previous.value, u, { decimals: 0 })
                    : p.kind === 'e1rm'
                      ? fmtW(p.previous.value)
                      : `${fmtW(p.previous.weightKg)} × ${p.previous.reps}`}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      <h2 className="section-title">Exercises</h2>
      <div className="list">
        {w.exercises.map((ex) => {
          const exercise = t.exMap.get(ex.exerciseId);
          const work = workingSets(ex);
          const best = work.reduce((a, b) => (e1rm(b.weightKg, b.reps) > e1rm(a.weightKg, a.reps) ? b : a), work[0]);
          return (
            <Link key={ex.id} to={`/workout/exercises/${ex.exerciseId}`} className="list-row session-ex">
              <div className="grow">
                <div className="title">{exercise?.name ?? 'Exercise'}</div>
                <div className="set-chips">
                  {ex.sets.map((st) => (
                    <span key={st.id} className={`set-chip kind-${st.kind}`}>
                      <i>{setLabel(ex, st)}</i>
                      {shortW(st.weightKg)}×{st.reps}
                      {st.rpe !== null && <small>@{st.rpe}</small>}
                    </span>
                  ))}
                </div>
                {ex.notes && <div className="desc wrap">📝 {ex.notes}</div>}
              </div>
              {best && best.weightKg > 0 && (
                <div className="trail col">
                  <span className="num">{fmtW(e1rm(best.weightKg, best.reps))}</span>
                  <small className="faint">e1RM</small>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {w.notes && (
        <section className="card">
          <p>📝 {w.notes}</p>
        </section>
      )}

      {celebrate ? (
        <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/', { replace: true })}>
          Done
        </button>
      ) : null}

      {!w.routineId && w.exercises.length > 0 && (
        <button
          className="btn btn-block"
          onClick={async () => {
            const r = await createRoutine(
              w.name === 'Workout' ? `Routine ${t.routines.length + 1}` : w.name,
              w.exercises.map((ex) =>
                routineExercise(ex.exerciseId, {
                  sets: Math.max(1, ex.sets.filter((x) => x.kind === 'normal').length),
                  repMin: ex.repMin,
                  repMax: ex.repMax,
                  restSec: ex.restSec,
                  supersetGroup: ex.supersetGroup,
                }),
              ),
            );
            toast('Saved as a routine');
            navigate(`/workout/routine/${r.id}`);
          }}
        >
          <Icon name="plus" />
          Save as routine
        </button>
      )}

      {confirmDelete ? (
        <div className="btn-row">
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await discardWorkout(w.id);
              toast('Workout deleted');
              navigate('/workout', { replace: true });
            }}
          >
            Delete
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(true)}>
          Delete workout
        </button>
      )}
    </main>
  );
}
