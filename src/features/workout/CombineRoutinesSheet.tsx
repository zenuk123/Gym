import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import type { Routine } from '../../db/types';
import { estimateMinutes } from '../../lib/calc/training';
import { plural } from '../../lib/format';
import { combineRoutines } from './logic';
import type { Training } from './useTraining';

/** Pick two or more routines and do them as one session (e.g. Push + Core). */
export function CombineRoutinesSheet({ t, onStart, onClose }: { t: Training; onStart: (routine: Routine) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = picked.map((id) => t.routines.find((r) => r.id === id)).filter((r): r is Routine => !!r);
  const combined = combineRoutines(chosen);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Sheet title="Combine routines" onClose={onClose}>
      <p className="muted" style={{ fontSize: 14 }}>
        Tick the routines to do in one session, in the order you tick them. An exercise that’s in more than one is only done once.
      </p>
      <div className="list">
        {t.routines.map((r) => {
          const n = picked.indexOf(r.id);
          return (
            <button key={r.id} className="list-row" aria-pressed={n >= 0} onClick={() => toggle(r.id)}>
              <span className={`order-badge${n >= 0 ? ' on' : ''}`}>{n >= 0 ? n + 1 : ''}</span>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="desc">
                  {plural(r.exercises.length, 'exercise')} · ~{estimateMinutes(r)} min
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {combined && chosen.length > 1 && (
        <p className="faint" style={{ fontSize: 14 }}>
          {combined.name}: {plural(combined.exercises.length, 'exercise')} · ~{estimateMinutes(combined)} min
        </p>
      )}
      <button className="btn btn-primary btn-lg btn-block" disabled={chosen.length < 2 || !combined?.exercises.length} onClick={() => combined && onStart(combined)}>
        <Icon name="play" /> {chosen.length < 2 ? 'Pick at least two' : `Start ${combined!.name}`}
      </button>
    </Sheet>
  );
}
