import { Link } from 'react-router-dom';
import { CardHead } from '../../../components/CardHead';
import type { Profile } from '../../../db/types';
import { GoalRow } from '../../progress/GoalRow';
import { useGoalStatuses } from '../../progress/useGoalStatuses';
import type { Training } from '../../workout/useTraining';

/** "How close am I to my goals?" — up to three, unfinished first. */
export function GoalsCard({ profile, t }: { profile: Profile; t: Training }) {
  const goals = useGoalStatuses(profile);
  if (!goals) return null;
  const shown = [...goals].sort((a, b) => Number(a.achieved) - Number(b.achieved)).slice(0, 3);
  return (
    <section className="card">
      <CardHead icon="target" tone="var(--accent-text)" title="Goals" link={{ to: '/progress/goals', label: 'All' }} />
      {shown.map((s) => (
        <GoalRow key={s.id} s={s} profile={profile} exMap={t.exMap} compact />
      ))}
      {goals.every((g) => !g.goal) && (
        <Link to="/progress/goals" className="link-row">
          Add a strength or measurement goal
        </Link>
      )}
    </section>
  );
}
