import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar } from '../../components/ProgressBar';
import { useToast } from '../../components/Toast';
import { useFoodLogs } from '../../db/hooks';
import { create, remove } from '../../db/repo';
import type { FoodLog, Profile } from '../../db/types';
import { addDays, relativeDay } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { macroTargets, sumIntake } from '../../lib/intake';
import { useToday } from '../../lib/useToday';
import { MEALS, QuickAddSheet } from './QuickAddSheet';

export function NutritionPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const logs = useFoodLogs(date);
  const intake = useMemo(() => sumIntake(logs ?? []), [logs]);
  const macros = macroTargets(profile);

  const rows = [
    { name: 'Calories', value: intake.kcal, target: profile.calorieTarget, unit: 'kcal', tone: 'var(--kcal)' },
    { name: 'Protein', value: intake.proteinG, target: profile.proteinTarget, unit: 'g', tone: 'var(--protein)' },
    { name: 'Carbs', value: intake.carbsG, target: macros.carbsG, unit: 'g', tone: 'var(--carbs)' },
    { name: 'Fat', value: intake.fatG, target: macros.fatG, unit: 'g', tone: 'var(--fat)' },
  ];

  async function del(l: FoodLog) {
    await remove('foodLogs', l.id);
    toast(`Removed ${l.name}`, {
      label: 'Undo',
      run: () => {
        const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = l;
        void create('foodLogs', rest);
      },
    });
  }

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add
          </button>
        }
      />

      <div className="day-switch">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <Icon name="chevronLeft" />
        </button>
        <span>{relativeDay(date, today)}</span>
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
      </section>

      {MEALS.map((m) => {
        const items = (logs ?? []).filter((l) => l.meal === m.value);
        const kcal = items.reduce((s, l) => s + l.kcal, 0);
        return (
          <section key={m.value}>
            <h2 className="section-title" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>{m.label}</span>
              {kcal > 0 && <span className="num">{formatInt(kcal)} kcal</span>}
            </h2>
            {items.length > 0 ? (
              <div className="list">
                {items.map((l) => (
                  <div key={l.id} className="list-row">
                    <div className="grow">
                      <div className="title">{l.name}</div>
                      <div className="desc">
                        {formatInt(l.kcal)} kcal · {formatInt(l.proteinG)} g protein
                        {l.carbsG != null && ` · ${formatInt(l.carbsG)} g carbs`}
                        {l.fatG != null && ` · ${formatInt(l.fatG)} g fat`}
                      </div>
                    </div>
                    <button className="icon-btn" onClick={() => void del(l)} aria-label={`Delete ${l.name}`}>
                      <Icon name="trash" width={20} height={20} color="var(--text-3)" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 14, padding: '10px 4px 0' }}>
                Nothing logged.
              </p>
            )}
          </section>
        );
      })}

      <div className="banner" style={{ marginTop: 8 }}>
        <span className="banner-icon">
          <Icon name="sparkles" />
        </span>
        <div className="grow muted">Food database, saved meals, meal planner, shopping lists and AI meal ideas are planned for Phases 4–5.</div>
      </div>

      {adding && <QuickAddSheet date={date} onClose={() => setAdding(false)} />}
    </main>
  );
}
