import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import type { Profile, UserGoal } from '../../db/types';
import { useTraining } from '../workout/useTraining';
import { GoalRow } from './GoalRow';
import { GoalSheet } from './GoalSheet';
import { ProgressTabs } from './ProgressTabs';
import { useGoalStatuses } from './useGoalStatuses';
import './progress.css';

export function GoalsPage({ profile }: { profile: Profile }) {
  const statuses = useGoalStatuses(profile);
  const t = useTraining();
  const [sheet, setSheet] = useState<{ editing?: UserGoal } | null>(null);
  if (!statuses || !t) return <main className="page" />;
  const profileGoals = statuses.filter((s) => s.kind === 'bodyweight' || s.kind === 'frequency');
  const userGoals = statuses.filter((s) => s.goal);

  return (
    <main className="page">
      <PageHeader
        title="Progress"
        action={
          <button className="btn btn-primary" onClick={() => setSheet({})}>
            <Icon name="plus" />
            Goal
          </button>
        }
      />
      <ProgressTabs />

      <section className="card">
        {profileGoals.map((s) => (
          <GoalRow key={s.id} s={s} profile={profile} exMap={t.exMap} />
        ))}
        <Link to="/more/targets" className="link-row">
          Edit target weight & weekly sessions <Icon name="chevronRight" width={16} height={16} />
        </Link>
        {profile.targetWeightKg === null && (
          <p className="faint" style={{ fontSize: 13 }}>
            Tip: set a target weight in Profile to track it here.
          </p>
        )}
      </section>

      <h2 className="section-title">Strength & body goals</h2>
      {userGoals.length === 0 ? (
        <section className="card">
          <EmptyState icon="target">
            <b className="empty-title">Set a goal</b>
            e.g. Bench Press 80 → 100 kg, or waist 84 → 80 cm.
          </EmptyState>
          <button className="btn btn-block" onClick={() => setSheet({})}>
            <Icon name="plus" /> Add a goal
          </button>
        </section>
      ) : (
        <section className="card">
          {userGoals.map((s) => (
            <button key={s.id} className="goal-btn" onClick={() => setSheet({ editing: s.goal! })}>
              <GoalRow s={s} profile={profile} exMap={t.exMap} />
            </button>
          ))}
        </section>
      )}
      <p className="faint" style={{ fontSize: 13, padding: '0 4px' }}>
        Projections are calculations from your recent rate of progress (last ~12 weeks), not promises.
      </p>

      {sheet && <GoalSheet profile={profile} t={t} editing={sheet.editing} onClose={() => setSheet(null)} />}
    </main>
  );
}
