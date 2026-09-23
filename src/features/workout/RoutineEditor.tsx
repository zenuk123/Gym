import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useRoutine } from '../../db/hooks';
import type { Profile, RoutineExercise } from '../../db/types';
import { estimateMinutes } from '../../lib/calc/training';
import { newId } from '../../lib/id';
import { deleteRoutine, routineExercise, saveRoutine, startWorkout } from './actions';
import { ExercisePicker } from './ExercisePicker';
import { MiniStepper } from './MiniStepper';
import { MUSCLE_LABEL, planContext, useTraining } from './useTraining';
import './workout.css';

const REST_OPTIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300];
const fmtRest = (s: number) => (s < 60 ? `${s}s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);

/** Edits save instantly (to the phone first, then sync) — there's no Save button to forget. */
export function RoutineEditor({ profile }: { profile: Profile }) {
  const { id } = useParams();
  const routine = useRoutine(id);
  const t = useTraining();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (routine === undefined || !t) return <main className="page" />;
  if (routine === null) {
    return (
      <main className="page">
        <SubHeader title="Routine" back="/workout" />
        <p className="muted">This routine no longer exists.</p>
      </main>
    );
  }

  const exs = routine.exercises;
  const setExercises = (next: RoutineExercise[]) => void saveRoutine(routine.id, { exercises: next });
  const patch = (key: string, p: Partial<RoutineExercise>) => setExercises(exs.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= exs.length) return;
    const next = [...exs];
    [next[i], next[j]] = [next[j], next[i]];
    setExercises(next);
  };
  const toggleSuperset = (i: number) => {
    const a = exs[i];
    const b = exs[i + 1];
    if (!b) return;
    const linked = a.supersetGroup !== null && a.supersetGroup === b.supersetGroup;
    const next = [...exs];
    if (linked) {
      next[i + 1] = { ...b, supersetGroup: null };
      // `a` stays grouped only if the exercise before it is in the same group.
      if (exs[i - 1]?.supersetGroup !== a.supersetGroup) next[i] = { ...a, supersetGroup: null };
    } else {
      const g = a.supersetGroup ?? newId();
      next[i] = { ...a, supersetGroup: g };
      next[i + 1] = { ...b, supersetGroup: g };
    }
    setExercises(next);
  };

  async function start() {
    await startWorkout({ routine: routine!, exercises: t!.exMap, history: t!.history, ctx: planContext(profile) });
    navigate('/gym');
  }

  return (
    <main className="page">
      <SubHeader title="Edit routine" back="/workout" />

      <div className="field">
        <label htmlFor="routine-name">Name</label>
        <div className="input-wrap">
          <input
            id="routine-name"
            value={name ?? routine.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== null && name.trim() && name.trim() !== routine.name) void saveRoutine(routine.id, { name: name.trim() });
              setName(null);
            }}
            enterKeyHint="done"
          />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13, marginTop: -6 }}>
        {exs.length} exercises · ~{estimateMinutes(routine)} min · changes save automatically
      </p>

      {exs.map((e, i) => {
        const ex = t.exMap.get(e.exerciseId);
        const linkedNext = e.supersetGroup !== null && exs[i + 1]?.supersetGroup === e.supersetGroup;
        const linkedPrev = e.supersetGroup !== null && exs[i - 1]?.supersetGroup === e.supersetGroup;
        return (
          <div key={e.key} className={`card routine-ex${linkedPrev ? ' ss-prev' : ''}${linkedNext ? ' ss-next' : ''}`}>
            <div className="routine-ex-head">
              <div className="grow">
                <div className="title">{ex?.name ?? 'Unknown exercise'}</div>
                <div className="desc">{ex ? MUSCLE_LABEL[ex.muscle] : ''}</div>
              </div>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                <Icon name="arrowUp" />
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === exs.length - 1} aria-label="Move down">
                <Icon name="arrowDown" />
              </button>
              <button className="icon-btn" onClick={() => setExercises(exs.filter((x) => x.key !== e.key))} aria-label="Remove">
                <Icon name="trash" color="var(--text-3)" />
              </button>
            </div>
            <div className="routine-grid">
              <MiniStepper label="Sets" value={e.sets} min={1} max={10} onChange={(v) => patch(e.key, { sets: v })} />
              <MiniStepper label="Warm-ups" value={e.warmupSets} min={0} max={3} onChange={(v) => patch(e.key, { warmupSets: v })} />
              <MiniStepper
                label="Min reps"
                value={e.repMin}
                min={1}
                max={50}
                onChange={(v) => patch(e.key, { repMin: v, repMax: Math.max(v, e.repMax) })}
              />
              <MiniStepper
                label="Max reps"
                value={e.repMax}
                min={1}
                max={50}
                onChange={(v) => patch(e.key, { repMax: v, repMin: Math.min(v, e.repMin) })}
              />
            </div>
            <div className="routine-foot">
              <label className="rest-select">
                <Icon name="timer" width={18} height={18} />
                <span className="sr-only">Rest</span>
                <select value={e.restSec} onChange={(ev) => patch(e.key, { restSec: Number(ev.target.value) })}>
                  {REST_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      Rest {fmtRest(r)}
                    </option>
                  ))}
                </select>
              </label>
              {i < exs.length - 1 && (
                <button className={`chip${linkedNext ? ' on' : ''}`} aria-pressed={linkedNext} onClick={() => toggleSuperset(i)}>
                  <Icon name="link" width={16} height={16} />
                  {linkedNext ? 'Superset ✓' : 'Superset with next'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button className="btn btn-block" onClick={() => setPicking(true)}>
        <Icon name="plus" />
        Add exercise
      </button>

      {exs.length > 0 && (
        <button className="btn btn-primary btn-lg btn-block" onClick={() => void start()} disabled={!!t.active}>
          <Icon name="play" />
          {t.active ? 'Another workout is in progress' : `Start ${routine.name}`}
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
              await deleteRoutine(routine.id);
              toast(`Deleted ${routine.name} (your workout history is kept)`);
              navigate('/workout');
            }}
          >
            Delete routine
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(true)}>
          Delete routine
        </button>
      )}

      {picking && (
        <ExercisePicker
          exercises={t.exercises}
          onClose={() => setPicking(false)}
          onPick={(ex) => {
            setExercises([...exs, routineExercise(ex.id)]);
            setPicking(false);
          }}
        />
      )}
    </main>
  );
}
