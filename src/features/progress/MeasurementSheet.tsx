import { useState } from 'react';
import { NumberField } from '../../components/NumberField';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { create, remove, update } from '../../db/repo';
import { MEASUREMENT_SITES, siteKey, type LengthUnit, type Measurement, type MeasurementSite } from '../../db/types';
import { SITE_LABEL } from '../../lib/calc/measurements';
import { todayISO } from '../../lib/dates';
import { fromDisplayLength, parseDecimal, round, toDisplayLength } from '../../lib/units';

const HINT: Record<MeasurementSite, string> = {
  chest: 'At nipple height, arms relaxed',
  waist: 'At the navel, relaxed, after breathing out',
  arms: 'Flexed, widest point of the upper arm',
  thighs: 'Widest point, standing',
  shoulders: 'Around the widest point',
  hips: 'Widest point of the glutes',
  neck: 'Just below the Adam’s apple',
};

/** Add or edit a measuring session. Fill in only what you measured. */
export function MeasurementSheet({
  unit,
  last,
  editing,
  onClose,
}: {
  unit: LengthUnit;
  last?: Measurement | null;
  editing?: Measurement;
  onClose: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [vals, setVals] = useState<Record<MeasurementSite, string>>(() =>
    Object.fromEntries(
      MEASUREMENT_SITES.map((s) => {
        const v = editing?.[siteKey(s)];
        return [s, v != null ? String(round(toDisplayLength(v, unit), 1)) : ''];
      }),
    ) as Record<MeasurementSite, string>,
  );
  const parsed = MEASUREMENT_SITES.map((s) => [s, vals[s].trim() === '' ? null : parseDecimal(vals[s])] as const);
  const invalid = parsed.some(([s, v]) => vals[s].trim() !== '' && (v === null || v <= 0 || v > 300));
  const any = parsed.some(([, v]) => v !== null);

  async function save() {
    if (invalid || !any) return;
    const data = Object.fromEntries(parsed.map(([s, v]) => [siteKey(s), v === null ? null : round(fromDisplayLength(v, unit), 1)])) as Pick<
      Measurement,
      `${MeasurementSite}Cm`
    >;
    if (editing) await update('measurements', editing.id, { ...data, date });
    else await create('measurements', { ...data, date, note: null });
    toast(editing ? 'Measurements updated' : 'Measurements saved');
    onClose();
  }

  return (
    <Sheet title={editing ? 'Edit measurements' : 'Measurements'} onClose={onClose}>
      <div className="field">
        <label htmlFor="m-date">Date</label>
        <div className="input-wrap">
          <input id="m-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Measure in the morning, same spots each time, tape snug but not tight. Leave blank anything you skip.
      </p>
      <div className="measure-grid">
        {MEASUREMENT_SITES.map((s) => {
          const prev = last?.[siteKey(s)];
          return (
            <NumberField
              key={s}
              label={SITE_LABEL[s]}
              suffix={unit}
              value={vals[s]}
              onChange={(v) => setVals((x) => ({ ...x, [s]: v }))}
              placeholder={prev != null ? String(round(toDisplayLength(prev, unit), 1)) : '—'}
              hint={HINT[s]}
            />
          );
        })}
      </div>
      {invalid && <p className="error-text">Check the highlighted values.</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={invalid || !any} onClick={() => void save()}>
        Save
      </button>
      {editing && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await remove('measurements', editing.id);
            toast('Deleted');
            onClose();
          }}
        >
          Delete this check-in
        </button>
      )}
    </Sheet>
  );
}
