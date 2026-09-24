import { Link } from 'react-router-dom';
import type { SavedMeal } from '../../../db/types';
import { mealPerServing } from '../../../lib/calc/food';
import { formatInt } from '../../../lib/format';
import { RecipeImage } from './RecipeImage';

/** Photo card for a recipe: picture, name, per-serving calories/protein and time. */
export function RecipeCard({ meal, to, onClick, badge, servings = 1 }: { meal: SavedMeal; to?: string; onClick?: () => void; badge?: string; servings?: number }) {
  const n = mealPerServing(meal);
  const body = (
    <>
      <div className="img-wrap">
        <RecipeImage meal={meal} />
        {badge && <span className="fit">{badge}</span>}
        {meal.favourite && <span className="fav" aria-label="Favourite">★</span>}
      </div>
      <span className="name">{meal.name}</span>
      <span className="meta">
        {formatInt(n.kcal * servings)} kcal · {formatInt(n.proteinG * servings)} g protein
        {meal.prepMin ? ` · ${meal.prepMin} min` : ''}
      </span>
    </>
  );
  if (to)
    return (
      <Link to={to} className="recipe-card">
        {body}
      </Link>
    );
  return (
    <button type="button" className="recipe-card" onClick={onClick}>
      {body}
    </button>
  );
}
