import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { NumberField, TextField } from '../../components/NumberField';
import { Sheet } from '../../components/Sheet';
import type { Equipment, Exercise, MuscleGroup } from '../../db/types';
import { parseDecimal } from '../../lib/units';
import { createExercise } from './actions';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from './useTraining';

/** Search + filter the library, or create a custom exercise on the spot. */
export function ExercisePicker({
  exercises,
  onPick,
  onClose,
  title = 'Add exercise',
}: {
  exercises: Exercise[];
  onPick: (ex: Exercise) => void;
  onClose: () => void;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter(
      (e) => !e.archived && (!muscle || e.muscle === muscle) && (!needle || e.name.toLowerCase().includes(needle)),
    );
  }, [exercises, q, muscle]);

  if (creating) return <CreateExerciseSheet initialName={q} onClose={() => setCreating(false)} onCreated={onPick} />;

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input
          type="search"
          placeholder="Search exercises"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCorrect="off"
          style={{ paddingLeft: 8 }}
        />
      </div>
      <div className="chip-scroll">
        <button type="button" className="chip" aria-pressed={muscle === null} onClick={() => setMuscle(null)}>
          All
        </button>
        {(Object.keys(MUSCLE_LABEL) as MuscleGroup[]).map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(muscle === m ? null : m)}>
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="list picker-list">
        {list.map((e) => (
          <button key={e.id} className="list-row" onClick={() => onPick(e)}>
            <div className="grow">
              <div className="title">{e.name}</div>
              <div className="desc">
                {MUSCLE_LABEL[e.muscle]} · {EQUIPMENT_LABEL[e.equipment]}
              </div>
            </div>
            <span className="trail">
              <Icon name="plus" />
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="empty">No match.</p>}
      </div>
      <button className="btn btn-block" onClick={() => setCreating(true)}>
        <Icon name="plus" />
        Create {q.trim() ? `“${q.trim()}”` : 'custom exercise'}
      </button>
    </Sheet>
  );
}

export function CreateExerciseSheet({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (e: Exercise) => void }) {
  const [name, setName] = useState(initialName.trim());
  const [muscle, setMuscle] = useState<MuscleGroup>('chest');
  const [equipment, setEquipment] = useState<Equipment>('dumbbell');
  const [inc, setInc] = useState('2.5');
  const incNum = parseDecimal(inc);
  const valid = name.trim().length > 1 && incNum !== null && incNum > 0 && incNum <= 20;

  async function save() {
    if (!valid) return;
    const ex = await createExercise({ name: name.trim(), muscle, equipment, bodyweight: equipment === 'bodyweight', incrementKg: incNum! });
    onCreated(ex);
  }

  return (
    <Sheet title="New exercise" onClose={onClose}>
      <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Smith Machine Squat" />
      <div className="field-row">
        <div className="field">
          <label htmlFor="new-muscle">Muscle</label>
          <div className="input-wrap">
            <select id="new-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup)}>
              {(Object.keys(MUSCLE_LABEL) as MuscleGroup[]).map((m) => (
                <option key={m} value={m}>
                  {MUSCLE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="new-equipment">Equipment</label>
          <div className="input-wrap">
            <select id="new-equipment" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
              {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((m) => (
                <option key={m} value={m}>
                  {EQUIPMENT_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <NumberField label="Smallest weight jump" suffix="kg" value={inc} onChange={setInc} hint="Used when suggesting the next weight (e.g. 2.5 for a barbell, 5 for most machines)." />
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Create & add
      </button>
    </Sheet>
  );
}
