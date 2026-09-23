import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MeterList } from '../../components/charts/Bars';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import type { Profile } from '../../db/types';
import { reviewText, type ReviewStatement } from '../../lib/calc/review';
import { formatDuration } from '../../lib/calc/sleep';
import { PB_LABEL } from '../../lib/calc/training';
import { addDays, formatDateShort, startOfWeek } from '../../lib/dates';
import { formatInt, formatLitres } from '../../lib/format';
import { formatWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { useTraining } from '../workout/useTraining';
import { defaultReviewWeek, useWeeklyReview } from './useWeeklyReview';

const KIND_LABEL = { fact: 'Fact', calculation: 'Calculation', suggestion: 'Suggestion' } as const;

function Statements({ items }: { items: ReviewStatement[] }) {
  return (
    <>
      {items.map((s) => (
        <div key={s.text} className="insight">
          <span className={`pill kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
          <p>{s.text}</p>
        </div>
      ))}
    </>
  );
}

/** Weekly review: the week in numbers, wins, and up to three things to focus on next week. */
export function ReviewPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const thisWeek = startOfWeek(today);
  const [week, setWeek] = useState(() => {
    const w = defaultReviewWeek(today, thisWeek);
    // Nothing to review before the user started: show the week in progress instead.
    return addDays(w, 6) < profile.startDate ? thisWeek : w;
  });
  const r = useWeeklyReview(profile, week, today);
  const t = useTraining();
  const u = profile.weightUnit;

  if (!r || !t) return <main className="page" />;
  const inProgress = week === thisWeek && today < r.weekEnd;
  const volChange = r.training.prevVolumeKg > 0 ? ((r.training.volumeKg - r.training.prevVolumeKg) / r.training.prevVolumeKg) * 100 : null;

  async function share() {
    const text = reviewText(r!, profile);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'My week', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <main className="page">
      <SubHeader title="Weekly review" />
      <div className="day-switch">
        <button className="icon-btn" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          <Icon name="chevronLeft" />
        </button>
        <span>
          {formatDateShort(r.weekStart)} – {formatDateShort(r.weekEnd)}
          {inProgress && <span className="faint"> · so far</span>}
        </span>
        <button className="icon-btn" onClick={() => setWeek(addDays(week, 7))} disabled={week >= thisWeek} aria-label="Next week">
          <Icon name="chevronRight" />
        </button>
      </div>

      <section className="card">
        <div className="review-score">
          <div>
            <div className="big-num">
              {r.score}
              <small>/100</small>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Habit score <span className="pill kind-calculation">Calculation</span>
            </div>
          </div>
        </div>
        <MeterList
          rows={r.scoreParts.map((p) => ({ key: p.label, label: p.label, value: (p.hit / p.of) * 100, text: `${p.hit}/${p.of}` }))}
          max={100}
          tone="var(--coach)"
        />
        <p className="faint" style={{ fontSize: 12 }}>
          The average of the parts above — each is how often you hit that habit this week.
        </p>
      </section>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Workouts</div>
          <div className="value">
            {r.training.workouts}
            <small>/{r.training.target}</small>
          </div>
          <div className="stat-sub">
            {r.training.sets} sets{volChange !== null && ` · vol ${volChange >= 0 ? '+' : '−'}${Math.abs(Math.round(volChange))}%`}
          </div>
        </div>
        <div className="stat">
          <div className="label">Avg calories</div>
          <div className="value">{r.nutrition.avgKcal !== null ? formatInt(r.nutrition.avgKcal) : '—'}</div>
          <div className="stat-sub">target {formatInt(profile.calorieTarget)} · {r.nutrition.daysLogged}d logged</div>
        </div>
        <div className="stat">
          <div className="label">Avg protein</div>
          <div className="value">
            {r.nutrition.avgProtein !== null ? formatInt(r.nutrition.avgProtein) : '—'}
            <small> g</small>
          </div>
          <div className="stat-sub">hit on {r.nutrition.proteinHit} days</div>
        </div>
        <div className="stat">
          <div className="label">Avg weight</div>
          <div className="value">{r.weight.avgKg !== null ? formatWeight(r.weight.avgKg, u) : '—'}</div>
          <div className="stat-sub">{r.weight.changeKg !== null ? `${formatWeight(r.weight.changeKg, u, { signed: true })} vs last week` : `${r.weight.weighIns} weigh-ins`}</div>
        </div>
        <div className="stat">
          <div className="label">Water</div>
          <div className="value">{r.water.avgMl !== null ? formatLitres(r.water.avgMl) : '—'}</div>
          <div className="stat-sub">target hit {r.water.daysHit} days</div>
        </div>
        <div className="stat">
          <div className="label">Sleep</div>
          <div className="value">{r.sleep.avgMin !== null ? formatDuration(r.sleep.avgMin) : '—'}</div>
          <div className="stat-sub">{r.sleep.nights} nights logged</div>
        </div>
      </div>

      {r.training.pbs.length > 0 && (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--pb)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="trophy" />
            </span>
            <h2>Personal bests</h2>
          </div>
          <div className="list">
            {r.training.pbs.slice(0, 8).map((p) => (
              <div key={`${p.workoutId}-${p.exerciseId}-${p.kind}`} className="list-row">
                <div className="grow">
                  <div className="title">{t.exMap.get(p.exerciseId)?.name ?? 'Exercise'}</div>
                  <div className="desc">
                    {PB_LABEL[p.kind]} · {formatWeight(p.weightKg, u)} × {p.reps}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--success)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="check" />
          </span>
          <h2>What went well</h2>
        </div>
        {r.wins.length ? <Statements items={r.wins} /> : <p className="faint">Nothing stood out yet — the review fills in as you log.</p>}
      </section>

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--coach)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="target" />
          </span>
          <h2>Focus for next week</h2>
        </div>
        {r.focus.length ? <Statements items={r.focus} /> : <p className="faint">{inProgress ? 'Check back on Sunday for suggestions.' : 'No changes suggested — keep doing what you’re doing.'}</p>}
        <p className="faint" style={{ fontSize: 12 }}>
          Suggestions only — your targets and programme never change unless you edit them.
        </p>
      </section>

      <div className="btn-row">
        <Link to={`/more/coach?prompt=review&week=${r.weekStart}`} className="btn btn-primary">
          <Icon name="brain" /> Discuss with coach
        </Link>
        <button className="btn" onClick={() => void share()}>
          <Icon name="share" /> Share
        </button>
      </div>
    </main>
  );
}
