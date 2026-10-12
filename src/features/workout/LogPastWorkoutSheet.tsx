import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import type { Profile } from '../../db/types';
import { addDays, isLoggableDate, todayISO } from '../../lib/dates';
import { parseDecimal } from '../../lib/units';
import { fillFromRoutine, logPastWorkout } from './actions';
import { planContext, type Training } from './useTraining';

/** Forgot to track a session? Log it after the fact, optionally pre-filled from a routine. */
export function LogPastWorkoutSheet({ t, profile, onClose }: { t: Training; profile: Profile; onClose: () => void }) {
  const navigate = useNavigate();
  const [date, setDate] = useState(addDays(todayISO(), -1));
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  const routine = t.routines.find((r) => r.id === routineId) ?? null;
  const mins = parseDecimal(minutes);
  const valid = isLoggableDate(date) && mins !== null && mins >= 1 && mins <= 600;

  async function save() {
    if (!valid) return;
    setBusy(true);
    const w = await logPastWorkout(date, name.trim() || routine?.name || 'Workout', mins!);
    if (routine) await fillFromRoutine(w.id, routine, t.exMap, t.history, planContext(profile));
    onClose();
    navigate(`/workout/session/${w.id}/edit`);
  }

  return (
    <Sheet title="Log a past workout" onClose={onClose}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="past-date">Date</label>
          <div className="input-wrap">
            <input id="past-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="past-min">Length</label>
          <div className="input-wrap">
            <input id="past-min" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
            <span className="suffix">min</span>
          </div>
        </div>
      </div>
      {t.routines.length > 0 && (
        <div className="field">
          <span className="label">Start from a routine (optional)</span>
          <div className="chip-wrap">
            {t.routines.map((r) => (
              <button key={r.id} className="chip" aria-pressed={routineId === r.id} onClick={() => setRoutineId(routineId === r.id ? null : r.id)}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="past-name">Name</label>
        <div className="input-wrap">
          <input id="past-name" value={name} placeholder={routine?.name ?? 'Workout'} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Next you’ll fill in the weights and reps{routine ? ' — they start from your usual numbers for this routine' : ''}.
      </p>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid || busy} onClick={() => void save()}>
        <Icon name="plus" /> Log workout
      </button>
    </Sheet>
  );
}
