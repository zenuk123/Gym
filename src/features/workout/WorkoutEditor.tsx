import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import type { Profile, SetKind, Workout, WorkoutExercise, WorkoutSet } from '../../db/types';
import { workoutStats } from '../../lib/calc/training';
import { isLoggableDate, todayISO } from '../../lib/dates';
import { useCommitOnLeave } from '../../lib/useCommitOnLeave';
import { fromDisplayWeight, parseDecimal, round, toDisplayWeight } from '../../lib/units';
import * as A from './actions';
import { ExercisePicker } from './ExercisePicker';
import { setLabel } from './gym/SetTable';
import { planContext, useTraining } from './useTraining';
import './workout.css';

const NEXT_KIND: Record<SetKind, SetKind> = { normal: 'warmup', warmup: 'drop', drop: 'failure', failure: 'normal' };

/**
 * Fix or fill in a finished workout: weights and reps, sets, exercises, name, date, length and
 * notes. Also used for workouts logged after the fact. Every change saves as you go.
 */
export function WorkoutEditor({ profile }: { profile: Profile }) {
  const { id } = useParams();
  const t = useTraining();
  const navigate = useNavigate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const w = t?.finished.find((x) => x.id === id);
  const saveName = useCommitOnLeave((v: string) => id && v.trim() && void A.editWorkoutDetails(id, { name: v }));
  const saveMinutes = useCommitOnLeave((v: string) => {
    const n = parseDecimal(v);
    if (id && n !== null && n >= 1 && n <= 24 * 60) void A.editWorkoutDetails(id, { minutes: n });
  });
  const saveNotes = useCommitOnLeave((v: string) => id && void A.editWorkoutDetails(id, { notes: v }));

  if (!t) return <main className="page" />;
  if (!w) {
    return (
      <main className="page">
        <SubHeader title="Edit workout" back="/workout/history" />
        <p className="muted">Workout not found.</p>
      </main>
    );
  }
  const unit = profile.weightUnit;
  const minutes = workoutStats(w).durationMin;

  return (
    <main className="page">
      <SubHeader title="Edit workout" back={`/workout/session/${w.id}`} />
      <p className="faint" style={{ fontSize: 13, marginTop: -6 }}>
        Changes save as you go. PBs and progress update automatically.
      </p>

      <div className="field">
        <label htmlFor="wk-name">Name</label>
        <div className="input-wrap">
          <input id="wk-name" defaultValue={w.name} onChange={(e) => saveName(e.target.value)} enterKeyHint="done" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="wk-date">Date</label>
          <div className="input-wrap">
            <input
              id="wk-date"
              type="date"
              value={w.date}
              max={todayISO()}
              onChange={(e) => isLoggableDate(e.target.value) && void A.editWorkoutDetails(w.id, { date: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="wk-min">Length</label>
          <div className="input-wrap">
            <input id="wk-min" inputMode="numeric" defaultValue={minutes ?? ''} onChange={(e) => saveMinutes(e.target.value.replace(/\D/g, ''))} />
            <span className="suffix">min</span>
          </div>
        </div>
      </div>

      {w.exercises.map((ex, i) => (
        <ExerciseBlock key={ex.id} w={w} ex={ex} index={i} name={t.exMap.get(ex.exerciseId)?.name ?? 'Exercise'} incrementKg={t.exMap.get(ex.exerciseId)?.incrementKg ?? 2.5} unit={unit} />
      ))}
      {w.exercises.length === 0 && <p className="muted">No exercises yet — add what you did.</p>}

      <button className="btn btn-block" onClick={() => setAdding(true)}>
        <Icon name="plus" /> Add exercise
      </button>

      <div className="field">
        <label htmlFor="wk-notes">Notes</label>
        <textarea id="wk-notes" className="textarea" rows={3} defaultValue={w.notes ?? ''} onChange={(e) => saveNotes(e.target.value)} placeholder="How did it go?" />
      </div>

      <button
        className="btn btn-primary btn-lg btn-block"
        onClick={() => {
          toast('Workout saved');
          navigate(`/workout/session/${w.id}`);
        }}
      >
        <Icon name="check" /> Done
      </button>

      {adding && (
        <ExercisePicker
          exercises={t.exercises}
          onClose={() => setAdding(false)}
          onPick={async (exercise) => {
            setAdding(false);
            await A.addDoneExercise(w.id, exercise, t.history, planContext(profile));
          }}
        />
      )}
    </main>
  );
}

function ExerciseBlock({ w, ex, index, name, incrementKg, unit }: { w: Workout; ex: WorkoutExercise; index: number; name: string; incrementKg: number; unit: Profile['weightUnit'] }) {
  return (
    <section className="card edit-ex">
      <div className="edit-ex-head">
        <b className="grow">{name}</b>
        <button className="icon-btn" disabled={index === 0} onClick={() => void A.moveExerciseInWorkout(w.id, ex.id, -1)} aria-label={`Move ${name} up`}>
          <Icon name="arrowUp" />
        </button>
        <button className="icon-btn" disabled={index === w.exercises.length - 1} onClick={() => void A.moveExerciseInWorkout(w.id, ex.id, 1)} aria-label={`Move ${name} down`}>
          <Icon name="arrowDown" />
        </button>
        <button className="icon-btn" onClick={() => void A.removeExerciseFromWorkout(w.id, ex.id)} aria-label={`Remove ${name}`}>
          <Icon name="trash" color="var(--text-3)" />
        </button>
      </div>
      <div className="edit-sets">
        <div className="edit-set head">
          <span>Set</span>
          <span>{unit}</span>
          <span>Reps</span>
          <span />
        </div>
        {ex.sets.map((s) => (
          <SetRow key={s.id} w={w} ex={ex} s={s} unit={unit} name={name} />
        ))}
      </div>
      <button className="btn btn-ghost btn-block" onClick={() => void A.addDoneSet(w.id, ex.id, { incrementKg, unit })}>
        <Icon name="plus" /> Add set
      </button>
    </section>
  );
}

function SetRow({ w, ex, s, unit, name }: { w: Workout; ex: WorkoutExercise; s: WorkoutSet; unit: Profile['weightUnit']; name: string }) {
  const label = setLabel(ex, s);
  const saveWeight = useCommitOnLeave((v: string) => {
    const n = parseDecimal(v);
    if (n !== null && n >= 0 && n < 1000) void A.setField(w.id, ex.id, s.id, { weightKg: fromDisplayWeight(n, unit) });
  });
  const saveReps = useCommitOnLeave((v: string) => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 0 && n < 1000) void A.setField(w.id, ex.id, s.id, { reps: n });
  }, 300);
  return (
    <div className="edit-set">
      <button className={`set-kind kind-${s.kind}`} onClick={() => void A.setField(w.id, ex.id, s.id, { kind: NEXT_KIND[s.kind] })} aria-label={`Set ${label}: ${s.kind}. Tap to change type`}>
        {label}
      </button>
      <div className="input-wrap">
        <input inputMode="decimal" defaultValue={round(toDisplayWeight(s.weightKg, unit), 2)} aria-label={`${name} set ${label} weight`} onFocus={(e) => e.target.select()} onChange={(e) => saveWeight(e.target.value.replace(/[^0-9.,]/g, ''))} />
      </div>
      <div className="input-wrap">
        <input inputMode="numeric" defaultValue={s.reps} aria-label={`${name} set ${label} reps`} onFocus={(e) => e.target.select()} onChange={(e) => saveReps(e.target.value.replace(/\D/g, ''))} />
      </div>
      <button className="icon-btn" onClick={() => void A.removeSet(w.id, ex.id, s.id)} aria-label={`Remove set ${label}`}>
        <Icon name="x" width={18} height={18} color="var(--text-3)" />
      </button>
    </div>
  );
}
