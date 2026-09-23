import { useState } from 'react';
import { CardHead, EmptyState } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { LineChart } from '../../../components/LineChart';
import { ProgressBar } from '../../../components/ProgressBar';
import type { Profile, WeightEntry } from '../../../db/types';
import { addDays, daysBetween, relativeDay } from '../../../lib/dates';
import { dailySeries, movingAverage, type WeightSummary } from '../../../lib/calc/weight';
import { formatWeight, round, toDisplayWeight } from '../../../lib/units';
import { LogWeightSheet } from '../../progress/LogWeightSheet';

export function WeightCard({
  profile,
  weights,
  summary,
  today,
}: {
  profile: Profile;
  weights: WeightEntry[];
  summary: WeightSummary;
  today: string;
}) {
  const [logging, setLogging] = useState(false);
  const u = profile.weightUnit;
  const loggedToday = summary.latest?.date === today;

  const recent = dailySeries(weights).filter((d) => d.date >= addDays(today, -29));
  const trend = movingAverage(recent);
  const toPts = (xs: { date: string; weightKg: number }[]) =>
    xs.map((d) => ({ x: daysBetween(today, d.date), y: toDisplayWeight(d.weightKg, u) }));

  const trendIcon = summary.rate === null ? null : Math.abs(summary.rate) < 0.1 ? 'trendFlat' : summary.rate > 0 ? 'trendUp' : 'trendDown';

  return (
    <section className="card">
      <CardHead icon="scale" tone="var(--weight)" title="Body weight" link={{ to: '/progress', label: 'Trend' }} />
      {summary.latest ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="big-num">
                {round(toDisplayWeight(summary.latest.weightKg, u), 1)}
                <small>{u}</small>
              </div>
              <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
                {relativeDay(summary.latest.date, today)}
                {summary.average7 !== null && <> · 7-day avg {formatWeight(summary.average7, u)}</>}
              </div>
            </div>
            {trendIcon && summary.rate !== null && (
              <span className="pill">
                <Icon name={trendIcon} />
                {formatWeight(summary.rate, u, { signed: true, decimals: 2 })}/wk
              </span>
            )}
          </div>
          {recent.length >= 2 && <LineChart raw={toPts(recent)} trend={toPts(trend)} height={70} compact />}
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Start</div>
              <div className="value">{formatWeight(profile.startWeightKg, u)}</div>
            </div>
            <div className="stat">
              <div className="label">Change</div>
              <div className="value">{summary.changeKg !== null ? formatWeight(summary.changeKg, u, { signed: true }) : '—'}</div>
            </div>
            {profile.targetWeightKg !== null && (
              <div className="stat">
                <div className="label">Goal</div>
                <div className="value">{formatWeight(profile.targetWeightKg, u)}</div>
              </div>
            )}
          </div>
          {summary.progress !== null && (
            <div className="macro-row">
              <div className="top">
                <span className="faint" style={{ fontSize: 13 }}>
                  Progress to goal
                </span>
                <span className="amount">{Math.round(summary.progress * 100)}%</span>
              </div>
              <ProgressBar value={summary.progress} max={1} tone="var(--weight)" />
            </div>
          )}
        </>
      ) : (
        <EmptyState icon="scale">No weigh-ins yet.</EmptyState>
      )}
      <button className={`btn btn-block${loggedToday ? '' : ' btn-primary'}`} onClick={() => setLogging(true)}>
        <Icon name={loggedToday ? 'check' : 'plus'} />
        {loggedToday ? 'Logged today · add another' : "Log today's weight"}
      </button>
      {logging && (
        <LogWeightSheet profile={profile} last={weights.at(-1) ?? null} onClose={() => setLogging(false)} />
      )}
    </section>
  );
}
