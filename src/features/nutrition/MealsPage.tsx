import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { NumberField, TextField } from '../../components/NumberField';
import { SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useSavedMeals } from '../../db/hooks';
import { create, remove, update } from '../../db/repo';
import type { MealItem, MealSlot, SavedMeal } from '../../db/types';
import { mealItemFrom, mealPerServing, mealTotal, rescaleItem, scaleNutrients } from '../../lib/calc/food';
import { Sheet } from '../../components/Sheet';
import { formatInt } from '../../lib/format';
import { parseDecimal, round } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { MiniStepper } from '../workout/MiniStepper';
import { AddFoodSheet } from './AddFoodSheet';
import { MEALS, mealForNow } from './QuickAddSheet';
import './nutrition.css';

/** Edit a recipe / saved meal: ingredients, portions, method, time and diet tags. */
export function MealEditor() {
  const { id } = useParams();
  const meals = useSavedMeals();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const meal = meals?.find((m) => m.id === id);
  if (!meals) return <main className="page" />;
  if (!meal) {
    return (
      <main className="page">
        <SubHeader title="Recipe" back="/nutrition/meals" />
        <p className="muted">Recipe not found.</p>
      </main>
    );
  }

  const save = (patch: Partial<SavedMeal>) => void update('meals', meal.id, patch);
  const setItems = (items: MealItem[]) => save({ items });
  const total = mealTotal(meal);
  const per = mealPerServing(meal);

  return (
    <main className="page">
      <SubHeader title="Edit recipe" back={`/nutrition/meals/${meal.id}`} />
      <TextField
        label="Name"
        value={name ?? meal.name}
        onChange={setName}
      />
      {name !== null && name.trim() && name !== meal.name && (
        <button
          className="btn btn-block"
          onClick={() => {
            save({ name: name.trim() });
            setName(null);
          }}
        >
          Save name
        </button>
      )}
      <div className="field">
        <span className="label">Usually eaten at</span>
        <Segmented<MealSlot | 'any'>
          label="Usual meal"
          value={meal.slot ?? 'any'}
          onChange={(v) => save({ slot: v === 'any' ? null : v })}
          options={[{ value: 'any', label: 'Any' }, ...MEALS.map((m) => ({ ...m, label: m.label.slice(0, 5) === 'Break' ? 'Bkfst' : m.label }))]}
        />
      </div>
      <MiniStepper label="Makes (servings) — for batch cooking" value={meal.servings} min={1} max={14} onChange={(v) => save({ servings: v })} />

      <section className="card">
        <div className="macro-preview">
          <div>
            <b>{formatInt(per.kcal)}</b>
            <span>kcal</span>
          </div>
          <div>
            <b>{round(per.proteinG, 0)}</b>
            <span>protein</span>
          </div>
          <div>
            <b>{round(per.carbsG, 0)}</b>
            <span>carbs</span>
          </div>
          <div>
            <b>{round(per.fatG, 0)}</b>
            <span>fat</span>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 13, textAlign: 'center' }}>
          Per serving{meal.servings > 1 ? ` · whole recipe ${formatInt(total.kcal)} kcal, ${round(total.proteinG, 0)} g protein` : ''}
        </p>
      </section>

      <h2 className="section-title">Ingredients</h2>
      {meal.items.length > 0 && (
        <div className="list">
          {meal.items.map((it) => (
            <div key={it.key} className="list-row ingredient-row">
              <div className="grow">
                <div className="title">{it.name}</div>
                <div className="desc">
                  {it.kcal} kcal · {round(it.proteinG, 1)} g protein
                </div>
              </div>
              {it.grams > 0 && (
                <div className="grams-input input-wrap">
                  <input
                    inputMode="decimal"
                    defaultValue={it.grams}
                    aria-label={`${it.name} grams`}
                    onBlur={(e) => {
                      const g = parseDecimal(e.target.value);
                      if (g !== null && g > 0 && g !== it.grams) setItems(meal.items.map((x) => (x.key === it.key ? rescaleItem(x, g) : x)));
                    }}
                  />
                  <span className="suffix">g</span>
                </div>
              )}
              <button className="icon-btn" onClick={() => setItems(meal.items.filter((x) => x.key !== it.key))} aria-label={`Remove ${it.name}`}>
                <Icon name="x" color="var(--text-3)" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-block" onClick={() => setAdding(true)}>
        <Icon name="plus" /> Add ingredient
      </button>
      {meal.items.length > 0 && (
        <button className="btn btn-primary btn-lg btn-block" onClick={() => setLogging(true)}>
          Log a serving
        </button>
      )}
      <div className="field">
        <label htmlFor="meal-steps">Method — one step per line</label>
        <textarea
          id="meal-steps"
          className="textarea"
          rows={5}
          defaultValue={(meal.steps?.length ? meal.steps : (meal.notes ?? '').split('\n')).join('\n')}
          placeholder={'Cook the rice.\nFry the chicken for 6 minutes a side.\nServe with the veg.'}
          onBlur={(e) => save({ steps: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Time (minutes)"
          decimal={false}
          value={prep ?? (meal.prepMin != null ? String(meal.prepMin) : '')}
          onChange={(v) => {
            setPrep(v);
            const n = parseDecimal(v);
            save({ prepMin: n && n > 0 ? Math.round(n) : null });
          }}
          placeholder="e.g. 20"
        />
        <div className="field">
          <span className="label">Diet</span>
          <div className="chip-wrap">
            {(['vegetarian', 'vegan'] as const).map((t) => {
              const on = (meal.tags ?? []).includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() => {
                    let tags = (meal.tags ?? []).filter((x) => x !== t);
                    if (!on) tags = [...tags, t];
                    if (!on && t === 'vegan' && !tags.includes('vegetarian')) tags.push('vegetarian');
                    save({ tags });
                  }}
                >
                  {t === 'vegan' ? 'Vegan' : 'Vegetarian'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => save({ favourite: !meal.favourite })}>
          <Icon name="star" /> {meal.favourite ? 'Unfavourite' : 'Favourite'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await remove('meals', meal.id);
            toast(`Deleted ${meal.name}`);
            navigate('/nutrition/meals');
          }}
        >
          Delete
        </button>
      </div>

      {adding && (
        <AddFoodSheet
          mode="pick"
          allowMeals={false}
          title="Add ingredient"
          onClose={() => setAdding(false)}
          onPick={(p) => {
            if (p.kind === 'food') setItems([...meal.items, mealItemFrom(p.food, p.grams)]);
            setAdding(false);
          }}
        />
      )}
      {logging && <LogMealSheet meal={meal} date={today} onClose={() => setLogging(false)} />}
    </main>
  );
}

/** Log N servings of a saved meal. */
export function LogMealSheet({ meal, date, onClose }: { meal: SavedMeal; date: string; onClose: () => void }) {
  const toast = useToast();
  const [servings, setServings] = useState('1');
  const [slot, setSlot] = useState<MealSlot>(meal.slot ?? mealForNow());
  const s = parseDecimal(servings);
  const n = s ? scaleNutrients(mealPerServing(meal), s) : null;
  return (
    <Sheet title={`Log ${meal.name}`} onClose={onClose}>
      <NumberField big label="Servings" suffix="servings" value={servings} onChange={setServings} />
      <Segmented label="Meal" value={slot} onChange={setSlot} options={MEALS} />
      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={!n || s! <= 0}
        onClick={async () => {
          await create('foodLogs', { date, meal: slot, name: meal.name, ...n!, savedMealId: meal.id, servings: s, foodId: null, amountG: null });
          toast(`Logged ${n!.kcal} kcal`);
          onClose();
        }}
      >
        {n ? `Log ${n.kcal} kcal` : 'Log'}
      </button>
    </Sheet>
  );
}
