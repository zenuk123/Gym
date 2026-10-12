import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import type { Workout } from '../../db/types';
import { workoutStats } from '../../lib/calc/training';
import { formatDateShort } from '../../lib/dates';
import { plural } from '../../lib/format';
import { mergeWorkoutsInto } from './actions';
import { combinedName, mergeCandidates } from './logic';
import type { Training } from './useTraining';

/** Merge another logged workout into this one (e.g. morning + evening, or a session split by mistake). */
export function MergeWorkoutSheet({ t, w, onClose }: { t: Training; w: Workout; onClose: () => void }) {
  const toast = useToast();
  const [other, setOther] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const options = mergeCandidates(w, t.finished);
  const describe = (x: Workout) => {
    const s = workoutStats(x);
    return `${formatDateShort(x.date)} · ${new Date(x.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${s.durationMin} min · ${plural(s.sets, 'set')}`;
  };

  async function merge() {
    if (!other) return;
    setBusy(true);
    const undo = await mergeWorkoutsInto(w.id, other.id);
    toast(`Combined into ${combinedName([w.name, other.name])}`, undo ? { label: 'Undo', run: () => void undo() } : undefined);
    onClose();
  }

  return (
    <Sheet title="Combine with another workout" onClose={onClose}>
      {!other ? (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            Pick the workout to add to this one. Its sets join this session, and it’s removed from your history as a separate workout.
          </p>
          {options.length === 0 ? (
            <p className="muted">No other workouts logged yet.</p>
          ) : (
            <div className="list">
              {options.map((x) => (
                <button key={x.id} className="list-row" onClick={() => setOther(x)}>
                  <div className="grow">
                    <div className="title">
                      {x.name} {x.date === w.date && <span className="pill good">Same day</span>}
                    </div>
                    <div className="desc">{describe(x)}</div>
                  </div>
                  <span className="trail">
                    <Icon name="chevronRight" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            Combine <b>{other.name}</b> ({describe(other)}) into <b>{w.name}</b> ({describe(w)})?
          </p>
          <p className="faint" style={{ fontSize: 13 }}>
            The result is called “{combinedName([w.name, other.name])}”, starts at the earlier time, and its length is both sessions added together. Exercises in both
            sessions are joined. You can undo straight after.
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => setOther(null)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void merge()}>
              <Icon name="link" /> Combine
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
