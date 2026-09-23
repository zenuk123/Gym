import { EmptyState } from '../../components/CardHead';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import type { Profile } from '../../db/types';

const COMING: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'dumbbell', title: 'Exercise library', desc: 'Searchable exercises with your full history' },
  { icon: 'calendar', title: 'Routines', desc: 'Push / pull / legs, upper / lower or your own split' },
  { icon: 'play', title: 'Gym Mode', desc: 'Big one-handed controls, rest timer, works offline' },
  { icon: 'trendUp', title: 'Progressive overload', desc: 'Suggested weight × reps for every set — you approve' },
  { icon: 'trophy', title: 'PB detection', desc: 'Weight, rep, volume and estimated 1RM PBs' },
];

export function WorkoutPage({ profile }: { profile: Profile }) {
  return (
    <main className="page">
      <PageHeader title="Workout" eyebrow={`${profile.workoutsPerWeek} sessions / week`} />
      <section className="card hero">
        <EmptyState icon="dumbbell">
          <b style={{ color: 'var(--text)', display: 'block', fontSize: 17, marginBottom: 4 }}>Training is the next build phase</b>
          Your profile and targets are ready. Routines and Gym Mode plug in here next.
        </EmptyState>
      </section>
      <h2 className="section-title">Coming in Phase 2</h2>
      <div className="list">
        {COMING.map((c) => (
          <div key={c.title} className="list-row" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
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
    </main>
  );
}
