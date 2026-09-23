import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { Sheet } from '../../../components/Sheet';
import type { Exercise, Workout, WorkoutExercise } from '../../../db/types';
import * as A from '../actions';

/** Per-exercise options in Gym Mode: notes, reorder, remove, history. */
export function ExerciseMenu({
  workout,
  ex,
  exercise,
  index,
  onClose,
  onMoved,
  onRemoved,
}: {
  workout: Workout;
  ex: WorkoutExercise;
  exercise: Exercise;
  index: number;
  onClose: () => void;
  onMoved: (to: number) => void;
  onRemoved: () => void;
}) {
  const [notes, setNotes] = useState(ex.notes ?? '');
  const [confirm, setConfirm] = useState(false);
  const done = ex.sets.some((s) => s.done);

  return (
    <Sheet
      title={exercise.name}
      onClose={() => {
        if ((ex.notes ?? '') !== notes) void A.setExerciseNotes(workout.id, ex.id, notes);
        onClose();
      }}
    >
      <div className="field">
        <label htmlFor="ex-notes">Notes</label>
        <textarea
          id="ex-notes"
          className="textarea"
          rows={3}
          placeholder="Seat height 4, felt strong…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void A.setExerciseNotes(workout.id, ex.id, notes)}
        />
      </div>
      <div className="list">
        <button
          className="list-row"
          disabled={index === 0}
          onClick={async () => {
            await A.moveExerciseInWorkout(workout.id, ex.id, -1);
            onMoved(index - 1);
            onClose();
          }}
        >
          <Icon name="arrowUp" />
          <div className="grow title">Move earlier</div>
        </button>
        <button
          className="list-row"
          disabled={index === workout.exercises.length - 1}
          onClick={async () => {
            await A.moveExerciseInWorkout(workout.id, ex.id, 1);
            onMoved(index + 1);
            onClose();
          }}
        >
          <Icon name="arrowDown" />
          <div className="grow title">Move later</div>
        </button>
        <Link className="list-row" to={`/workout/exercises/${exercise.id}`}>
          <Icon name="history" />
          <div className="grow title">History & PBs</div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </Link>
        {confirm ? (
          <button
            className="list-row danger"
            onClick={async () => {
              await A.removeExerciseFromWorkout(workout.id, ex.id);
              onRemoved();
              onClose();
            }}
          >
            <Icon name="trash" />
            <div className="grow title">{done ? 'Remove it and its logged sets' : 'Tap again to remove'}</div>
          </button>
        ) : (
          <button className="list-row danger" onClick={() => setConfirm(true)}>
            <Icon name="trash" />
            <div className="grow title">Remove from this workout</div>
          </button>
        )}
      </div>
    </Sheet>
  );
}
