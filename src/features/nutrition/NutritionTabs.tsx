import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/nutrition', label: 'Log', end: true },
  { to: '/nutrition/plan', label: 'Plan' },
  { to: '/nutrition/shopping', label: 'Shopping' },
  { to: '/nutrition/meals', label: 'Recipes' },
  { to: '/nutrition/foods', label: 'Foods' },
];

export function NutritionTabs() {
  return (
    <nav className="chip-scroll section-tabs" aria-label="Nutrition sections">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `chip${isActive ? ' on' : ''}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
