import { Icon } from '../../../components/Icon';
import type { WeightUnit, WorkoutExercise, WorkoutSet } from '../../../db/types';
import type { ExerciseSession } from '../../../lib/calc/training';
import { round, toDisplayWeight } from '../../../lib/units';

const w = (kg: number, unit: WeightUnit) => round(toDisplayWeight(kg, unit), 2).toLocaleString('en-GB', { maximumFractionDigits: 2 });

export function setLabel(ex: WorkoutExercise, s: WorkoutSet): string {
  if (s.kind === 'warmup') return 'W';
  if (s.kind === 'drop') return 'D';
  if (s.kind === 'failure') return 'F';
  return String(ex.sets.filter((x) => x.kind === 'normal').indexOf(s) + 1);
}

/** Classic set table: set · last time · weight · reps · ✓. Tap a row to edit it with the big controls. */
export function SetTable({
  ex,
  last,
  unit,
  focusId,
  onFocus,
  onCheck,
}: {
  ex: WorkoutExercise;
  last: ExerciseSession | null;
  unit: WeightUnit;
  focusId: string | null;
  onFocus: (id: string) => void;
  onCheck: (s: WorkoutSet) => void;
}) {
  const prevWorking = last?.sets ?? [];
  let workingIdx = -1;
  return (
    <div className="set-table" role="table" aria-label="Sets">
      <div className="set-row head" role="row">
        <span role="columnheader">Set</span>
        <span role="columnheader">Prev</span>
        <span role="columnheader">{unit}</span>
        <span role="columnheader">Reps</span>
        <span role="columnheader" className="sr-only">
          Done
        </span>
      </div>
      {ex.sets.map((s) => {
        if (s.kind !== 'warmup') workingIdx++;
        const prev = s.kind !== 'warmup' ? prevWorking[workingIdx] : undefined;
        const label = setLabel(ex, s);
        return (
          <div
            key={s.id}
            role="row"
            className={`set-row${s.done ? ' done' : ''}${s.id === focusId ? ' focus' : ''} kind-${s.kind}`}
            onClick={() => onFocus(s.id)}
          >
            <span className="set-label">{label}</span>
            <span className="set-prev">{prev ? `${w(prev.weightKg, unit)} × ${prev.reps}` : '—'}</span>
            <span className="set-val num">{w(s.weightKg, unit)}</span>
            <span className="set-val num">
              {s.reps}
              {s.rpe !== null && <small className="rpe-tag">@{s.rpe}</small>}
            </span>
            <button
              className={`set-check${s.done ? ' on' : ''}`}
              aria-label={s.done ? `Undo set ${label}` : `Complete set ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onCheck(s);
              }}
            >
              <Icon name="check" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
