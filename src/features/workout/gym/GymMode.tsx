import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import type { Profile, Workout, WorkoutExercise } from '../../../db/types';
import { checkSetPB, lastSession, PB_LABEL, workingSets } from '../../../lib/calc/training';
import { formatWeight } from '../../../lib/units';
import { haptic } from '../../../pwa/platform';
import { useWakeLock } from '../../../pwa/wakeLock';
import * as A from '../actions';
import { afterSetCompleted, isExerciseDone, pendingSetIndex } from '../logic';
import { planContext, useTraining, type Training } from '../useTraining';
import { ExercisePicker } from '../ExercisePicker';
import { ExerciseMenu } from './ExerciseMenu';
import { FinishSheet } from './FinishSheet';
import { FocusPanel } from './FocusPanel';
import { startRest, stopRest, unlockAudio } from './restTimer';
import { SetTable } from './SetTable';
import './gym.css';

const IDX_KEY = 'fos.gym.index';

/**
 * Gym Mode: one exercise at a time, big controls, minimal typing, one thumb.
 * Every tap is saved to the phone immediately — no signal needed.
 */
export function GymMode({ profile }: { profile: Profile }) {
  const t = useTraining();
  const navigate = useNavigate();
  useWakeLock(true);

  if (!t) return <div className="gym" />;
  if (!t.active) {
    return (
      <main className="page no-nav">
        <EmptyState icon="dumbbell">
          <b className="empty-title">No workout in progress</b>
          Start one from the Workout tab.
        </EmptyState>
        <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/workout')}>
          Go to Workout
        </button>
      </main>
    );
  }
  return <ActiveWorkout key={t.active.id} t={t} workout={t.active} profile={profile} />;
}

function ActiveWorkout({ t, workout, profile }: { t: Training; workout: Workout; profile: Profile }) {
  const navigate = useNavigate();
  const toast = useToast();
  const ctx = planContext(profile);
  const unit = profile.weightUnit;

  const [index, setIndexState] = useState(() => {
    const saved = Number(sessionStorage.getItem(`${IDX_KEY}.${workout.id}`));
    if (Number.isFinite(saved) && saved < workout.exercises.length) return saved;
    const firstPending = workout.exercises.findIndex((e) => pendingSetIndex(e) >= 0);
    return Math.max(0, firstPending);
  });
  const setIndex = (i: number) => {
    setIndexState(i);
    setFocusSetId(null);
    try {
      sessionStorage.setItem(`${IDX_KEY}.${workout.id}`, String(i));
    } catch {
      /* ignore */
    }
  };
  const [focusSetId, setFocusSetId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'add' | 'menu' | 'finish'>(null);

  const i = Math.min(index, Math.max(0, workout.exercises.length - 1));
  const current: WorkoutExercise | undefined = workout.exercises[i];
  const exercise = current ? t.exMap.get(current.exerciseId) : undefined;
  const last = current ? lastSession(t.history, current.exerciseId, workout.id) : null;

  // The set the big controls edit: explicit selection, else the first unfinished set.
  const focusSet = current?.sets.find((s) => s.id === focusSetId) ?? (current ? current.sets[pendingSetIndex(current)] : undefined);

  useEffect(() => {
    // Keep the active exercise pill in view.
    document.getElementById(`pill-${i}`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [i]);

  const allDone = workout.exercises.length > 0 && workout.exercises.every(isExerciseDone);

  async function complete(target = focusSet) {
    if (!current || !target || !exercise) return;
    unlockAudio();
    haptic(15);
    if (target.done) {
      setFocusSetId(null); // was editing a finished set
      return;
    }
    const saved = await A.completeSet(workout.id, current.id, target.id);
    if (!saved) return;
    const focusSet = saved.exercises.find((e) => e.id === current.id)?.sets.find((s) => s.id === target.id) ?? target;

    // Live PB check against history + earlier sets today. The first session of an
    // exercise is only a baseline (same rule as the summary), so it never shows PBs.
    const past = t.history.get(current.exerciseId) ?? [];
    if (focusSet.kind !== 'warmup' && past.length > 0) {
      const today = workout.exercises
        .filter((e) => e.exerciseId === current.exerciseId)
        .flatMap(workingSets)
        .filter((s) => s.id !== focusSet.id);
      const earlier = [...past.flatMap((s) => s.sets), ...today];
      const pb = checkSetPB(focusSet, earlier, exercise.bodyweight);
      if (pb) {
        haptic([30, 50, 30]);
        toast(
          `🏆 New PB · ${exercise.name} ${formatWeight(focusSet.weightKg, unit)} × ${focusSet.reps} (${PB_LABEL[pb.kind].toLowerCase()}; was ${formatWeight(pb.previous.weightKg, unit)} × ${pb.previous.reps})`,
        );
      }
    }

    const next = afterSetCompleted(saved, i);
    // Warm-ups only need a short breather.
    if (next.rest) startRest(focusSet.kind === 'warmup' ? Math.min(60, current.restSec) : current.restSec);
    else stopRest();
    if (next.index !== i) setIndex(next.index);
    else setFocusSetId(null);
  }

  return (
    <div className="gym">
      <header className="gym-header">
        <button className="icon-btn" onClick={() => navigate('/workout')} aria-label="Minimise (workout keeps running)">
          <Icon name="chevronLeft" />
        </button>
        <div className="gym-title">
          <div className="name">{workout.name}</div>
          <Elapsed since={workout.startedAt} />
        </div>
        <button className="btn btn-primary gym-finish" onClick={() => setSheet('finish')}>
          Finish
        </button>
      </header>

      <nav className="gym-strip" aria-label="Exercises">
        {workout.exercises.map((e, k) => {
          const done = e.sets.filter((s) => s.done).length;
          return (
            <button
              key={e.id}
              id={`pill-${k}`}
              className={`gym-pill${k === i ? ' on' : ''}${isExerciseDone(e) ? ' done' : ''}`}
              onClick={() => setIndex(k)}
            >
              {e.supersetGroup && <Icon name="link" width={12} height={12} />}
              <span>{t.exMap.get(e.exerciseId)?.name ?? '?'}</span>
              <small>
                {isExerciseDone(e) ? '✓' : `${done}/${e.sets.length}`}
              </small>
            </button>
          );
        })}
        <button className="gym-pill add" onClick={() => setSheet('add')} aria-label="Add exercise">
          <Icon name="plus" width={16} height={16} />
          <span>Add</span>
        </button>
      </nav>

      <main className="gym-body">
        {current && exercise ? (
          <>
            <section className="gym-ex">
              <div className="gym-ex-head">
                <div className="grow">
                  <h1>{exercise.name}</h1>
                  <div className="faint">
                    Exercise {i + 1} of {workout.exercises.length}
                    {current.supersetGroup && ' · superset'} · {current.repMin === current.repMax ? current.repMin : `${current.repMin}–${current.repMax}`} reps
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="Exercise options">
                  <Icon name="more" />
                </button>
              </div>
              <div className="gym-compare">
                <div className="cmp">
                  <span className="cmp-label">Last time</span>
                  <span className="cmp-value">
                    {last
                      ? last.sets
                          .slice(0, 4)
                          .map((s) => `${formatWeight(s.weightKg, unit).replace(` ${unit}`, '')}×${s.reps}`)
                          .join('  ')
                      : '—'}
                  </span>
                </div>
                <div className="cmp target">
                  <span className="cmp-label">Target today</span>
                  <span className="cmp-value">
                    {current.target
                      ? `${formatWeight(current.target.weightKg, unit)} × ${current.target.repMin === current.target.repMax ? current.target.repMin : `${current.target.repMin}–${current.target.repMax}`}`
                      : 'Find your weight'}
                  </span>
                </div>
              </div>
              {current.notes && <p className="gym-note">📝 {current.notes}</p>}
            </section>

            <SetTable
              ex={current}
              last={last}
              unit={unit}
              focusId={focusSet?.id ?? null}
              onFocus={setFocusSetId}
              onCheck={async (s) => {
                if (s.done) {
                  await A.undoSet(workout.id, current.id, s.id);
                  setFocusSetId(s.id);
                } else {
                  await complete(s);
                }
              }}
            />
            <div className="gym-add-row">
              <button className="chip" onClick={() => void A.addSet(workout.id, current.id, 'normal', { incrementKg: exercise.incrementKg, unit })}>
                <Icon name="plus" width={16} height={16} /> Set
              </button>
              <button className="chip" onClick={() => void A.addSet(workout.id, current.id, 'warmup', { incrementKg: exercise.incrementKg, unit })}>
                <Icon name="plus" width={16} height={16} /> Warm-up
              </button>
              <button className="chip" onClick={() => void A.addSet(workout.id, current.id, 'drop', { incrementKg: exercise.incrementKg, unit })}>
                <Icon name="plus" width={16} height={16} /> Drop set
              </button>
            </div>
          </>
        ) : (
          <EmptyState icon="dumbbell">
            <b className="empty-title">Empty workout</b>
            Add your first exercise to get going.
          </EmptyState>
        )}
      </main>

      <FocusPanel
        workout={workout}
        ex={current}
        exercise={exercise}
        set={focusSet}
        unit={unit}
        allDone={allDone}
        nextName={
          current && isExerciseDone(current)
            ? (() => {
                const n = workout.exercises.findIndex((e, k) => k !== i && !isExerciseDone(e));
                return n >= 0 ? { index: n, name: t.exMap.get(workout.exercises[n].exerciseId)?.name ?? 'Next' } : null;
              })()
            : null
        }
        onGoTo={setIndex}
        onComplete={() => void complete()}
        onAdd={() => setSheet('add')}
        onFinish={() => setSheet('finish')}
      />

      {sheet === 'add' && (
        <ExercisePicker
          exercises={t.exercises}
          onClose={() => setSheet(null)}
          onPick={async (ex) => {
            setSheet(null);
            await A.addExerciseToWorkout(workout.id, ex, t.history, ctx);
            setIndex(workout.exercises.length);
          }}
        />
      )}
      {sheet === 'menu' && current && exercise && (
        <ExerciseMenu
          workout={workout}
          ex={current}
          exercise={exercise}
          index={i}
          onClose={() => setSheet(null)}
          onMoved={(to) => setIndex(to)}
          onRemoved={() => setIndex(Math.max(0, i - 1))}
        />
      )}
      {sheet === 'finish' && (
        <FinishSheet
          workout={workout}
          onClose={() => setSheet(null)}
          onFinished={() => {
            stopRest();
            navigate(`/workout/summary/${workout.id}`, { replace: true });
          }}
          onDiscarded={() => {
            stopRest();
            navigate('/workout', { replace: true });
          }}
        />
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const text = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return (
    <div className="elapsed num" aria-label="Elapsed time">
      {text}
    </div>
  );
}
