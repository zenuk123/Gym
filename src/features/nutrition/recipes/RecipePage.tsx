import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { SubHeader } from '../../../components/PageHeader';
import { Segmented } from '../../../components/Segmented';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { useSavedMeals } from '../../../db/hooks';
import { update } from '../../../db/repo';
import type { MealSlot, SavedMeal } from '../../../db/types';
import { mealPerServing } from '../../../lib/calc/food';
import { formatQuantity, planMeal } from '../../../lib/calc/plan';
import { recipeTags, TAG_LABEL } from '../../../lib/calc/recipes';
import { addDays, formatDateShort, parseISODate, startOfWeek } from '../../../lib/dates';
import { formatInt } from '../../../lib/format';
import { mealPhotoDataUrl } from '../../../lib/image';
import { round } from '../../../lib/units';
import { useToday } from '../../../lib/useToday';
import { MiniStepper } from '../../workout/MiniStepper';
import { LogMealSheet } from '../MealsPage';
import { addPlanItem } from '../planActions';
import { MEALS } from '../QuickAddSheet';
import { RecipeImage } from './RecipeImage';
import '../nutrition.css';

/** A recipe to read and cook from: photo, macros, ingredients (scaled), method you can tick through. */
export function RecipePage() {
  const { id } = useParams();
  const meals = useSavedMeals();
  const toast = useToast();
  const today = useToday();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cook, setCook] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<'plan' | 'log' | null>(null);
  const [busy, setBusy] = useState(false);
  const meal = meals?.find((m) => m.id === id);
  if (!meals) return <main className="page" />;
  if (!meal)
    return (
      <main className="page">
        <SubHeader title="Recipe" back="/nutrition/meals" />
        <p className="muted">Recipe not found.</p>
      </main>
    );

  const per = mealPerServing(meal);
  const portions = cook ?? meal.servings;
  const factor = portions / Math.max(1, meal.servings);
  const tags = recipeTags(meal);
  const steps = meal.steps?.length ? meal.steps : meal.notes ? meal.notes.split('\n').filter((s) => s.trim()) : [];

  async function setPhoto(file: File) {
    setBusy(true);
    try {
      const image = await mealPhotoDataUrl(file);
      await update('meals', meal!.id, { image });
      toast('Photo added');
    } catch {
      toast('Couldn’t use that photo — try another');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <SubHeader title={meal.source === 'builtin' ? 'Recipe' : 'My recipe'} back="/nutrition/meals" />
      <div className="hero-wrap">
        <RecipeImage meal={meal} size="hero" />
        <button className="btn hero-photo-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="upload" /> {busy ? 'Saving…' : meal.image ? 'Change photo' : 'Add photo'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void setPhoto(f);
            e.target.value = '';
          }}
        />
      </div>

      <div>
        <h1 className="recipe-title">{meal.name}</h1>
        <div className="recipe-meta">
          {meal.prepMin ? <span>⏱ {meal.prepMin} min</span> : null}
          <span>{meal.servings > 1 ? `Makes ${meal.servings} portions` : '1 portion'}</span>
          {meal.slot && <span>{MEALS.find((m) => m.value === meal.slot)?.label}</span>}
        </div>
      </div>
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.map((t) => (
            <span key={t} className="pill">
              {TAG_LABEL[t]}
            </span>
          ))}
        </div>
      )}

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
          Per portion · worked out from the ingredients
        </p>
      </section>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setSheet('plan')} disabled={meal.items.length === 0}>
          <Icon name="calendar" /> Add to plan
        </button>
        <button className="btn" onClick={() => setSheet('log')} disabled={meal.items.length === 0}>
          <Icon name="check" /> Log it
        </button>
      </div>

      <h2 className="section-title section-row">
        <span>Ingredients</span>
      </h2>
      <MiniStepper label="Cooking for (portions)" value={portions} min={1} max={16} onChange={setCook} />
      <section className="card ingredients-card">
        {meal.items.map((it) => (
          <div key={it.key} className="row">
            <span>{it.name}</span>
            <span>{it.grams > 0 ? formatQuantity(it.grams * factor) : ''}</span>
          </div>
        ))}
        {meal.items.length === 0 && <p className="faint">No ingredients yet — tap Edit to add some.</p>}
      </section>

      {steps.length > 0 && (
        <>
          <h2 className="section-title">Method</h2>
          <ol className="steps-list">
            {steps.map((s, i) => (
              <li key={i}>
                <button
                  className={`step${done.has(i) ? ' done' : ''}`}
                  aria-pressed={done.has(i)}
                  onClick={() =>
                    setDone((d) => {
                      const n = new Set(d);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                >
                  <span className="n">{done.has(i) ? '✓' : i + 1}</span>
                  <span>{s}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="faint" style={{ fontSize: 12, padding: '0 4px' }}>
            Tap a step when it’s done.
          </p>
        </>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => void update('meals', meal.id, { favourite: !meal.favourite })}>
          <Icon name="star" /> {meal.favourite ? 'Favourite ★' : 'Favourite'}
        </button>
        <Link to={`/nutrition/meals/${meal.id}/edit`} className="btn">
          <Icon name="edit" /> Edit
        </Link>
      </div>

      {sheet === 'plan' && <PlanRecipeSheet meal={meal} today={today} onClose={() => setSheet(null)} />}
      {sheet === 'log' && <LogMealSheet meal={meal} date={today} onClose={() => setSheet(null)} />}
    </main>
  );
}

/** Add a recipe to the plan: pick a day (this week or next), the meal and portions. */
export function PlanRecipeSheet({ meal, today, onClose }: { meal: SavedMeal; today: string; onClose: () => void }) {
  const toast = useToast();
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfWeek(today), i)).filter((d) => d >= today);
  const [picked, setPicked] = useState<string[]>([today]);
  const [slot, setSlot] = useState<MealSlot>(meal.slot ?? 'dinner');
  const [portions, setPortions] = useState(1);
  const n = mealPerServing(meal);
  return (
    <Sheet title={`Plan · ${meal.name}`} onClose={onClose}>
      <div className="field">
        <span className="label">Days {meal.servings > 1 && <span className="faint">· this recipe makes {meal.servings} portions</span>}</span>
        <div className="chip-wrap">
          {days.map((d) => (
            <button key={d} className="chip" aria-pressed={picked.includes(d)} onClick={() => setPicked((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}>
              {d === today ? 'Today' : parseISODate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
      </div>
      <Segmented label="Meal" value={slot} onChange={setSlot} options={MEALS} />
      <MiniStepper label="Portions each time" value={portions} min={1} max={4} onChange={setPortions} />
      <p className="faint" style={{ fontSize: 13 }}>
        {formatInt(n.kcal * portions)} kcal · {formatInt(n.proteinG * portions)} g protein each day
      </p>
      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={picked.length === 0}
        onClick={async () => {
          for (const d of [...picked].sort()) await addPlanItem(planMeal(d, slot, meal, portions));
          toast(picked.length === 1 ? `Planned for ${picked[0] === today ? 'today' : formatDateShort(picked[0])}` : `Planned on ${picked.length} days`);
          onClose();
        }}
      >
        Add to {picked.length || ''} {picked.length === 1 ? 'day' : 'days'}
      </button>
    </Sheet>
  );
}
