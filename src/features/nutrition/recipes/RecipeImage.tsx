import type { SavedMeal } from '../../../db/types';

const TONE: Record<string, string> = {
  breakfast: 'var(--kcal)',
  lunch: 'var(--success)',
  dinner: 'var(--protein)',
  snack: 'var(--pb)',
};

/**
 * A meal's picture: your photo when there is one, otherwise an illustrated cover
 * (the recipe's emoji on a tinted card) — decorative, so it's hidden from screen readers.
 */
export function RecipeImage({ meal, size = 'card' }: { meal: Pick<SavedMeal, 'image' | 'cover' | 'slot' | 'name'>; size?: 'card' | 'hero' | 'thumb' }) {
  if (meal.image) return <img className={`recipe-img size-${size}`} src={meal.image} alt={size === 'hero' ? meal.name : ''} loading="lazy" decoding="async" />;
  return (
    <div className={`recipe-img recipe-cover size-${size}`} style={{ '--tone': TONE[meal.slot ?? 'lunch'] } as React.CSSProperties} aria-hidden="true">
      <span>{meal.cover ?? '🍽️'}</span>
    </div>
  );
}
