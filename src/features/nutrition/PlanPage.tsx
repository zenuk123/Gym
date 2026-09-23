import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { MiniStepper } from '../workout/MiniStepper';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar } from '../../components/ProgressBar';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { usePlanItems, useSavedMeals } from '../../db/hooks';
import { remove, update } from '../../db/repo';
import type { MealSlot, PlanItem, Profile, SavedMeal } from '../../db/types';
import { mealPerServing } from '../../lib/calc/food';
import { dayTotals, planFood, planMeal } from '../../lib/calc/plan';
import { addDays, formatDateShort, parseISODate, startOfWeek } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { round } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { AddFoodSheet } from './AddFoodSheet';
import { NutritionTabs } from './NutritionTabs';
import { MEALS } from './QuickAddSheet';
import { addPlanItem, clearWeek, copyPreviousWeek, copyToDays, markEaten, mealPrep, unmarkEaten } from './planActions';
import './nutrition.css';

/** Weekly meal planner: Monday → Sunday, breakfast / lunch / dinner / snacks, with day totals vs targets. */
export function PlanPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const weekEnd = addDays(weekStart, 6);
  const items = usePlanItems(weekStart, weekEnd);
  const [adding, setAdding] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [selected, setSelected] = useState<PlanItem | null>(null);
  const [prepping, setPrepping] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const p of items ?? []) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return m;
  }, [items]);
  const planned = days.filter((d) => (byDay.get(d) ?? []).length > 0);
  const avg = planned.length ? dayTotals(planned.map((d) => dayTotals(byDay.get(d)!)).map((t) => ({ ...t }))) : null;

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => setPrepping(true)}>
            <Icon name="calendar" />
            Meal prep
          </button>
        }
      />
      <NutritionTabs />

      <div className="day-switch">
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
          <Icon name="chevronLeft" />
        </button>
        <span>{weekStart === startOfWeek(today) ? 'This week' : `Week of ${formatDateShort(weekStart)}`}</span>
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
          <Icon name="chevronRight" />
        </button>
      </div>

      {avg && (
        <section className="card plan-summary">
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Avg planned / day</div>
              <div className="value">{formatInt(avg.kcal / planned.length)} kcal</div>
              <div className="stat-sub">target {formatInt(profile.calorieTarget)}</div>
            </div>
            <div className="stat">
              <div className="label">Protein / day</div>
              <div className="value">{formatInt(avg.proteinG / planned.length)} g</div>
              <div className="stat-sub">target {profile.proteinTarget} g</div>
            </div>
            <div className="stat">
              <div className="label">Days planned</div>
              <div className="value">{planned.length}/7</div>
            </div>
          </div>
          <Link to="/nutrition/shopping" className="btn btn-block">
            <Icon name="cart" /> Shopping list for this week
          </Link>
        </section>
      )}

      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const t = dayTotals(list);
        const isToday = d === today;
        return (
          <section key={d} className={`card plan-day${isToday ? ' today' : ''}`}>
            <div className="plan-day-head">
              <div>
                <b>{parseISODate(d).toLocaleDateString('en-GB', { weekday: 'long' })}</b>
                <span className="faint"> {formatDateShort(d)}</span>
                {isToday && <span className="pill good" style={{ marginLeft: 6 }}>Today</span>}
              </div>
              <span className="plan-day-sum">
                {formatInt(t.kcal)} kcal · {formatInt(t.proteinG)} g P
              </span>
            </div>
            {list.length > 0 && <ProgressBar value={t.kcal} max={profile.calorieTarget} tone="var(--kcal)" allowOver />}
            {MEALS.map((m) => {
              const slotItems = list.filter((p) => p.slot === m.value);
              return (
                <div key={m.value} className="plan-slot">
                  <span className="plan-slot-name">{m.label}</span>
                  <div className="plan-slot-items">
                    {slotItems.map((p) => (
                      <button key={p.id} className={`plan-item${p.loggedId ? ' eaten' : ''}`} onClick={() => setSelected(p)}>
                        <span className="name">
                          {p.loggedId && '✓ '}
                          {p.name}
                        </span>
                        <span className="kcal">{formatInt(p.kcal)}</span>
                      </button>
                    ))}
                    <button className="plan-add" onClick={() => setAdding({ date: d, slot: m.value })} aria-label={`Plan ${m.label.toLowerCase()} on ${formatDateShort(d)}`}>
                      <Icon name="plus" width={16} height={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="btn-row">
        <button
          className="btn"
          onClick={async () => {
            const n = await copyPreviousWeek(weekStart);
            toast(n ? `Copied ${n} planned meals from last week` : 'Nothing planned last week');
          }}
        >
          <Icon name="copy" /> Copy last week
        </button>
        {confirmClear ? (
          <button
            className="btn btn-danger"
            onClick={async () => {
              await clearWeek(weekStart);
              setConfirmClear(false);
              toast('Week cleared');
            }}
          >
            Really clear?
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmClear(true)}>
            Clear week
          </button>
        )}
      </div>
      <Link to="/more/coach?prompt=plan" className="btn btn-ghost btn-block">
        <Icon name="sparkles" /> Ask the AI coach for meal ideas
      </Link>

      {adding && (
        <AddFoodSheet
          mode="pick"
          initialSlot={adding.slot}
          title={`Plan · ${formatDateShort(adding.date)}`}
          onClose={() => setAdding(null)}
          onPick={async (p, slot) => {
            await addPlanItem(p.kind === 'food' ? planFood(adding.date, slot, p.food, p.grams) : planMeal(adding.date, slot, p.meal, p.servings));
            toast(`Planned ${p.kind === 'food' ? p.food.name : p.meal.name}`);
            setAdding(null);
          }}
        />
      )}
      {selected && <PlanItemSheet item={selected} weekDays={days} onClose={() => setSelected(null)} />}
      {prepping && <MealPrepSheet startDate={weekStart < today && addDays(weekStart, 6) >= today ? today : weekStart} onClose={() => setPrepping(false)} />}
    </main>
  );
}

function PlanItemSheet({ item, weekDays, onClose }: { item: PlanItem; weekDays: string[]; onClose: () => void }) {
  const toast = useToast();
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const others = weekDays.filter((d) => d !== item.date);
  return (
    <Sheet title={item.name} onClose={onClose}>
      <p className="muted" style={{ fontSize: 14 }}>
        {formatDateShort(item.date)} · {MEALS.find((m) => m.value === item.slot)!.label} · {formatInt(item.kcal)} kcal · {round(item.proteinG, 0)} g protein
        {item.servings ? ` · ${item.servings} serving${item.servings === 1 ? '' : 's'}` : item.amountG ? ` · ${item.amountG} g` : ''}
      </p>
      {item.items.length > 1 && (
        <ul className="ingredient-list">
          {item.items.map((i) => (
            <li key={i.key}>
              {i.name}
              <span className="faint">{i.grams > 0 ? ` ${i.grams} g` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        className={`btn btn-lg btn-block${item.loggedId ? '' : ' btn-primary'}`}
        onClick={async () => {
          if (item.loggedId) await unmarkEaten(item);
          else await markEaten(item);
          toast(item.loggedId ? 'Removed from your log' : 'Logged as eaten ✓');
          onClose();
        }}
      >
        <Icon name="check" /> {item.loggedId ? 'Not eaten after all' : 'Mark as eaten (logs it)'}
      </button>
      <div className="field">
        <span className="label">Also plan it on</span>
        <div className="chip-wrap">
          {others.map((d) => (
            <button
              key={d}
              className="chip"
              aria-pressed={copyTo.includes(d)}
              onClick={() => setCopyTo((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
            >
              {parseISODate(d).toLocaleDateString('en-GB', { weekday: 'short' })}
            </button>
          ))}
        </div>
      </div>
      {copyTo.length > 0 && (
        <button
          className="btn btn-block"
          onClick={async () => {
            await copyToDays(item, copyTo);
            toast(`Planned on ${copyTo.length} more day${copyTo.length === 1 ? '' : 's'}`);
            onClose();
          }}
        >
          <Icon name="copy" /> Copy to {copyTo.length} day{copyTo.length === 1 ? '' : 's'}
        </button>
      )}
      <Segmented
        label="Move to meal"
        value={item.slot}
        onChange={async (s) => {
          await update('planItems', item.id, { slot: s });
          onClose();
        }}
        options={MEALS}
      />
      <button
        className="btn btn-ghost btn-block"
        onClick={async () => {
          await remove('planItems', item.id);
          onClose();
        }}
      >
        Remove from plan
      </button>
    </Sheet>
  );
}

/** Batch-cook a saved recipe and spread the portions over the next few days. */
function MealPrepSheet({ startDate, onClose }: { startDate: string; onClose: () => void }) {
  const meals = useSavedMeals();
  const toast = useToast();
  const [meal, setMeal] = useState<SavedMeal | null>(null);
  const [portions, setPortions] = useState(4);
  const [slot, setSlot] = useState<MealSlot>('lunch');
  const [start, setStart] = useState(startDate);

  return (
    <Sheet title="Meal prep" onClose={onClose}>
      {!meal ? (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            Cook once, eat all week: pick a saved recipe and the portions are spread across the next days.
          </p>
          <div className="list picker-list">
            {(meals ?? []).map((m) => {
              const n = mealPerServing(m);
              return (
                <button
                  key={m.id}
                  className="list-row"
                  onClick={() => {
                    setMeal(m);
                    setPortions(Math.max(1, Math.min(7, m.servings)));
                    setSlot(m.slot ?? 'lunch');
                  }}
                >
                  <div className="grow">
                    <div className="title">{m.name}</div>
                    <div className="desc">
                      {n.kcal} kcal · {round(n.proteinG, 0)} g protein per serving{m.servings > 1 ? ` · makes ${m.servings}` : ''}
                    </div>
                  </div>
                  <span className="trail">
                    <Icon name="chevronRight" />
                  </span>
                </button>
              );
            })}
            {(meals ?? []).length === 0 && <p className="empty">Save a recipe in Meals first (set “Makes” to the number of portions).</p>}
          </div>
          <Link to="/nutrition/meals" className="btn btn-block">
            Go to Meals
          </Link>
        </>
      ) : (
        <>
          <p className="muted">{meal.name}</p>
          <MiniStepper label="Portions" value={portions} min={1} max={7} onChange={setPortions} />
          <Segmented label="Meal" value={slot} onChange={setSlot} options={MEALS} />
          <div className="field">
            <label htmlFor="prep-start">Starting</label>
            <div className="input-wrap">
              <input id="prep-start" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            </div>
          </div>
          <p className="faint" style={{ fontSize: 13 }}>
            {formatDateShort(start)} → {formatDateShort(addDays(start, portions - 1))} · {mealPerServing(meal).kcal} kcal per portion
          </p>
          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={async () => {
              await mealPrep(meal, start, portions, slot);
              toast(`Planned ${portions} portions of ${meal.name}`);
              onClose();
            }}
          >
            Plan {portions} portions
          </button>
        </>
      )}
    </Sheet>
  );
}
