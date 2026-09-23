import { CardHead } from '../../../components/CardHead';
import type { Profile } from '../../../db/types';

/** Weekly target vs sessions done. Session counting comes with workout logging (Phase 2). */
export function ConsistencyCard({ profile }: { profile: Profile }) {
  const done = 0;
  return (
    <section className="card">
      <CardHead icon="flame" tone="var(--streak)" title="Consistency" />
      <div className="big-num">
        {done}
        <small>/ {profile.workoutsPerWeek} this week</small>
      </div>
      <p className="faint" style={{ fontSize: 13, marginTop: -4 }}>
        Sessions and streaks are counted automatically once workout logging is live.
      </p>
      <div className="dots" aria-hidden="true">
        {Array.from({ length: profile.workoutsPerWeek }, (_, i) => (
          <span key={i} className={i < done ? 'on' : ''} />
        ))}
      </div>
    </section>
  );
}
