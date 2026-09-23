import { useMemo, useState } from 'react';
import { EmptyState } from '../../../components/CardHead';
import { BarChart } from '../../../components/charts/BarChart';
import { ChartTable } from '../../../components/charts/ChartTable';
import { Icon } from '../../../components/Icon';
import { PageHeader } from '../../../components/PageHeader';
import { useSleep, useWorkouts } from '../../../db/hooks';
import type { SleepLog } from '../../../db/types';
import { formatDuration, sleepVsTraining, summariseSleep } from '../../../lib/calc/sleep';
import { addDays, formatDateShort, parseISODate, relativeDay } from '../../../lib/dates';
import { round } from '../../../lib/units';
import { useToday } from '../../../lib/useToday';
import { ProgressTabs } from '../ProgressTabs';
import { RangeChips } from '../RangeChips';
import { QUALITY_LABEL, SleepSheet } from './SleepSheet';
import '../progress.css';

const GUIDE_H = 8;
const hours = (min: number) => min / 60;

/** Sleep: nightly duration vs the 7–9 h guideline, consistency, quality, and how it relates to training. */
export function SleepPage() {
  const today = useToday();
  const logs = useSleep();
  const workouts = useWorkouts();
  const [range, setRange] = useState(14);
  const [sheet, setSheet] = useState<{ editing?: SleepLog } | null>(null);

  const all = useMemo(() => logs ?? [], [logs]);
  const from = addDays(today, -(range - 1));
  const inRange = all.filter((l) => l.date >= from);
  const s = useMemo(() => summariseSleep(all, from, today), [all, from, today]);
  const prev = useMemo(() => summariseSleep(all, addDays(from, -range), addDays(from, -1)), [all, from, range]);
  const link = useMemo(() => (workouts ? sleepVsTraining(all, workouts) : null), [all, workouts]);

  const bars = inRange.map((l) => ({
    key: l.id,
    label: parseISODate(l.date).toLocaleDateString('en-GB', range <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }),
    title: `Night before ${formatDateShort(l.date)} · ${QUALITY_LABEL[l.quality]}`,
    value: hours(l.durationMin),
  }));

  return (
    <main className="page">
      <PageHeader
        title="Progress"
        action={
          <button className="btn btn-primary" onClick={() => setSheet({})}>
            <Icon name="plus" />
            Sleep
          </button>
        }
      />
      <ProgressTabs />

      {all.length === 0 ? (
        <section className="card">
          <EmptyState icon="moonStar">
            <b className="empty-title">Track your sleep</b>
            Log when you went to bed and woke up. After a few weeks you’ll see how sleep lines up with your training.
          </EmptyState>
          <button className="btn btn-primary btn-block" onClick={() => setSheet({})}>
            Log last night
          </button>
        </section>
      ) : (
        <>
          <RangeChips
            value={range}
            onChange={setRange}
            options={[
              { value: 7, label: '7 days' },
              { value: 14, label: '14 days' },
              { value: 30, label: '30 days' },
            ]}
          />
          <section className="card">
            <div className="card-head" style={{ '--tone': 'var(--sleep)' } as React.CSSProperties}>
              <span className="chip-icon">
                <Icon name="moonStar" />
              </span>
              <h2>Hours asleep</h2>
            </div>
            {bars.length > 0 ? (
              <>
                <BarChart
                  bars={bars}
                  tone="var(--sleep)"
                  target={GUIDE_H}
                  targetLabel={`${GUIDE_H} h`}
                  formatValue={(v) => formatDuration(v * 60)}
                  formatTick={(v) => `${round(v, 1)}h`}
                  label={`Hours of sleep per night, last ${range} days`}
                />
                <ChartTable caption="Sleep log" columns={['Morning', 'Bed', 'Wake', 'Sleep', 'Quality']} rows={[...inRange].reverse().map((l) => [formatDateShort(l.date), l.bedTime, l.wakeTime, formatDuration(l.durationMin), QUALITY_LABEL[l.quality]])} />
              </>
            ) : (
              <p className="faint">No nights logged in this range.</p>
            )}
            <div className="stat-grid">
              <div className="stat">
                <div className="label">Average</div>
                <div className="value">{s.avgMin !== null ? formatDuration(s.avgMin) : '—'}</div>
                {s.avgMin !== null && prev.avgMin !== null && (
                  <div className="stat-sub">
                    {s.avgMin >= prev.avgMin ? '+' : '−'}
                    {Math.round(Math.abs(s.avgMin - prev.avgMin))} min vs previous
                  </div>
                )}
              </div>
              <div className="stat">
                <div className="label">Quality</div>
                <div className="value">{s.avgQuality !== null ? `${round(s.avgQuality, 1)}/5` : '—'}</div>
              </div>
              <div className="stat">
                <div className="label">Under 7 h</div>
                <div className="value">
                  {s.shortNights}
                  <small>/{s.nights}</small>
                </div>
              </div>
              <div className="stat">
                <div className="label">Bedtime varies</div>
                <div className="value">{s.bedtimeSpreadMin !== null ? `±${Math.round(s.bedtimeSpreadMin)}m` : '—'}</div>
              </div>
            </div>
            <p className="faint" style={{ fontSize: 12 }}>
              Dashed line = 8 h. Most adults need 7–9 hours (general guidance). Duration is time in bed, so real sleep is a little less.
            </p>
          </section>

          <section className="card">
            <div className="card-head" style={{ '--tone': 'var(--sleep)' } as React.CSSProperties}>
              <span className="chip-icon">
                <Icon name="dumbbell" />
              </span>
              <h2>Sleep & training</h2>
            </div>
            {link ? (
              <div className="insight">
                <span className="pill kind-calculation">Calculation</span>
                <p>
                  After 7 h or more you lifted at <b>{round(link.wellRested.performance * 100, 0)}%</b> of your recent typical strength ({link.wellRested.sessions} sessions),
                  vs <b>{round(link.short.performance * 100, 0)}%</b> after shorter nights ({link.short.sessions} sessions) — a{' '}
                  {Math.abs(round(link.differencePct, 1))}% {link.differencePct >= 0 ? 'advantage for well-rested days' : 'difference in favour of short nights'}.
                </p>
                <p className="faint" style={{ fontSize: 13 }}>
                  Estimated 1RM per exercise vs its median over the previous five sessions. It’s a correlation from your own data, not proof — other things change too.
                </p>
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 14 }}>
                Log sleep on training days — once there are at least 3 workouts after a 7 h+ night and 3 after a shorter one, you’ll see how your lifting compares.
              </p>
            )}
          </section>

          <h2 className="section-title">Nights</h2>
          <div className="list">
            {[...all]
              .reverse()
              .slice(0, 30)
              .map((l) => (
                <button key={l.id} className="list-row" onClick={() => setSheet({ editing: l })}>
                  <div className="grow">
                    <div className="title">{relativeDay(l.date, today)}</div>
                    <div className="desc">
                      {l.bedTime} → {l.wakeTime} · {QUALITY_LABEL[l.quality]}
                      {l.note ? ` · ${l.note}` : ''}
                    </div>
                  </div>
                  <span className="trail">{formatDuration(l.durationMin)}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {sheet && <SleepSheet last={all.at(-1) ?? null} editing={sheet.editing} onClose={() => setSheet(null)} />}
    </main>
  );
}
