import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { NumberField, TextField } from '../../components/NumberField';
import { PageHeader, SubHeader } from '../../components/PageHeader';
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
import { NutritionTabs } from './NutritionTabs';
import { MEALS, mealForNow } from './QuickAddSheet';
import './nutrition.css';

/** Saved meals & recipes — log in one tap, plan them, or batch-cook for the week. */
export function MealsPage() {
  const meals = useSavedMeals();
  const navigate = useNavigate();
  if (!meals) return <main className="page" />;

  async function newMeal() {
    const m = await create('meals', { name: 'New meal', slot: null, servings: 1, items: [], notes: null, favourite: false });
    navigate(`/nutrition/meals/${m.id}`);
  }

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => void newMeal()}>
            <Icon name="plus" />
            Meal
          </button>
        }
      />
      <NutritionTabs />
      {meals.length === 0 ? (
        <section className="card">
          <EmptyState icon="utensils">
            <b className="empty-title">Save meals you eat often</b>
            Build one here, or tap “Save as meal” under any meal in your log. Recipes can make several portions for meal prep.
          </EmptyState>
          <button className="btn btn-block" onClick={() => void newMeal()}>
            <Icon name="plus" /> New meal
          </button>
        </section>
      ) : (
        <div className="list">
          {meals.map((m) => {
            const n = mealPerServing(m);
            return (
              <Link key={m.id} to={`/nutrition/meals/${m.id}`} className="list-row">
                <div className="grow">
                  <div className="title">
                    {m.name}
                    {m.favourite && <span className="star">★</span>}
                  </div>
                  <div className="desc">
                    {n.kcal} kcal · {round(n.proteinG, 0)} g protein per serving
                    {m.servings > 1 && ` · makes ${m.servings}`}
                  </div>
                </div>
                <span className="trail">
                  <Icon name="chevronRight" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

export function MealEditor() {
  const { id } = useParams();
  const meals = useSavedMeals();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const meal = meals?.find((m) => m.id === id);
  if (!meals) return <main className="page" />;
  if (!meal) {
    return (
      <main className="page">
        <SubHeader title="Meal" back="/nutrition/meals" />
        <p className="muted">Meal not found.</p>
      </main>
    );
  }

  const save = (patch: Partial<SavedMeal>) => void update('meals', meal.id, patch);
  const setItems = (items: MealItem[]) => save({ items });
  const total = mealTotal(meal);
  const per = mealPerServing(meal);

  return (
    <main className="page">
      <SubHeader title="Meal" back="/nutrition/meals" />
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
        <label htmlFor="meal-notes">Notes / method</label>
        <textarea id="meal-notes" className="textarea" rows={3} defaultValue={meal.notes ?? ''} onBlur={(e) => save({ notes: e.target.value.trim() || null })} />
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
function LogMealSheet({ meal, date, onClose }: { meal: SavedMeal; date: string; onClose: () => void }) {
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
