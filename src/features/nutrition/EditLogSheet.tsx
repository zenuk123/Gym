import { useState } from 'react';
import { NumberField, TextField } from '../../components/NumberField';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { Food, FoodLog, MealSlot } from '../../db/types';
import { describeAmount, nutritionFor } from '../../lib/calc/food';
import { parseDecimal, round } from '../../lib/units';
import { MEALS } from './QuickAddSheet';
import { useLiveQuery } from 'dexie-react-hooks';

/** Edit a logged entry: change the amount (food-based) or the numbers (quick add), move meal, delete. */
export function EditLogSheet({ log, onClose }: { log: FoodLog; onClose: () => void }) {
  const toast = useToast();
  const food = useLiveQuery(async () => (log.foodId ? ((await db.foods.get(log.foodId)) ?? null) : null), [log.foodId]);
  const [slot, setSlot] = useState<MealSlot>(log.meal);
  const [grams, setGrams] = useState(log.amountG != null ? String(log.amountG) : '');
  const [servings, setServings] = useState(log.servings != null ? String(log.servings) : '');
  const [name, setName] = useState(log.name);
  const [kcal, setKcal] = useState(String(log.kcal));
  const [protein, setProtein] = useState(String(log.proteinG));
  const [carbs, setCarbs] = useState(log.carbsG != null ? String(log.carbsG) : '');
  const [fat, setFat] = useState(log.fatG != null ? String(log.fatG) : '');

  const byFood = !!food && log.amountG != null;
  const byMeal = log.savedMealId != null && log.servings != null && log.servings > 0;

  async function save() {
    let patch: Partial<FoodLog> = { meal: slot };
    if (byFood) {
      const g = parseDecimal(grams);
      if (g === null || g <= 0) return;
      patch = { ...patch, amountG: g, ...nutritionFor(food as Food, g) };
    } else if (byMeal) {
      const s = parseDecimal(servings);
      if (s === null || s <= 0) return;
      const f = s / log.servings!;
      patch = {
        ...patch,
        servings: s,
        kcal: Math.round(log.kcal * f),
        proteinG: round(log.proteinG * f, 1),
        carbsG: log.carbsG === null ? null : round(log.carbsG * f, 1),
        fatG: log.fatG === null ? null : round(log.fatG * f, 1),
        fibreG: log.fibreG == null ? null : round(log.fibreG * f, 1),
      };
    } else {
      const k = parseDecimal(kcal);
      const p = parseDecimal(protein || '0');
      if (k === null || p === null) return;
      patch = { ...patch, name: name.trim() || log.name, kcal: Math.round(k), proteinG: p, carbsG: carbs.trim() ? parseDecimal(carbs) : null, fatG: fat.trim() ? parseDecimal(fat) : null };
    }
    await update('foodLogs', log.id, patch);
    toast('Updated');
    onClose();
  }

  return (
    <Sheet title={log.name} onClose={onClose}>
      <Segmented label="Meal" value={slot} onChange={setSlot} options={MEALS} />
      {byFood ? (
        <NumberField big label="Amount" suffix={(food as Food).unit} value={grams} onChange={setGrams} hint={describeAmount(food as Food, parseDecimal(grams) ?? 0)} />
      ) : byMeal ? (
        <NumberField big label="Servings" suffix="servings" value={servings} onChange={setServings} />
      ) : (
        <>
          <TextField label="Name" value={name} onChange={setName} />
          <div className="field-row">
            <NumberField label="Calories" suffix="kcal" decimal={false} value={kcal} onChange={setKcal} />
            <NumberField label="Protein" suffix="g" value={protein} onChange={setProtein} />
          </div>
          <div className="field-row">
            <NumberField label="Carbs" suffix="g" value={carbs} onChange={setCarbs} />
            <NumberField label="Fat" suffix="g" value={fat} onChange={setFat} />
          </div>
        </>
      )}
      <button className="btn btn-primary btn-lg btn-block" onClick={() => void save()}>
        Save
      </button>
      <div className="btn-row">
        <button
          className="btn"
          onClick={async () => {
            const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = log;
            await create('foodLogs', rest);
            toast('Added again');
            onClose();
          }}
        >
          Log again
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            await remove('foodLogs', log.id);
            toast(`Removed ${log.name}`, { label: 'Undo', run: () => void update('foodLogs', log.id, { deletedAt: null }) });
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}
