import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import type { Exercise, WeightUnit, Workout, WorkoutExercise, WorkoutSet } from '../../../db/types';
import { stepWeight } from '../../../lib/calc/training';
import { fromDisplayWeight, parseDecimal, round, toDisplayWeight } from '../../../lib/units';
import { haptic } from '../../../pwa/platform';
import * as A from '../actions';
import { adjustRest, stopRest, useRest, useRestAlarm } from './restTimer';
import { setLabel } from './SetTable';

const RPES = [6, 7, 8, 9, 10];

/** Sticky bottom panel: rest timer + big weight/reps controls + Complete. Reachable with one thumb. */
export function FocusPanel({
  workout,
  ex,
  exercise,
  set,
  unit,
  allDone,
  nextName,
  onGoTo,
  onComplete,
  onAdd,
  onFinish,
}: {
  workout: Workout;
  ex: WorkoutExercise | undefined;
  exercise: Exercise | undefined;
  set: WorkoutSet | undefined;
  unit: WeightUnit;
  allDone: boolean;
  nextName: { index: number; name: string } | null;
  onGoTo: (i: number) => void;
  onComplete: () => void;
  onAdd: () => void;
  onFinish: () => void;
}) {
  const rest = useRest();
  useRestAlarm(rest);

  return (
    <div className="focus-panel">
      {rest && <RestBar left={rest.left} total={rest.total} />}

      {allDone ? (
        <div className="panel-msg">
          <div className="panel-title">All sets done 🎉</div>
          <button className="btn btn-primary btn-lg btn-block" onClick={onFinish}>
            <Icon name="flag" />
            Finish workout
          </button>
          <button className="btn btn-ghost btn-block" onClick={onAdd}>
            Add another exercise
          </button>
        </div>
      ) : !ex || !exercise ? (
        <button className="btn btn-primary btn-lg btn-block" onClick={onAdd}>
          <Icon name="plus" />
          Add exercise
        </button>
      ) : !set ? (
        <div className="panel-msg">
          <div className="panel-title">{exercise.name} done ✓</div>
          {nextName ? (
            <button className="btn btn-primary btn-lg btn-block" onClick={() => onGoTo(nextName.index)}>
              Next: {nextName.name}
              <Icon name="chevronRight" />
            </button>
          ) : (
            <button className="btn btn-primary btn-lg btn-block" onClick={onFinish}>
              Finish workout
            </button>
          )}
        </div>
      ) : (
        <SetControls workout={workout} ex={ex} exercise={exercise} set={set} unit={unit} onComplete={onComplete} />
      )}
    </div>
  );
}

function SetControls({
  workout,
  ex,
  exercise,
  set,
  unit,
  onComplete,
}: {
  workout: Workout;
  ex: WorkoutExercise;
  exercise: Exercise;
  set: WorkoutSet;
  unit: WeightUnit;
  onComplete: () => void;
}) {
  const save = (patch: Partial<WorkoutSet>) => void A.setField(workout.id, ex.id, set.id, patch);
  const display = round(toDisplayWeight(set.weightKg, unit), 2);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [set.id]);

  /** The typed weight in kg, or null if nothing (valid) is being typed. */
  const draftKg = () => {
    const n = draft === null ? null : parseDecimal(draft);
    return n !== null && n >= 0 && n < 1000 ? fromDisplayWeight(n, unit) : null;
  };
  const commitWeight = () => {
    const kg = draftKg();
    if (kg !== null) save({ weightKg: kg });
    setDraft(null);
  };
  // Steppers work from the value in the database, not from this render: a tap right after typing
  // (whose save is still in flight) or two quick taps would otherwise use a stale weight. iOS also
  // doesn't always blur the field when a button is tapped, so what's typed is used directly.
  const stepW = (n: 1 | -1) => {
    haptic(5);
    const typed = draftKg();
    setDraft(null);
    void A.editSet(workout.id, ex.id, set.id, (s) => ({ weightKg: stepWeight(typed ?? s.weightKg, n, exercise.incrementKg, unit) }));
  };
  const complete = () => {
    commitWeight();
    onComplete();
  };
  const stepR = (n: 1 | -1) => {
    haptic(5);
    void A.editSet(workout.id, ex.id, set.id, (s) => ({ reps: Math.max(0, s.reps + n) }));
  };
  const normals = ex.sets.filter((s) => s.kind === 'normal').length;
  const label = setLabel(ex, set);
  const title =
    set.kind === 'warmup' ? 'Warm-up set' : set.kind === 'drop' ? 'Drop set' : set.kind === 'failure' ? 'Failure set' : `Set ${label} of ${normals}`;

  return (
    <>
      <div className="panel-caption">
        <span>{title}</span>
        {set.done && <span className="pill good">Editing a done set</span>}
      </div>
      <div className="big-steppers">
        <div className="big-stepper">
          <button onClick={() => stepW(-1)} aria-label="Less weight">
            <Icon name="minus" />
          </button>
          <label className="big-value">
            <input
              inputMode="decimal"
              enterKeyHint="done"
              aria-label={`Weight in ${unit}`}
              value={draft ?? String(display)}
              onFocus={(e) => {
                setDraft(String(display));
                e.target.select();
              }}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
              onBlur={commitWeight}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <small>{unit}</small>
          </label>
          <button onClick={() => stepW(1)} aria-label="More weight">
            <Icon name="plus" />
          </button>
        </div>
        <div className="big-stepper">
          <button onClick={() => stepR(-1)} aria-label="Fewer reps">
            <Icon name="minus" />
          </button>
          <label className="big-value">
            <input
              inputMode="numeric"
              enterKeyHint="done"
              aria-label="Reps"
              value={String(set.reps)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
                if (n < 1000) save({ reps: n });
              }}
            />
            <small>reps</small>
          </label>
          <button onClick={() => stepR(1)} aria-label="More reps">
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {set.kind !== 'warmup' && (
        <div className="rpe-row" role="group" aria-label="RPE (optional)">
          <span>RPE</span>
          {RPES.map((r) => (
            <button key={r} className="chip" aria-pressed={set.rpe === r} onClick={() => save({ rpe: set.rpe === r ? null : r })}>
              {r}
            </button>
          ))}
        </div>
      )}
      <button className="btn btn-primary btn-lg btn-block complete-btn" onClick={complete} disabled={!set.done && set.reps <= 0}>
        <Icon name="check" />
        {set.done ? 'Done editing' : 'Complete set'}
      </button>
    </>
  );
}

function RestBar({ left, total }: { left: number; total: number }) {
  const over = left <= 0;
  const shown = Math.abs(left);
  const text = `${over ? '+' : ''}${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
  return (
    <div className={`rest-bar${over ? ' over' : ''}`} role="timer" aria-live="off">
      <div className="rest-fill" style={{ width: `${over ? 100 : Math.min(100, ((total - left) / total) * 100)}%` }} />
      <div className="rest-content">
        <span className="rest-label">{over ? 'Rest over — go!' : 'Rest'}</span>
        <span className="rest-time num">{text}</span>
        <button className="chip" onClick={() => adjustRest(-15)}>
          −15
        </button>
        <button className="chip" onClick={() => adjustRest(15)}>
          +15
        </button>
        <button className="chip" onClick={stopRest}>
          {over ? 'Close' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
