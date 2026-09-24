import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import type { Profile } from '../../../db/types';
import { estimateMinutes, nextRoutine, rotationOverride, suggestNext, workoutStats } from '../../../lib/calc/training';
import { formatWeight } from '../../../lib/units';
import { plural } from '../../../lib/format';
import { startWorkout } from '../../workout/actions';
import { planContext, type Training } from '../../workout/useTraining';
import { WorkoutResetSheet } from './WorkoutResetSheet';

/** "What should I do today?" — resume, next routine with targets, or today's result. */
export function WorkoutCard({ profile, t, today }: { profile: Profile; t: Training; today: string }) {
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);
  const u = profile.weightUnit;
  const next = nextRoutine(t.routines, t.finished, rotationOverride(profile));
  const doneToday = t.finished.filter((w) => w.date === today);

  const head = (
    <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
      <span className="chip-icon">
        <Icon name="dumbbell" />
      </span>
      <h2>Today's workout</h2>
      {(t.active || t.routines.length > 0) && (
        <button className="head-link head-btn" onClick={() => setResetting(true)}>
          <Icon name="undo" width={16} height={16} />
          Reset
        </button>
      )}
      <Link className="head-link" to="/workout">
        Plan
        <Icon name="chevronRight" width={16} height={16} />
      </Link>
      {resetting && <WorkoutResetSheet profile={profile} t={t} next={next} onClose={() => setResetting(false)} />}
    </div>
  );

  if (t.active) {
    const s = workoutStats(t.active);
    return (
      <section className="card hero">
        {head}
        <div>
          <div className="workout-title">{t.active.name}</div>
          <p className="muted">In progress · {plural(s.sets, 'set')} done · {s.durationMin} min</p>
        </div>
        <Link to="/gym" className="btn btn-primary btn-lg btn-block">
          <Icon name="play" />
          Resume workout
        </Link>
      </section>
    );
  }

  if (doneToday.length > 0) {
    const w = doneToday.at(-1)!;
    const s = workoutStats(w);
    const pbs = t.pbs.filter((p) => p.workoutId === w.id).length;
    return (
      <section className="card hero">
        {head}
        <div>
          <div className="workout-title">{w.name} ✓</div>
          <p className="muted">
            Done today · {s.durationMin} min · {plural(s.sets, 'set')}{pbs > 0 && ` · 🏆 ${pbs} PB${pbs === 1 ? '' : 's'}`}
          </p>
          {next && <p className="faint" style={{ fontSize: 14, marginTop: 4 }}>Next time: {next.name}</p>}
        </div>
        <Link to={`/workout/session/${w.id}`} className="btn btn-block">
          View workout
        </Link>
      </section>
    );
  }

  if (!next) {
    return (
      <section className="card hero">
        {head}
        <div>
          <div className="workout-title">Set up your training</div>
          <p className="muted">Pick a ready-made programme (Push/Pull/Legs, Upper/Lower, Full Body) or build your own.</p>
        </div>
        <Link to="/workout" className="btn btn-primary btn-lg btn-block">
          Choose a programme
        </Link>
      </section>
    );
  }

  const ctx = planContext(profile);
  const preview = next.exercises.slice(0, 2).flatMap((re) => {
    const ex = t.exMap.get(re.exerciseId);
    if (!ex) return [];
    const sessions = t.history.get(ex.id) ?? [];
    const last = sessions.at(-1);
    const sug = suggestNext({ sessions, repMin: re.repMin, repMax: re.repMax, incrementKg: ex.incrementKg, unit: u, fmt: ctx.fmt });
    return [{ key: re.key, name: ex.name, last, sug, reps: re.repMin === re.repMax ? `${re.repMin}` : `${re.repMin}–${re.repMax}` }];
  });

  return (
    <section className="card hero workout-card">
      {head}
      <div>
        <div className="workout-title">{next.name}</div>
        <p className="muted">
          {next.exercises.length} exercises · ~{estimateMinutes(next)} min
        </p>
      </div>
      {preview.map((p) => (
        <div key={p.key} className="today-ex">
          <div className="today-ex-name">{p.name}</div>
          <div className="today-ex-grid">
            <div>
              <span className="cmp-label">Last session</span>
              <b className="num">{p.last ? `${formatWeight(p.last.topSet.weightKg, u)} × ${p.last.topSet.reps}` : '—'}</b>
            </div>
            <div>
              <span className="cmp-label">Suggested today</span>
              <b className="num accent">{p.sug.weightKg !== null ? `${formatWeight(p.sug.weightKg, u)} × ${p.reps}` : `${p.reps} reps`}</b>
            </div>
          </div>
        </div>
      ))}
      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={next.exercises.length === 0}
        onClick={async () => {
          await startWorkout({ routine: next, exercises: t.exMap, history: t.history, ctx });
          navigate('/gym');
        }}
      >
        <Icon name="play" />
        Start workout
      </button>
    </section>
  );
}
