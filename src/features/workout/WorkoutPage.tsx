import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { TEMPLATES } from '../../db/seed/templates';
import type { Profile, Routine } from '../../db/types';
import { estimateMinutes, nextRoutine, workoutStats } from '../../lib/calc/training';
import { relativeDay } from '../../lib/dates';
import { formatWeight } from '../../lib/units';
import { plural } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { createFromTemplate, createRoutine, startWorkout } from './actions';
import { planContext, useTraining, type Training } from './useTraining';
import './workout.css';

export function WorkoutPage({ profile }: { profile: Profile }) {
  const t = useTraining();
  const navigate = useNavigate();
  const today = useToday();
  const toast = useToast();
  const [picking, setPicking] = useState(false);

  if (!t) return <main className="page" />;
  const next = nextRoutine(t.routines, t.finished);
  const recent = [...t.finished].reverse().slice(0, 5);

  async function start(routine: Routine | null) {
    await startWorkout({ routine, exercises: t!.exMap, history: t!.history, ctx: planContext(profile) });
    navigate('/gym');
  }

  async function newRoutine() {
    const r = await createRoutine(`Workout ${String.fromCharCode(65 + (t!.routines.length % 26))}`);
    navigate(`/workout/routine/${r.id}`);
  }

  return (
    <main className="page">
      <PageHeader title="Workout" eyebrow={`${profile.workoutsPerWeek} sessions / week`} />

      {t.active ? (
        <section className="card hero">
          <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="timer" />
            </span>
            <h2>In progress</h2>
          </div>
          <div className="workout-title">{t.active.name}</div>
          <p className="muted">
            Started {new Date(t.active.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {plural(workoutStats(t.active).sets, 'set')} done
          </p>
          <Link to="/gym" className="btn btn-primary btn-lg btn-block">
            <Icon name="play" />
            Resume workout
          </Link>
        </section>
      ) : next ? (
        <NextUp t={t} routine={next} onStart={() => void start(next)} onOther={() => setPicking(true)} />
      ) : (
        <Templates
          onPick={async (tpl) => {
            await createFromTemplate(tpl);
            toast(`${tpl.name} added — edit any routine to make it yours`);
          }}
          onCustom={() => void newRoutine()}
        />
      )}

      {t.routines.length > 0 && (
        <>
          <h2 className="section-title section-row">
            <span>Routines</span>
            <button className="link-btn" onClick={() => void newRoutine()}>
              <Icon name="plus" width={16} height={16} /> New
            </button>
          </h2>
          <div className="list">
            {t.routines.map((r) => (
              <div key={r.id} className="list-row">
                <Link to={`/workout/routine/${r.id}`} className="grow">
                  <div className="title">
                    {r.name} {next?.id === r.id && !t.active && <span className="pill good">Next</span>}
                  </div>
                  <div className="desc">
                    {r.exercises.length} exercises · ~{estimateMinutes(r)} min ·{' '}
                    {r.exercises
                      .slice(0, 3)
                      .map((e) => t.exMap.get(e.exerciseId)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </Link>
                {!t.active && (
                  <button className="icon-btn play-btn" onClick={() => void start(r)} aria-label={`Start ${r.name}`}>
                    <Icon name="play" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="list">
        {!t.active && (
          <button className="list-row" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties} onClick={() => void start(null)}>
            <span className="lead">
              <Icon name="plus" />
            </span>
            <div className="grow">
              <div className="title">Empty workout</div>
              <div className="desc">Add exercises as you go</div>
            </div>
          </button>
        )}
        <Link to="/workout/exercises" className="list-row" style={{ '--tone': 'var(--protein)' } as React.CSSProperties}>
          <span className="lead">
            <Icon name="dumbbell" />
          </span>
          <div className="grow">
            <div className="title">Exercise library</div>
            <div className="desc">{t.exercises.filter((e) => !e.archived).length} exercises · history & PBs</div>
          </div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </Link>
        <Link to="/workout/history" className="list-row" style={{ '--tone': 'var(--weight)' } as React.CSSProperties}>
          <span className="lead">
            <Icon name="history" />
          </span>
          <div className="grow">
            <div className="title">Workout history</div>
            <div className="desc">{t.finished.length} workouts logged</div>
          </div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </Link>
      </div>

      {recent.length > 0 && (
        <>
          <h2 className="section-title">Recent</h2>
          <div className="list">
            {recent.map((w) => {
              const s = workoutStats(w);
              const pbCount = t.pbs.filter((p) => p.workoutId === w.id).length;
              return (
                <Link key={w.id} to={`/workout/session/${w.id}`} className="list-row">
                  <div className="grow">
                    <div className="title">
                      {w.name} {pbCount > 0 && <span className="pill pb-pill">🏆 {pbCount}</span>}
                    </div>
                    <div className="desc">
                      {relativeDay(w.date, today)} · {s.durationMin} min · {plural(s.sets, 'set')} · {formatWeight(s.volumeKg, profile.weightUnit, { decimals: 0 })}
                    </div>
                  </div>
                  <span className="trail">
                    <Icon name="chevronRight" />
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {picking && (
        <Sheet title="Choose a workout" onClose={() => setPicking(false)}>
          <div className="list">
            {t.routines.map((r) => (
              <button key={r.id} className="list-row" onClick={() => void start(r)}>
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="desc">
                    {r.exercises.length} exercises · ~{estimateMinutes(r)} min
                  </div>
                </div>
                <span className="trail">
                  <Icon name="play" />
                </span>
              </button>
            ))}
            <button className="list-row" onClick={() => void start(null)}>
              <div className="grow">
                <div className="title">Empty workout</div>
              </div>
              <span className="trail">
                <Icon name="plus" />
              </span>
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function NextUp({ t, routine, onStart, onOther }: { t: Training; routine: Routine; onStart: () => void; onOther: () => void }) {
  return (
    <section className="card hero">
      <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
        <span className="chip-icon">
          <Icon name="dumbbell" />
        </span>
        <h2>Next up</h2>
      </div>
      <div>
        <div className="workout-title">{routine.name}</div>
        <p className="muted">
          {routine.exercises.length} exercises · ~{estimateMinutes(routine)} min
        </p>
      </div>
      <ol className="mini-list">
        {routine.exercises.map((e) => (
          <li key={e.key}>
            <span>{t.exMap.get(e.exerciseId)?.name ?? 'Unknown'}</span>
            <span className="faint num">
              {e.sets} × {e.repMin === e.repMax ? e.repMin : `${e.repMin}–${e.repMax}`}
            </span>
          </li>
        ))}
      </ol>
      <button className="btn btn-primary btn-lg btn-block" onClick={onStart} disabled={routine.exercises.length === 0}>
        <Icon name="play" />
        Start workout
      </button>
      {t.routines.length > 1 && (
        <button className="btn btn-ghost btn-block" onClick={onOther}>
          Do a different workout
        </button>
      )}
    </section>
  );
}

function Templates({ onPick, onCustom }: { onPick: (t: (typeof TEMPLATES)[number]) => void; onCustom: () => void }) {
  return (
    <>
      <section className="card hero">
        <EmptyState icon="dumbbell">
          <b className="empty-title">Pick a programme to start</b>
          Every routine is fully editable afterwards. Today will then tell you which workout is next.
        </EmptyState>
      </section>
      <div className="list">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.id} className="list-row" onClick={() => onPick(tpl)} style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
            <span className="lead">
              <Icon name="calendar" />
            </span>
            <div className="grow">
              <div className="title">
                {tpl.name} <span className="faint" style={{ fontWeight: 500, fontSize: 14 }}>· {tpl.daysPerWeek}</span>
              </div>
              <div className="desc wrap">{tpl.description}</div>
              <div className="desc">{tpl.routines.map((r) => r.name).join(' · ')}</div>
            </div>
            <span className="trail">
              <Icon name="plus" />
            </span>
          </button>
        ))}
        <button className="list-row" onClick={onCustom} style={{ '--tone': 'var(--text-2)' } as React.CSSProperties}>
          <span className="lead">
            <Icon name="edit" />
          </span>
          <div className="grow">
            <div className="title">Build my own</div>
            <div className="desc">Start from a blank routine</div>
          </div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </button>
      </div>
      <p className="faint" style={{ fontSize: 13, padding: '0 4px' }}>
        Formatted as sets × rep range. When you hit the top of the range on every set, the app suggests adding weight next time.
      </p>
    </>
  );
}
