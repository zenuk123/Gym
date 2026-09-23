import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'home' },
  { to: '/workout', label: 'Workout', icon: 'dumbbell' },
  { to: '/nutrition', label: 'Nutrition', icon: 'utensils' },
  { to: '/progress', label: 'Progress', icon: 'chart' },
  { to: '/more', label: 'More', icon: 'menu' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      <ul>
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
