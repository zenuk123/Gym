import { useState } from 'react';
import { NumberField } from '../../components/NumberField';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useMeasurements } from '../../db/hooks';
import { create, remove, update } from '../../db/repo';
import { MEASUREMENT_SITES, type Exercise, type LiftMetric, type MeasurementSite, type Profile, type UserGoal } from '../../db/types';
import { currentLiftBest } from '../../lib/calc/goals';
import { SITE_LABEL, siteSeries } from '../../lib/calc/measurements';
import { todayISO } from '../../lib/dates';
import { formatWeight, fromDisplayLength, fromDisplayWeight, parseDecimal, round, toDisplayLength, toDisplayWeight } from '../../lib/units';
import { ExercisePicker } from '../workout/ExercisePicker';
import type { Training } from '../workout/useTraining';

/** Create or edit a lift / measurement goal. Start value = where you are today. */
export function GoalSheet({ profile, t, editing, onClose }: { profile: Profile; t: Training; editing?: UserGoal; onClose: () => void }) {
  const toast = useToast();
  const measurements = useMeasurements() ?? [];
  const [kind, setKind] = useState<'lift' | 'measurement'>(editing?.kind ?? 'lift');
  const [exercise, setExercise] = useState<Exercise | null>(editing?.exerciseId ? (t.exMap.get(editing.exerciseId) ?? null) : null);
  const [metric, setMetric] = useState<LiftMetric>(editing?.metric ?? 'weight');
  const [site, setSite] = useState<MeasurementSite>(editing?.site ?? 'waist');
  const [picking, setPicking] = useState(false);
  const wu = profile.weightUnit;
  const lu = profile.lengthUnit;
  const toDisp = (v: number) => (kind === 'lift' ? toDisplayWeight(v, wu) : toDisplayLength(v, lu));
  const fromDisp = (v: number) => (kind === 'lift' ? fromDisplayWeight(v, wu) : fromDisplayLength(v, lu));
  const [target, setTarget] = useState(editing ? String(round(toDisp(editing.targetValue), 1)) : '');
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? '');

  const currentStart =
    kind === 'lift'
      ? exercise
        ? currentLiftBest(t.history, exercise.id, metric)
        : null
      : (siteSeries(measurements, site).at(-1)?.value ?? null);
  const start = editing ? editing.startValue : currentStart;
  const tNum = parseDecimal(target);
  const valid = tNum !== null && tNum > 0 && (kind === 'measurement' || exercise !== null) && (start === null || Math.abs(fromDisp(tNum) - start) > 0.01);
  const unitLabel = kind === 'lift' ? wu : lu;

  async function save() {
    if (!valid) return;
    const targetValue = fromDisp(tNum!);
    const data = {
      kind,
      exerciseId: kind === 'lift' ? exercise!.id : null,
      metric: kind === 'lift' ? metric : null,
      site: kind === 'measurement' ? site : null,
      startValue: start ?? 0,
      targetValue,
      startDate: editing?.startDate ?? todayISO(),
      targetDate: targetDate || null,
      archived: false,
    };
    if (editing) await update('goals', editing.id, data);
    else await create('goals', data);
    toast(editing ? 'Goal updated' : 'Goal added');
    onClose();
  }

  if (picking) {
    return (
      <ExercisePicker
        title="Choose a lift"
        exercises={t.exercises}
        onClose={() => setPicking(false)}
        onPick={(e) => {
          setExercise(e);
          setPicking(false);
        }}
      />
    );
  }

  return (
    <Sheet title={editing ? 'Edit goal' : 'New goal'} onClose={onClose}>
      {!editing && (
        <Segmented
          label="Goal type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'lift', label: 'Strength' },
            { value: 'measurement', label: 'Measurement' },
          ]}
        />
      )}
      {kind === 'lift' ? (
        <>
          <button className="btn btn-block picker-btn" onClick={() => setPicking(true)} disabled={!!editing}>
            {exercise ? exercise.name : 'Choose a lift…'}
          </button>
          <Segmented
            label="Measure"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'weight', label: 'Heaviest weight' },
              { value: 'e1rm', label: 'Estimated 1RM' },
            ]}
          />
        </>
      ) : (
        <div className="field">
          <label htmlFor="goal-site">Body part</label>
          <div className="input-wrap">
            <select id="goal-site" value={site} onChange={(e) => setSite(e.target.value as MeasurementSite)} disabled={!!editing}>
              {MEASUREMENT_SITES.map((s) => (
                <option key={s} value={s}>
                  {SITE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 14 }}>
        {start !== null
          ? `Starting from ${kind === 'lift' ? formatWeight(start, wu) : `${round(toDisplayLength(start, lu), 1)} ${lu}`} (${editing ? 'when you set this goal' : 'your current best'}).`
          : kind === 'lift'
            ? 'No sets logged for this lift yet — progress starts from your first session.'
            : 'No measurement yet — add one on the Body tab to track progress.'}
      </p>
      <NumberField big label="Target" suffix={unitLabel} value={target} onChange={setTarget} />
      <div className="field">
        <label htmlFor="goal-date">Target date (optional)</label>
        <div className="input-wrap">
          <input id="goal-date" type="date" value={targetDate} min={todayISO()} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        {editing ? 'Save goal' : 'Add goal'}
      </button>
      {editing && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await remove('goals', editing.id);
            toast('Goal deleted');
            onClose();
          }}
        >
          Delete goal
        </button>
      )}
    </Sheet>
  );
}
