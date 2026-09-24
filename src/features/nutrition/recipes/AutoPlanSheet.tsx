import { useMemo, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import { useSavedMeals } from '../../../db/hooks';
import type { MealSlot, PlanItem, Profile, RecipeTag } from '../../../db/types';
import { planMeal } from '../../../lib/calc/plan';
import { autoPlan, dayKcal, SLOT_SHARE, swapOptions, TAG_LABEL, type Proposal } from '../../../lib/calc/recipes';
import { parseISODate } from '../../../lib/dates';
import { formatInt } from '../../../lib/format';
import { addPlanItem } from '../planActions';
import { MEALS } from '../QuickAddSheet';
import { RecipeImage } from './RecipeImage';

const DIETS: RecipeTag[] = ['vegetarian', 'vegan', 'quick', 'high-protein'];

/**
 * "Plan my week for me": fills the empty meals of the chosen days with recipes that land near
 * your calorie and protein targets. Shows a preview you can swap / remove from before saving.
 */
export function AutoPlanSheet({ profile, days, existing, onClose }: { profile: Profile; days: string[]; existing: PlanItem[]; onClose: () => void }) {
  const toast = useToast();
  const meals = useSavedMeals();
  const [slots, setSlots] = useState<MealSlot[]>(['breakfast', 'lunch', 'dinner', 'snack']);
  const [require, setRequire] = useState<RecipeTag[]>([]);
  const [seed, setSeed] = useState(1);
  const [edits, setEdits] = useState<Record<string, Proposal | null>>({});
  const [saving, setSaving] = useState(false);
  const target = { kcal: profile.calorieTarget, proteinG: profile.proteinTarget };

  const base = useMemo(
    () => (meals ? autoPlan({ recipes: meals, days, slots, existing, target: { kcal: profile.calorieTarget, proteinG: profile.proteinTarget }, require, seed }) : []),
    [meals, days, slots, existing, require, seed, profile.calorieTarget, profile.proteinTarget],
  );
  const keyOf = (p: Pick<Proposal, 'date' | 'slot'>) => `${p.date}|${p.slot}`;
  const proposals = base.map((p) => (keyOf(p) in edits ? edits[keyOf(p)] : p)).filter((p): p is Proposal => p !== null);
  const byId = new Map((meals ?? []).map((m) => [m.id, m]));

  function reset(patch: () => void) {
    patch();
    setEdits({});
  }

  function swap(p: Proposal) {
    const others = proposals.filter((x) => x.date === p.date && x !== p);
    const used = dayKcal(p.date, others, existing);
    // A swap should fill what the day still needs after its other meals (never more than ~1.5× a normal share).
    const budget = Math.min(Math.max(100, target.kcal - used.kcal), target.kcal * SLOT_SHARE[p.slot] * 1.5);
    const opts = swapOptions(meals ?? [], p.slot, budget, Math.max(0, target.proteinG - used.proteinG) * 0.5, null, 6);
    if (!opts.length) return;
    const i = opts.findIndex((o) => o.meal.id === p.mealId);
    const next = opts[(i + 1) % opts.length];
    setEdits((e) => ({ ...e, [keyOf(p)]: { ...p, mealId: next.meal.id, servings: next.servings, kcal: Math.round(next.kcal), proteinG: Math.round(next.proteinG) } }));
  }

  async function save() {
    setSaving(true);
    for (const p of proposals) {
      const m = byId.get(p.mealId);
      if (m) await addPlanItem(planMeal(p.date, p.slot, m, p.servings));
    }
    toast(`Planned ${proposals.length} meals — your shopping list can build from them`);
    onClose();
  }

  const planDays = days.filter((d) => proposals.some((p) => p.date === d));

  return (
    <Sheet title="Plan my week" onClose={onClose}>
      <div className="field">
        <span className="label">Fill these meals</span>
        <div className="chip-wrap">
          {MEALS.map((m) => (
            <button
              key={m.value}
              className="chip"
              aria-pressed={slots.includes(m.value)}
              onClick={() => reset(() => setSlots((s) => (s.includes(m.value) ? s.filter((x) => x !== m.value) : [...s, m.value])))}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Only recipes that are</span>
        <div className="chip-wrap">
          {DIETS.map((t) => (
            <button key={t} className="chip" aria-pressed={require.includes(t)} onClick={() => reset(() => setRequire((r) => (r.includes(t) ? r.filter((x) => x !== t) : [...r, t])))}>
              {TAG_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        <span className="pill kind-suggestion">Suggestion</span> Aiming for about {formatInt(target.kcal)} kcal and {formatInt(target.proteinG)} g protein a day. Meals you’ve already
        planned are kept. Tap <b>Swap</b> for something else.
      </p>

      {planDays.length === 0 ? (
        <p className="muted">{meals ? 'Nothing to fill — those meals are already planned, or no recipes match the filters.' : 'Loading recipes…'}</p>
      ) : (
        planDays.map((d) => {
          const t = dayKcal(d, proposals, existing);
          return (
            <section key={d} className="autoplan-day">
              <div className="autoplan-head">
                <b>{parseISODate(d).toLocaleDateString('en-GB', { weekday: 'long' })}</b>
                <span className={Math.abs(t.kcal - target.kcal) / target.kcal <= 0.1 ? 'on-target' : 'faint'}>
                  {formatInt(t.kcal)} kcal · {formatInt(t.proteinG)} g P
                </span>
              </div>
              {proposals
                .filter((p) => p.date === d)
                .sort((a, b) => MEALS.findIndex((m) => m.value === a.slot) - MEALS.findIndex((m) => m.value === b.slot))
                .map((p) => {
                  const m = byId.get(p.mealId);
                  if (!m) return null;
                  return (
                    <div key={keyOf(p)} className="autoplan-row">
                      <RecipeImage meal={m} size="thumb" />
                      <div className="grow">
                        <div className="title">{m.name}</div>
                        <div className="desc">
                          {MEALS.find((x) => x.value === p.slot)?.label} · {formatInt(p.kcal)} kcal · {formatInt(p.proteinG)} g P{p.servings !== 1 ? ` · ×${p.servings}` : ''}
                        </div>
                      </div>
                      <button className="chip" onClick={() => swap(p)} aria-label={`Swap ${m.name}`}>
                        <Icon name="refresh" width={14} height={14} /> Swap
                      </button>
                      <button className="icon-btn" onClick={() => setEdits((e) => ({ ...e, [keyOf(p)]: null }))} aria-label={`Remove ${m.name}`}>
                        <Icon name="x" width={18} height={18} color="var(--text-3)" />
                      </button>
                    </div>
                  );
                })}
            </section>
          );
        })
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => reset(() => setSeed((s) => s + 1))}>
          <Icon name="refresh" /> Shuffle all
        </button>
        <button className="btn btn-primary" disabled={!proposals.length || saving} onClick={() => void save()}>
          Add {proposals.length} meals
        </button>
      </div>
    </Sheet>
  );
}
