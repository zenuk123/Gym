import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

export function PageHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

/** Header for pages pushed from a tab (e.g. More → Profile). */
export function SubHeader({ title, back = '/more' }: { title: string; back?: string }) {
  const navigate = useNavigate();
  return (
    <header className="sub-header">
      <button className="icon-btn" onClick={() => navigate(back)} aria-label="Back">
        <Icon name="chevronLeft" />
      </button>
      <h1>{title}</h1>
    </header>
  );
}
