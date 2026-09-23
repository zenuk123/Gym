import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar } from '../../components/ProgressBar';
import { useToast } from '../../components/Toast';
import { db } from '../../db/db';
import { useFoodLogs } from '../../db/hooks';
import { create } from '../../db/repo';
import type { FoodLog, MealItem, MealSlot, Profile } from '../../db/types';
import { addDays, relativeDay, todayISO } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { newId } from '../../lib/id';
import { macroTargets, sumIntake } from '../../lib/intake';
import { round } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { AddFoodSheet } from './AddFoodSheet';
import { EditLogSheet } from './EditLogSheet';
import { NutritionTabs } from './NutritionTabs';
import { MEALS } from './QuickAddSheet';
import './nutrition.css';

/** Daily food log: totals vs targets, then each meal with add / copy-yesterday / save-as-meal. */
export function NutritionPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const navigate = useNavigate();
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState<{ slot?: MealSlot } | null>(null);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const logs = useFoodLogs(date);
  const intake = useMemo(() => sumIntake(logs ?? []), [logs]);
  const macros = macroTargets(profile);

  const rows = [
    { name: 'Calories', value: intake.kcal, target: profile.calorieTarget, unit: 'kcal', tone: 'var(--kcal)' },
    { name: 'Protein', value: intake.proteinG, target: profile.proteinTarget, unit: 'g', tone: 'var(--protein)' },
    { name: 'Carbs', value: intake.carbsG, target: macros.carbsG, unit: 'g', tone: 'var(--carbs)' },
    { name: 'Fat', value: intake.fatG, target: macros.fatG, unit: 'g', tone: 'var(--fat)' },
  ];

  async function copyYesterday(slot: MealSlot) {
    const prev = addDays(date, -1);
    const src = (await db.foodLogs.where('date').equals(prev).toArray()).filter((l) => l.deletedAt === null && l.meal === slot);
    if (src.length === 0) return toast(`Nothing logged for ${slot} ${relativeDay(prev, today).toLowerCase()}`);
    for (const l of src) {
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = l;
      await create('foodLogs', { ...rest, date });
    }
    toast(`Copied ${src.length} item${src.length === 1 ? '' : 's'}`);
  }

  async function saveAsMeal(slot: MealSlot, items: FoodLog[]) {
    const mealItems: MealItem[] = items.map((l) => ({
      key: newId(),
      foodId: l.foodId ?? null,
      name: l.name,
      grams: l.amountG ?? 0,
      category: 'other',
      kcal: l.kcal,
      proteinG: l.proteinG,
      carbsG: l.carbsG ?? 0,
      fatG: l.fatG ?? 0,
      fibreG: l.fibreG ?? null,
    }));
    // Pick up shopping categories from the source foods.
    for (const it of mealItems) {
      if (it.foodId) it.category = (await db.foods.get(it.foodId))?.category ?? 'other';
    }
    const m = await create('meals', { name: `My ${slot}`, slot, servings: 1, items: mealItems, notes: null, favourite: false });
    toast('Saved as a meal — rename it if you like');
    navigate(`/nutrition/meals/${m.id}`);
  }

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => setAdding({})}>
            <Icon name="plus" />
            Add
          </button>
        }
      />
      <NutritionTabs />

      <div className="day-switch">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <Icon name="chevronLeft" />
        </button>
        <label className="day-label">
          {relativeDay(date, today)}
          <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a date" />
        </label>
        <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
          <Icon name="chevronRight" />
        </button>
      </div>

      <section className="card">
        {rows.map((r) => (
          <div key={r.name} className="macro-row">
            <div className="top">
              <span className="name">{r.name}</span>
              <span className="amount">
                <b>{formatInt(r.value)}</b> / {formatInt(r.target)} {r.unit}
              </span>
            </div>
            <ProgressBar value={r.value} max={r.target} tone={r.tone} allowOver={r.name === 'Calories'} />
          </div>
        ))}
        <p className="faint" style={{ fontSize: 13 }}>
          {intake.kcal <= profile.calorieTarget
            ? `${formatInt(profile.calorieTarget - intake.kcal)} kcal left`
            : `${formatInt(intake.kcal - profile.calorieTarget)} kcal over`}
          {' · '}
          {intake.proteinG < profile.proteinTarget ? `${formatInt(profile.proteinTarget - intake.proteinG)} g protein to go` : 'protein target hit ✓'}
          {intake.fibreG > 0 && ` · ${round(intake.fibreG, 0)} g fibre`}
        </p>
      </section>

      {MEALS.map((m) => {
        const items = (logs ?? []).filter((l) => l.meal === m.value);
        const kcal = items.reduce((s, l) => s + l.kcal, 0);
        const protein = items.reduce((s, l) => s + l.proteinG, 0);
        return (
          <section key={m.value} className="meal-block">
            <div className="meal-head">
              <h2>{m.label}</h2>
              {kcal > 0 && (
                <span className="meal-sum">
                  {formatInt(kcal)} kcal · {formatInt(protein)} g P
                </span>
              )}
            </div>
            {items.length > 0 && (
              <div className="list">
                {items.map((l) => (
                  <button key={l.id} className="list-row" onClick={() => setEditing(l)}>
                    <div className="grow">
                      <div className="title">{l.name}</div>
                      <div className="desc">
                        {l.amountG != null ? `${round(l.amountG, 0)} g · ` : l.servings != null ? `${l.servings} serving${l.servings === 1 ? '' : 's'} · ` : ''}
                        {formatInt(l.proteinG)} g protein
                        {l.carbsG != null && ` · ${formatInt(l.carbsG)} C`}
                        {l.fatG != null && ` · ${formatInt(l.fatG)} F`}
                      </div>
                    </div>
                    <span className="trail">{formatInt(l.kcal)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="meal-actions">
              <button className="chip" onClick={() => setAdding({ slot: m.value })}>
                <Icon name="plus" width={16} height={16} /> Add
              </button>
              {items.length === 0 ? (
                <button className="chip" onClick={() => void copyYesterday(m.value)}>
                  <Icon name="copy" width={16} height={16} /> Same as yesterday
                </button>
              ) : (
                <button className="chip" onClick={() => void saveAsMeal(m.value, items)}>
                  <Icon name="star" width={16} height={16} /> Save as meal
                </button>
              )}
            </div>
          </section>
        );
      })}

      {adding && <AddFoodSheet date={date} initialSlot={adding.slot} onClose={() => setAdding(null)} />}
      {editing && <EditLogSheet log={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}
