import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/progress', label: 'Overview', end: true },
  { to: '/progress/body', label: 'Body' },
  { to: '/progress/photos', label: 'Photos' },
  { to: '/progress/training', label: 'Training' },
  { to: '/progress/nutrition', label: 'Nutrition' },
  { to: '/progress/goals', label: 'Goals' },
];

/** Section switcher for the Progress tab (scrolls horizontally on small phones). */
export function ProgressTabs() {
  return (
    <nav className="chip-scroll progress-tabs" aria-label="Progress sections">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `chip${isActive ? ' on' : ''}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
