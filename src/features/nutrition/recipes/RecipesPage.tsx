import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { PageHeader } from '../../../components/PageHeader';
import { useSavedMeals } from '../../../db/hooks';
import { create } from '../../../db/repo';
import { CUISINES, type Cuisine, type Profile } from '../../../db/types';
import { CUISINE_LABEL, prefsOf, prefTips, recipeFits, recommend } from '../../../lib/calc/foodPrefs';
import { filterRecipes, TAG_LABEL, type RecipeFilter } from '../../../lib/calc/recipes';
import { GOALS } from '../../../lib/calc/nutrition';
import { NutritionTabs } from '../NutritionTabs';
import { RecipeCard } from './RecipeCard';
import '../nutrition.css';

const FILTERS: { value: RecipeFilter; label: string }[] = [
  { value: 'all', label: 'All meals' },
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

/** Recipe library: "For you" picks for your goal, then everything as photo cards. */
export function RecipesPage({ profile }: { profile: Profile }) {
  const meals = useSavedMeals();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [cuisine, setCuisine] = useState<Cuisine | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const answered = !!profile.foodPrefs?.answeredAt;
  const prefs = prefsOf(profile);

  const forYou = useMemo(() => (answered && meals ? recommend(meals, profile, prefs).slice(0, 10) : []), [answered, meals, profile, prefs]);
  const tips = useMemo(() => (answered ? prefTips(prefs, profile).slice(0, 2) : []), [answered, prefs, profile]);
  const list = useMemo(() => {
    let xs = filterRecipes(meals ?? [], filter, q);
    if (cuisine) xs = xs.filter((m) => m.cuisine === cuisine);
    return xs
      .map((m) => ({ m, fit: answered ? recipeFits(m, prefs) : { ok: true } }))
      .filter((x) => showAll || x.fit.ok)
      .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok) || Number(b.m.favourite) - Number(a.m.favourite) || Number(b.m.source !== 'builtin') - Number(a.m.source !== 'builtin') || a.m.name.localeCompare(b.m.name));
  }, [meals, filter, q, cuisine, answered, prefs, showAll]);
  const hidden = useMemo(() => (answered ? filterRecipes(meals ?? [], filter, q).filter((m) => (!cuisine || m.cuisine === cuisine) && !recipeFits(m, prefs).ok).length : 0), [answered, meals, filter, q, cuisine, prefs]);
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

      {!answered ? (
        <Link to="/nutrition/preferences" className="card autofill-cta">
          <Icon name="sparkles" width={24} height={24} />
          <span className="grow">
            <b>Tell me how you eat (2 min)</b>
            <span className="desc">A few questions about your goal, diet, allergies, time and tastes — then recipes and your weekly plan are picked for you.</span>
          </span>
          <Icon name="chevronRight" width={20} height={20} />
        </Link>
      ) : (
        <section className="for-you">
          <div className="section-row for-you-head">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>
                For you
              </h2>
              <span className="faint" style={{ fontSize: 13 }}>
                {GOALS[profile.goal].label} · {profile.calorieTarget} kcal · {profile.proteinTarget} g protein
              </span>
            </div>
            <Link to="/nutrition/preferences" className="link-row">
              <Icon name="edit" width={16} height={16} /> My answers
            </Link>
          </div>
          <div className="for-you-row">
            {forYou.map((s) => (
              <div key={s.meal.id} className="for-you-card">
                <RecipeCard meal={s.meal} to={`/nutrition/meals/${s.meal.id}`} />
                {s.reasons[0] && <span className="why">✓ {s.reasons[0]}</span>}
              </div>
            ))}
          </div>
          {tips.map((t) => (
            <div key={t.text} className="insight tip">
              <span className={`pill kind-${t.kind}`}>{t.kind[0].toUpperCase() + t.kind.slice(1)}</span>
              <p>{t.text}</p>
            </div>
          ))}
        </section>
      )}

      <Link to="/nutrition/plan?autofill=1" className="card autofill-cta compact">
        <Icon name="calendar" width={22} height={22} />
        <span className="grow">
          <b>Plan my week for me</b>
          <span className="desc">{answered ? 'Uses your answers — swap anything you don’t fancy.' : 'Recipes that hit your calories and protein.'}</span>
        </span>
        <Icon name="chevronRight" width={20} height={20} />
      </Link>

      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input type="search" placeholder={`Search ${meals.length} recipes or ingredients`} value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} aria-label="Search recipes" />
      </div>
      <div className="chip-scroll" role="group" aria-label="Filter recipes">
        {FILTERS.map((f) => (
          <button key={f.value} className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="chip-scroll" role="group" aria-label="Cuisine">
        <button className="chip" aria-pressed={cuisine === null} onClick={() => setCuisine(null)}>
          All cuisines
        </button>
        {CUISINES.map((c) => (
          <button key={c} className="chip" aria-pressed={cuisine === c} onClick={() => setCuisine(c)}>
            {CUISINE_LABEL[c]}
          </button>
        ))}
      </div>
      {answered && (hidden > 0 || showAll) && (
        <button className="link-row" onClick={() => setShowAll((v) => !v)} style={{ background: 'none', border: 0, padding: '0 4px' }}>
          {showAll ? 'Hide recipes that don’t suit your answers' : `${hidden} hidden because of your answers — show all`}
        </button>
      )}
      {list.length ? (
        <div className="recipe-grid">
          {list.map(({ m, fit }) => (
            <RecipeCard key={m.id} meal={m} to={`/nutrition/meals/${m.id}`} badge={fit.ok ? undefined : fit.why} dim={!fit.ok} />
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
