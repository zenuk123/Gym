import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { update, updateProfile } from '../../../db/repo';
import type { Profile, Routine } from '../../../db/types';
import { workoutStats } from '../../../lib/calc/training';
import { plural } from '../../../lib/format';
import { discardWorkout } from '../../workout/actions';
import type { Training } from '../../workout/useTraining';

/**
 * Reset for Today's workout: discard a workout in progress, and/or choose which routine
 * comes next (restart the rotation). History is never deleted by the rotation reset.
 */
export function WorkoutResetSheet({ profile, t, next, onClose }: { profile: Profile; t: Training; next: Routine | null; onClose: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const routines = [...t.routines].sort((a, b) => a.sortOrder - b.sortOrder);
  const active = t.active;

  async function discard() {
    if (!active) return;
    await discardWorkout(active.id);
    toast('Workout discarded', { label: 'Undo', run: () => void update('workouts', active.id, { deletedAt: null }) });
    onClose();
  }

  async function pin(r: Routine) {
    const prev = { nextRoutineId: profile.nextRoutineId ?? null, nextRoutineSetAt: profile.nextRoutineSetAt ?? null };
    await updateProfile({ nextRoutineId: r.id, nextRoutineSetAt: Date.now() });
    toast(`Next up: ${r.name}`, { label: 'Undo', run: () => void updateProfile(prev) });
    onClose();
  }

  return (
    <Sheet title="Reset today’s workout" onClose={onClose}>
      {active && (
        <section className="reset-block">
          <h3>Workout in progress</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            {active.name} · {plural(workoutStats(active).sets, 'set')} logged. Discarding deletes this session so you can start again.
          </p>
          {confirm ? (
            <button className="btn btn-danger btn-block" onClick={() => void discard()}>
              <Icon name="trash" /> Yes, discard it
            </button>
          ) : (
            <button className="btn btn-block" onClick={() => setConfirm(true)}>
              <Icon name="trash" /> Discard workout in progress
            </button>
          )}
        </section>
      )}

      {routines.length > 0 && (
        <section className="reset-block">
          <h3>Restart the rotation</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            Choose what’s next. Your history stays; after you finish it, the programme carries on in order from there.
          </p>
          <div className="list">
            {routines.map((r, i) => (
              <button key={r.id} className="list-row" onClick={() => void pin(r)} aria-pressed={next?.id === r.id}>
                <div className="grow">
                  <div className="title">
                    {r.name}
                    {i === 0 && <span className="faint"> · start of programme</span>}
                  </div>
                  <div className="desc">{plural(r.exercises.length, 'exercise')}</div>
                </div>
                <span className="trail">{next?.id === r.id ? <span className="pill">Up next</span> : <Icon name="chevronRight" />}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {!active && routines.length === 0 && <p className="muted">Nothing to reset yet — set up a programme first.</p>}
    </Sheet>
  );
}
