import { Link } from 'react-router-dom';
import { CardHead } from '../../../components/CardHead';
import type { Profile } from '../../../db/types';
import { daysBetween, startOfWeek } from '../../../lib/dates';
import { defaultReviewWeek, useWeeklyReview } from '../../review/useWeeklyReview';

/** Shown on Sundays and Mondays: the week's habit score and the top focus, linking to the full review. */
export function ReviewCard({ profile, today }: { profile: Profile; today: string }) {
  const thisWeek = startOfWeek(today);
  const dow = daysBetween(thisWeek, today); // 0 = Monday … 6 = Sunday
  const week = defaultReviewWeek(today, thisWeek);
  const r = useWeeklyReview(profile, week, today);
  if (!(dow === 6 || dow === 0) || !r || r.weekEnd < profile.startDate) return null;
  const top = r.focus[0] ?? r.wins[0];

  return (
    <section className="card">
      <CardHead icon="calendar" tone="var(--coach)" title={dow === 6 ? 'Your week so far' : 'Last week in review'} link={{ to: '/more/review', label: 'Open' }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="big-num">
          {r.score}
          <small>/100</small>
        </span>
        <span className="muted" style={{ fontSize: 14 }}>
          {r.training.workouts}/{r.training.target} workouts · {r.nutrition.daysLogged} days logged
          {r.training.pbs.length ? ` · ${r.training.pbs.length} PB${r.training.pbs.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {top && (
        <div className="insight">
          <span className={`pill kind-${top.kind}`}>{top.kind === 'suggestion' ? 'Suggestion' : top.kind === 'fact' ? 'Fact' : 'Calculation'}</span>
          <p>{top.text}</p>
        </div>
      )}
      <Link to="/more/review" className="btn btn-block">
        See the full review
      </Link>
    </section>
  );
}
