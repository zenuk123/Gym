import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/nutrition', label: 'Log', end: true },
  { to: '/nutrition/meals', label: 'Meals' },
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
