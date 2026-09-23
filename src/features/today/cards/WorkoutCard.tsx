import { Link } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import type { Profile } from '../../../db/types';

/**
 * Phase 1 placeholder. In Phase 2 this shows today's routine, last session
 * and suggested targets, with START WORKOUT opening Gym Mode.
 */
export function WorkoutCard({ profile }: { profile: Profile }) {
  return (
    <section className="card hero workout-card" aria-labelledby="today-workout">
      <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
        <span className="chip-icon">
          <Icon name="dumbbell" />
        </span>
        <h2 id="today-workout">Today's workout</h2>
      </div>
      <div>
        <div className="workout-title">No routine yet</div>
        <p className="muted" style={{ marginTop: 4 }}>
          Your {profile.workoutsPerWeek}-day plan, last session and suggested weights will appear here once routines are set up.
        </p>
      </div>
      <Link to="/workout" className="btn btn-primary btn-lg btn-block">
        <Icon name="play" />
        Set up training
      </Link>
    </section>
  );
}
