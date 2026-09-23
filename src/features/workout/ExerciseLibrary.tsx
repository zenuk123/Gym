import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { LineChart } from '../../components/LineChart';
import { NumberField } from '../../components/NumberField';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { remove, update } from '../../db/repo';
import type { MuscleGroup, Profile } from '../../db/types';
import { e1rm, PB_LABEL } from '../../lib/calc/training';
import { daysBetween, relativeDay } from '../../lib/dates';
import { formatWeight, parseDecimal, round, toDisplayWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { CreateExerciseSheet } from './ExercisePicker';
import { EQUIPMENT_LABEL, MUSCLE_LABEL, useTraining } from './useTraining';
import './workout.css';

export function ExerciseLibrary({ profile }: { profile: Profile }) {
  const t = useTraining();
  const navigate = useNavigate();
  const today = useToday();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    if (!t) return [];
    const needle = q.trim().toLowerCase();
    return t.exercises
      .filter((e) => !e.archived && (!muscle || e.muscle === muscle) && (!needle || e.name.toLowerCase().includes(needle)))
      .map((e) => ({ e, last: t.history.get(e.id)?.at(-1) ?? null }))
      // Exercises you actually do float to the top.
      .sort((a, b) => (b.last?.startedAt ?? 0) - (a.last?.startedAt ?? 0) || a.e.name.localeCompare(b.e.name));
  }, [t, q, muscle]);

  if (!t) return <main className="page" />;

  return (
    <main className="page">
      <SubHeader title="Exercise library" back="/workout" />
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} />
      </div>
      <div className="chip-scroll">
        <button className="chip" aria-pressed={muscle === null} onClick={() => setMuscle(null)}>
          All
        </button>
        {(Object.keys(MUSCLE_LABEL) as MuscleGroup[]).map((m) => (
          <button key={m} className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(muscle === m ? null : m)}>
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="list">
        {list.map(({ e, last }) => (
          <Link key={e.id} to={`/workout/exercises/${e.id}`} className="list-row">
            <div className="grow">
              <div className="title">{e.name}</div>
              <div className="desc">
                {MUSCLE_LABEL[e.muscle]} · {EQUIPMENT_LABEL[e.equipment]}
                {last && ` · ${relativeDay(last.date, today)}: ${formatWeight(last.topSet.weightKg, profile.weightUnit)} × ${last.topSet.reps}`}
              </div>
            </div>
            <span className="trail">
              <Icon name="chevronRight" />
            </span>
          </Link>
        ))}
        {list.length === 0 && <p className="empty">No exercises match.</p>}
      </div>
      <button className="btn btn-block" onClick={() => setCreating(true)}>
        <Icon name="plus" />
        New exercise
      </button>
      {creating && (
        <CreateExerciseSheet
          initialName={q}
          onClose={() => setCreating(false)}
          onCreated={(e) => {
            setCreating(false);
            navigate(`/workout/exercises/${e.id}`);
          }}
        />
      )}
    </main>
  );
}

export function ExerciseDetail({ profile }: { profile: Profile }) {
  const { id } = useParams();
  const t = useTraining();
  const today = useToday();
  const toast = useToast();
  const navigate = useNavigate();
  const [inc, setInc] = useState<string | null>(null);
  const u = profile.weightUnit;

  if (!t) return <main className="page" />;
  const ex = id ? t.exMap.get(id) : undefined;
  if (!ex) {
    return (
      <main className="page">
        <SubHeader title="Exercise" back="/workout/exercises" />
        <p className="muted">Exercise not found.</p>
      </main>
    );
  }
  const sessions = t.history.get(ex.id) ?? [];
  const pbs = t.pbs.filter((p) => p.exerciseId === ex.id);
  const heaviest = sessions.reduce<(typeof sessions)[number]['topSet'] | null>(
    (a, s) => (!a || s.topSet.weightKg > a.weightKg || (s.topSet.weightKg === a.weightKg && s.topSet.reps > a.reps) ? s.topSet : a),
    null,
  );
  const bestE1rm = Math.max(0, ...sessions.map((s) => s.bestE1rm));
  const series = sessions.map((s) => ({ x: daysBetween(today, s.date), y: ex.bodyweight ? s.topSet.reps : toDisplayWeight(s.bestE1rm, u) }));
  const incNum = inc === null ? null : parseDecimal(inc);

  return (
    <main className="page">
      <SubHeader title={ex.name} back="/workout/exercises" />
      <p className="muted" style={{ marginTop: -8 }}>
        {MUSCLE_LABEL[ex.muscle]} · {EQUIPMENT_LABEL[ex.equipment]}
        {ex.builtIn ? '' : ' · custom'}
      </p>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{sessions.length}</div>
        </div>
        <div className="stat">
          <div className="label">Heaviest</div>
          <div className="value">{heaviest ? `${formatWeight(heaviest.weightKg, u)} × ${heaviest.reps}` : '—'}</div>
        </div>
        {!ex.bodyweight && (
          <div className="stat">
            <div className="label">Best e1RM</div>
            <div className="value">{bestE1rm ? formatWeight(bestE1rm, u) : '—'}</div>
          </div>
        )}
      </div>

      {series.length >= 2 && (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="trendUp" />
            </span>
            <h2>{ex.bodyweight ? 'Top set reps' : 'Estimated 1RM'}</h2>
          </div>
          <LineChart
            raw={[]}
            trend={series}
            tone="var(--accent-text)"
            height={170}
            label={`${ex.name} strength trend`}
            formatY={(v) => String(Math.round(v))}
          />
          {sessions.length >= 2 && !ex.bodyweight && (
            <p className="faint" style={{ fontSize: 13 }}>
              {(() => {
                const first = sessions[0].bestE1rm;
                const lastV = sessions.at(-1)!.bestE1rm;
                const pct = first > 0 ? Math.round(((lastV - first) / first) * 100) : 0;
                return `Calculated: ${pct >= 0 ? '+' : ''}${pct}% since your first logged session (${formatWeight(first, u)} → ${formatWeight(lastV, u)}).`;
              })()}
            </p>
          )}
        </section>
      )}

      {pbs.length > 0 && (
        <>
          <h2 className="section-title">Personal bests</h2>
          <div className="list">
            {pbs.slice(0, 8).map((p, k) => (
              <Link key={k} to={`/workout/session/${p.workoutId}`} className="list-row">
                <span className="lead" style={{ '--tone': 'var(--pb)' } as React.CSSProperties}>
                  <Icon name="trophy" />
                </span>
                <div className="grow">
                  <div className="title">
                    {p.kind === 'volume'
                      ? formatWeight(p.value, u, { decimals: 0 })
                      : p.kind === 'e1rm'
                        ? `${formatWeight(p.value, u)} e1RM`
                        : `${formatWeight(p.weightKg, u)} × ${p.reps}`}
                  </div>
                  <div className="desc">
                    {PB_LABEL[p.kind]} · {relativeDay(p.date, today)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">History</h2>
      {sessions.length === 0 ? (
        <EmptyState icon="history">No sets logged yet.</EmptyState>
      ) : (
        <div className="list">
          {[...sessions]
            .reverse()
            .slice(0, 20)
            .map((s) => (
              <Link key={s.workoutId} to={`/workout/session/${s.workoutId}`} className="list-row">
                <div className="grow">
                  <div className="title">{relativeDay(s.date, today)}</div>
                  <div className="set-chips">
                    {s.sets.map((st) => (
                      <span key={st.id} className={`set-chip kind-${st.kind}`}>
                        {round(toDisplayWeight(st.weightKg, u), 2)}×{st.reps}
                      </span>
                    ))}
                  </div>
                </div>
                {!ex.bodyweight && (
                  <div className="trail col">
                    <span className="num">{formatWeight(Math.max(...s.sets.map((x) => e1rm(x.weightKg, x.reps))), u)}</span>
                    <small className="faint">e1RM</small>
                  </div>
                )}
              </Link>
            ))}
        </div>
      )}

      <h2 className="section-title">Settings</h2>
      <NumberField
        label="Weight jump for suggestions"
        suffix="kg"
        value={inc ?? String(ex.incrementKg)}
        onChange={setInc}
        hint="The app suggests adding this much once you hit the top of your rep range."
      />
      {inc !== null && incNum !== null && incNum > 0 && incNum !== ex.incrementKg && (
        <button
          className="btn btn-primary btn-block"
          onClick={async () => {
            await update('exercises', ex.id, { incrementKg: incNum });
            setInc(null);
            toast('Saved');
          }}
        >
          Save
        </button>
      )}
      {sessions.length === 0 && !ex.builtIn ? (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await remove('exercises', ex.id);
            toast(`Deleted ${ex.name}`);
            navigate('/workout/exercises');
          }}
        >
          Delete exercise
        </button>
      ) : (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await update('exercises', ex.id, { archived: !ex.archived });
            toast(ex.archived ? 'Back in the library' : 'Hidden from the library (history kept)');
          }}
        >
          {ex.archived ? 'Show in library' : 'Hide from library'}
        </button>
      )}
    </main>
  );
}
