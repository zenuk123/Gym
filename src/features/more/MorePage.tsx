import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import type { Profile } from '../../db/types';
import { GOALS } from '../../lib/calc/nutrition';
import { formatInt } from '../../lib/format';
import { useSyncState } from '../../sync/manager';

function Row({ to, icon, tone, title, desc }: { to: string; icon: IconName; tone: string; title: string; desc?: string }) {
  return (
    <Link to={to} className="list-row" style={{ '--tone': tone } as React.CSSProperties}>
      <span className="lead">
        <Icon name={icon} />
      </span>
      <div className="grow">
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <span className="trail">
        <Icon name="chevronRight" />
      </span>
    </Link>
  );
}

export function MorePage({ profile }: { profile: Profile }) {
  const sync = useSyncState();
  const syncDesc =
    sync.status === 'local-only'
      ? 'Stored on this device'
      : sync.user
        ? `Signed in as ${sync.user.email ?? 'you'}`
        : 'Sign in to back up & sync';

  return (
    <main className="page">
      <PageHeader title="More" />

      <div className="list">
        <Row to="/more/profile" icon="user" tone="var(--protein)" title={profile.name || 'Profile'} desc={`${GOALS[profile.goal].label} · personal details`} />
        <Row
          to="/more/targets"
          icon="target"
          tone="var(--kcal)"
          title="Daily targets"
          desc={`${formatInt(profile.calorieTarget)} kcal · ${profile.proteinTarget} g protein`}
        />
        <Row to="/progress/goals" icon="trophy" tone="var(--pb)" title="Goals" desc="Weight, strength & measurement goals" />
      </div>

      <h2 className="section-title">Coming soon</h2>
      <div className="list">
        {[
          { icon: 'brain' as const, title: 'AI coach', desc: 'Ask questions about your own training data' },
          { icon: 'calendar' as const, title: 'Weekly review', desc: 'Your week in numbers, every Sunday' },
        ].map((c) => (
          <div key={c.title} className="list-row" style={{ '--tone': 'var(--text-3)', opacity: 0.7 } as React.CSSProperties}>
            <span className="lead">
              <Icon name={c.icon} />
            </span>
            <div className="grow">
              <div className="title">{c.title}</div>
              <div className="desc">{c.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">App</h2>
      <div className="list">
        <Row to="/more/account" icon="cloud" tone="var(--water)" title="Account & sync" desc={syncDesc} />
        <Row to="/more/data" icon="database" tone="var(--weight)" title="Data & backup" desc="Export CSV / JSON, restore" />
        <Row to="/more/appearance" icon="moon" tone="var(--text-2)" title="Appearance & units" />
        <Row to="/more/about" icon="info" tone="var(--text-2)" title="About & install" />
      </div>
    </main>
  );
}
