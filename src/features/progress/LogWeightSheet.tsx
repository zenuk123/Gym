import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { NumberField } from '../../components/NumberField';
import { useToast } from '../../components/Toast';
import { create, update } from '../../db/repo';
import type { Profile, WeightEntry } from '../../db/types';
import { todayISO } from '../../lib/dates';
import { fromDisplayWeight, parseDecimal, round, toDisplayWeight } from '../../lib/units';

/** Log (or edit) a weigh-in. Pre-fills with the last weight so usually it's a tiny tweak. */
export function LogWeightSheet({
  profile,
  last,
  editing,
  onClose,
}: {
  profile: Profile;
  last?: WeightEntry | null;
  editing?: WeightEntry;
  onClose: () => void;
}) {
  const toast = useToast();
  const unit = profile.weightUnit;
  const initial = editing ?? last;
  const [value, setValue] = useState(initial ? String(round(toDisplayWeight(initial.weightKg, unit), 1)) : '');
  const [date, setDate] = useState(editing?.date ?? todayISO());

  const n = parseDecimal(value);
  const kg = n !== null ? fromDisplayWeight(n, unit) : null;
  const valid = kg !== null && kg >= 25 && kg <= 350 && date <= todayISO();

  const nudge = (delta: number) => {
    const cur = parseDecimal(value) ?? 0;
    setValue(String(round(cur + delta, 1)));
  };

  async function save() {
    if (!valid) return;
    if (editing) {
      await update('weights', editing.id, { weightKg: round(kg!, 2), date });
      toast('Weigh-in updated');
    } else {
      await create('weights', { date, weightKg: round(kg!, 2), note: null });
      toast('Weight logged');
    }
    onClose();
  }

  return (
    <Sheet title={editing ? 'Edit weigh-in' : 'Log weight'} onClose={onClose}>
      <NumberField big label="Weight" suffix={unit} value={value} onChange={setValue} autoFocus={!initial} />
      <div className="quick-row">
        {[-0.5, -0.1, 0.1, 0.5].map((d) => (
          <button key={d} type="button" className="btn" onClick={() => nudge(d)}>
            {d > 0 ? '+' : '−'}
            {Math.abs(d)}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="weigh-date">Date</label>
        <div className="input-wrap">
          <input id="weigh-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Tip: weigh yourself first thing in the morning, after the bathroom, before eating — the trend matters more than any single day.
      </p>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Save
      </button>
    </Sheet>
  );
}
