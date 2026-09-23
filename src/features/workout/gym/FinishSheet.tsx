import { useState } from 'react';
import { Sheet } from '../../../components/Sheet';
import type { Workout } from '../../../db/types';
import { workoutStats } from '../../../lib/calc/training';
import * as A from '../actions';

export function FinishSheet({
  workout,
  onClose,
  onFinished,
  onDiscarded,
}: {
  workout: Workout;
  onClose: () => void;
  onFinished: () => void;
  onDiscarded: () => void;
}) {
  const [notes, setNotes] = useState(workout.notes ?? '');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stats = workoutStats(workout);
  const pending = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  const doneAny = workout.exercises.some((e) => e.sets.some((s) => s.done));

  return (
    <Sheet title="Finish workout?" onClose={onClose}>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Time</div>
          <div className="value">{stats.durationMin} min</div>
        </div>
        <div className="stat">
          <div className="label">Sets done</div>
          <div className="value">{stats.sets}</div>
        </div>
        <div className="stat">
          <div className="label">Exercises</div>
          <div className="value">{stats.exercises}</div>
        </div>
      </div>
      {pending > 0 && doneAny && (
        <p className="muted" style={{ fontSize: 14 }}>
          {pending} unfinished set{pending === 1 ? '' : 's'} will be left out.
        </p>
      )}
      {doneAny ? (
        <>
          <div className="field">
            <label htmlFor="wo-notes">How did it go? (optional)</label>
            <textarea id="wo-notes" className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={async () => {
              await A.finishWorkout(workout.id, notes.trim() || null);
              onFinished();
            }}
          >
            Save workout
          </button>
        </>
      ) : (
        <p className="muted">No sets completed yet.</p>
      )}
      <button className="btn btn-block" onClick={onClose}>
        Keep training
      </button>
      {confirmDiscard ? (
        <button
          className="btn btn-danger btn-block"
          onClick={async () => {
            await A.discardWorkout(workout.id);
            onDiscarded();
          }}
        >
          Yes, discard this workout
        </button>
      ) : (
        <button className="btn btn-ghost btn-block" onClick={() => setConfirmDiscard(true)}>
          Discard workout
        </button>
      )}
    </Sheet>
  );
}
