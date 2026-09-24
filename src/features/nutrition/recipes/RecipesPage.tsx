import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { PageHeader } from '../../../components/PageHeader';
import { useSavedMeals } from '../../../db/hooks';
import { create } from '../../../db/repo';
import { filterRecipes, TAG_LABEL, type RecipeFilter } from '../../../lib/calc/recipes';
import { NutritionTabs } from '../NutritionTabs';
import { RecipeCard } from './RecipeCard';
import '../nutrition.css';

const FILTERS: { value: RecipeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snacks' },
  { value: 'high-protein', label: TAG_LABEL['high-protein'] },
  { value: 'quick', label: TAG_LABEL.quick },
  { value: 'meal-prep', label: TAG_LABEL['meal-prep'] },
  { value: 'vegetarian', label: TAG_LABEL.vegetarian },
  { value: 'vegan', label: TAG_LABEL.vegan },
  { value: 'low-calorie', label: TAG_LABEL['low-calorie'] },
  { value: 'mine', label: 'My recipes' },
  { value: 'favourites', label: 'Favourites' },
];

/** Recipe library: built-in recipes and your own, as photo cards. */
export function RecipesPage() {
  const meals = useSavedMeals();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const xs = filterRecipes(meals ?? [], filter, q);
    // Your own and favourites first, then alphabetical.
    return xs.sort((a, b) => Number(b.favourite) - Number(a.favourite) || Number(b.source !== 'builtin') - Number(a.source !== 'builtin') || a.name.localeCompare(b.name));
  }, [meals, filter, q]);
  if (!meals) return <main className="page" />;

  async function newRecipe() {
    const m = await create('meals', { name: 'New recipe', slot: null, servings: 1, items: [], notes: null, favourite: false, source: 'custom', steps: [], prepMin: null, tags: [], image: null, cover: null });
    navigate(`/nutrition/meals/${m.id}/edit`);
  }

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => void newRecipe()}>
            <Icon name="plus" />
            Recipe
          </button>
        }
      />
      <NutritionTabs />
      <Link to="/nutrition/plan?autofill=1" className="card autofill-cta">
        <Icon name="sparkles" width={24} height={24} />
        <span className="grow">
          <b>Plan my week for me</b>
          <span className="desc">Fills your week with recipes that hit your calories and protein — swap anything you don’t fancy.</span>
        </span>
        <Icon name="chevronRight" width={20} height={20} />
      </Link>
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input type="search" placeholder="Search recipes or ingredients" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} aria-label="Search recipes" />
      </div>
      <div className="chip-scroll" role="group" aria-label="Filter recipes">
        {FILTERS.map((f) => (
          <button key={f.value} className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="recipe-grid">
          {list.map((m) => (
            <RecipeCard key={m.id} meal={m} to={`/nutrition/meals/${m.id}`} />
          ))}
        </div>
      ) : (
        <section className="card">
          <EmptyState icon="utensils">{filter === 'mine' ? 'Recipes you create — or save from your food log — appear here.' : 'No recipes match.'}</EmptyState>
        </section>
      )}
    </main>
  );
}
