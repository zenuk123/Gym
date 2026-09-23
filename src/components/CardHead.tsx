import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export function CardHead({ icon, tone, title, link }: { icon: IconName; tone: string; title: string; link?: { to: string; label: string } }) {
  return (
    <div className="card-head" style={{ '--tone': tone } as React.CSSProperties}>
      <span className="chip-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      {link && (
        <Link className="head-link" to={link.to}>
          {link.label}
          <Icon name="chevronRight" width={16} height={16} />
        </Link>
      )}
    </div>
  );
}

export function EmptyState({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} width={22} height={22} />
      </div>
      {children}
    </div>
  );
}
