import { useState } from 'react';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { create, remove, update } from '../../../db/repo';
import type { SleepLog } from '../../../db/types';
import { formatDuration, sleepDuration } from '../../../lib/calc/sleep';
import { todayISO } from '../../../lib/dates';

export const QUALITY_LABEL = ['', 'Awful', 'Poor', 'OK', 'Good', 'Great'];

/** Log (or edit) one night. Pre-fills with your last bed / wake times so a typical night is two taps. */
export function SleepSheet({ last, editing, onClose }: { last?: SleepLog | null; editing?: SleepLog; onClose: () => void }) {
  const toast = useToast();
  const base = editing ?? last;
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [bed, setBed] = useState(base?.bedTime ?? '23:00');
  const [wake, setWake] = useState(base?.wakeTime ?? '07:00');
  const [quality, setQuality] = useState(editing?.quality ?? 3);
  const [note, setNote] = useState(editing?.note ?? '');

  const valid = /^\d{2}:\d{2}$/.test(bed) && /^\d{2}:\d{2}$/.test(wake) && date <= todayISO();
  const minutes = valid ? sleepDuration(bed, wake) : 0;

  async function save() {
    if (!valid) return;
    const data = { date, bedTime: bed, wakeTime: wake, durationMin: minutes, quality, note: note.trim() || null };
    if (editing) {
      await update('sleep', editing.id, data);
      toast('Sleep updated');
    } else {
      await create('sleep', data);
      toast(`${formatDuration(minutes)} sleep logged`);
    }
    onClose();
  }

  return (
    <Sheet title={editing ? 'Edit sleep' : 'Log sleep'} onClose={onClose}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sleep-bed">Went to bed</label>
          <div className="input-wrap">
            <input id="sleep-bed" type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sleep-wake">Woke up</label>
          <div className="input-wrap">
            <input id="sleep-wake" type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="sleep-total" aria-live="polite">
        {valid ? formatDuration(minutes) : '—'} <span className="faint">in bed</span>
      </p>
      <div className="field">
        <span className="label">How did you sleep?</span>
        <div className="quality-row" role="group" aria-label="Sleep quality">
          {[1, 2, 3, 4, 5].map((q) => (
            <button key={q} type="button" className="chip" aria-pressed={q === quality} onClick={() => setQuality(q)}>
              {QUALITY_LABEL[q]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="sleep-date">Morning of</label>
        <div className="input-wrap">
          <input id="sleep-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="sleep-note">Note (optional)</label>
        <div className="input-wrap">
          <input id="sleep-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. late coffee, woke at 3am" />
        </div>
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Save
      </button>
      {editing && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await remove('sleep', editing.id);
            toast('Night deleted', { label: 'Undo', run: () => void update('sleep', editing.id, { deletedAt: null }) });
            onClose();
          }}
        >
          Delete
        </button>
      )}
    </Sheet>
  );
}
