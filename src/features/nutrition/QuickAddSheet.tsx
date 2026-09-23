import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { NumberField, TextField } from '../../components/NumberField';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { create, remove } from '../../db/repo';
import type { ISODate, MealSlot } from '../../db/types';
import { parseDecimal } from '../../lib/units';

export const MEALS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

function mealForNow(): MealSlot {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

/**
 * Quick-add calories + macros. The full food database arrives in Phase 4;
 * quick entries stay valid alongside it.
 */
export function QuickAddSheet({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const toast = useToast();
  const [meal, setMeal] = useState<MealSlot>(mealForNow);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const k = parseDecimal(kcal);
  const p = parseDecimal(protein || '0');
  const valid = k !== null && k > 0 && k < 10000 && p !== null && p >= 0 && p < 1000;
  const opt = (s: string) => (s.trim() === '' ? null : parseDecimal(s));

  async function save() {
    if (!valid) return;
    const rec = await create('foodLogs', {
      date,
      meal,
      name: name.trim() || 'Quick add',
      kcal: Math.round(k!),
      proteinG: p!,
      carbsG: opt(carbs),
      fatG: opt(fat),
      fibreG: null,
    });
    toast(`Added ${Math.round(k!)} kcal`, { label: 'Undo', run: () => void remove('foodLogs', rec.id) });
    onClose();
  }

  return (
    <Sheet title="Quick add food" onClose={onClose}>
      <Segmented label="Meal" value={meal} onChange={setMeal} options={MEALS} />
      <TextField label="What did you eat? (optional)" value={name} onChange={setName} placeholder="Chicken & rice" />
      <div className="field-row">
        <NumberField label="Calories" suffix="kcal" decimal={false} value={kcal} onChange={setKcal} placeholder="650" />
        <NumberField label="Protein" suffix="g" value={protein} onChange={setProtein} placeholder="45" />
      </div>
      <div className="field-row">
        <NumberField label="Carbs (optional)" suffix="g" value={carbs} onChange={setCarbs} />
        <NumberField label="Fat (optional)" suffix="g" value={fat} onChange={setFat} />
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Add to {MEALS.find((m) => m.value === meal)!.label.toLowerCase()}
      </button>
    </Sheet>
  );
}
