import { useMemo, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Sheet } from '../../../components/Sheet';
import { useSavedMeals } from '../../../db/hooks';
import type { MealSlot, SavedMeal } from '../../../db/types';
import { filterRecipes, swapOptions, TAG_LABEL, type RecipeFilter } from '../../../lib/calc/recipes';
import { RecipeCard } from './RecipeCard';

const QUICK_FILTERS: RecipeFilter[] = ['all', 'high-protein', 'quick', 'vegetarian', 'meal-prep', 'favourites'];

/**
 * Pick a recipe for one meal slot, as photo cards. Best fits for the calories this meal
 * should take come first; "Search foods" falls back to single foods.
 */
export function RecipePickerSheet({
  title,
  slot,
  budget,
  proteinAim,
  onPick,
  onSearchFoods,
  onClose,
  allow,
}: {
  title: string;
  slot: MealSlot;
  budget: number;
  proteinAim: number;
  onPick: (meal: SavedMeal, servings: number) => void;
  onSearchFoods?: () => void;
  onClose: () => void;
  /** Your food preferences for this day/meal; recipes that don't fit are hidden unless "Show all". */
  allow?: (m: SavedMeal) => boolean;
}) {
  const meals = useSavedMeals();
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const ranked = useMemo(() => {
    const allowed = new Set(filterRecipes(meals ?? [], filter, q).map((m) => m.id));
    return swapOptions((meals ?? []).filter((m) => allowed.has(m.id) && (all || !allow || allow(m))), slot, budget, proteinAim, null, 100);
  }, [meals, filter, q, slot, budget, proteinAim, all, allow]);

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="faint" style={{ fontSize: 13, marginTop: -6 }}>
        Best fits first for about {Math.round(budget)} kcal{proteinAim > 0 ? ` and ${Math.round(proteinAim)} g protein` : ''}.
      </p>
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input type="search" placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} aria-label="Search recipes" />
      </div>
      <div className="chip-scroll" role="group" aria-label="Filter">
        {QUICK_FILTERS.map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'favourites' ? 'Favourites' : TAG_LABEL[f as keyof typeof TAG_LABEL]}
          </button>
        ))}
      </div>
      {allow && (
        <button className="link-row" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => setAll((v) => !v)}>
          {all ? 'Only recipes that suit your answers' : 'Showing recipes that suit your answers · show all'}
        </button>
      )}
      {ranked.length ? (
        <div className="recipe-grid">
          {ranked.map((r, i) => (
            <RecipeCard
              key={r.meal.id}
              meal={r.meal}
              servings={r.servings}
              badge={[i < 3 && !q ? 'Good fit' : '', r.servings !== 1 ? `× ${r.servings}` : ''].filter(Boolean).join(' · ') || undefined}
              onClick={() => onPick(r.meal, r.servings)}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No recipes match.</p>
      )}
      {onSearchFoods && (
        <button className="btn btn-block" onClick={onSearchFoods}>
          <Icon name="search" /> Search foods instead
        </button>
      )}
    </Sheet>
  );
}
