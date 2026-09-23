import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { LineChart } from '../../components/LineChart';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useWeights } from '../../db/hooks';
import { remove, update } from '../../db/repo';
import type { Profile, WeightEntry } from '../../db/types';
import { addDays, daysBetween, formatDateShort, relativeDay, startOfWeek } from '../../lib/dates';
import { dailySeries, movingAverage, summariseWeight, windowAverage } from '../../lib/calc/weight';
import { formatWeight, round, toDisplayWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { LogWeightSheet } from './LogWeightSheet';

type Range = '30' | '90' | '365' | 'all';

export function ProgressPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const weights = useWeights();
  const [range, setRange] = useState<Range>('90');
  const [sheet, setSheet] = useState<{ editing?: WeightEntry } | null>(null);
  const u = profile.weightUnit;

  const all = weights ?? [];
  const summary = useMemo(() => summariseWeight(all, profile.startWeightKg, profile.targetWeightKg), [all, profile]);
  const series = useMemo(() => dailySeries(all), [all]);
  const trend = useMemo(() => movingAverage(series), [series]);
  const from = range === 'all' ? '0000-00-00' : addDays(today, -(Number(range) - 1));
  const toPts = (xs: { date: string; weightKg: number }[]) =>
    xs.filter((d) => d.date >= from).map((d) => ({ x: daysBetween(today, d.date), y: toDisplayWeight(d.weightKg, u) }));

  // Weekly averages (Mon–Sun), newest first.
  const weekly = useMemo(() => {
    const weeks = new Map<string, number[]>();
    for (const d of series) weeks.set(startOfWeek(d.date), [...(weeks.get(startOfWeek(d.date)) ?? []), d.weightKg]);
    return [...weeks.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 8)
      .map(([week, ws]) => ({ week, avg: ws.reduce((s, w) => s + w, 0) / ws.length, n: ws.length }));
  }, [series]);

  const avg30 = summary.latest ? windowAverage(series, summary.latest.date, 30) : null;

  async function del(w: WeightEntry) {
    await remove('weights', w.id);
    toast('Weigh-in deleted', { label: 'Undo', run: () => void update('weights', w.id, { deletedAt: null }) });
  }

  return (
    <main className="page">
      <PageHeader
        title="Progress"
        action={
          <button className="btn btn-primary" onClick={() => setSheet({})}>
            <Icon name="plus" />
            Weight
          </button>
        }
      />

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--weight)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="scale" />
          </span>
          <h2>Body weight trend</h2>
        </div>
        {series.length >= 2 ? (
          <>
            <Segmented
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: '30', label: '1M' },
                { value: '90', label: '3M' },
                { value: '365', label: '1Y' },
                { value: 'all', label: 'All' },
              ]}
            />
            <LineChart
              raw={toPts(series)}
              trend={toPts(trend)}
              goal={profile.targetWeightKg !== null ? toDisplayWeight(profile.targetWeightKg, u) : null}
              height={190}
            />
            <p className="faint" style={{ fontSize: 12 }}>
              Dots = daily weigh-ins · line = 7-day average{profile.targetWeightKg !== null && ' · dashed = goal'}
            </p>
          </>
        ) : (
          <EmptyState icon="chart">Log at least two weigh-ins to see your trend.</EmptyState>
        )}
        <div className="stat-grid">
          <div className="stat">
            <div className="label">7-day avg</div>
            <div className="value">{summary.average7 !== null ? formatWeight(summary.average7, u) : '—'}</div>
          </div>
          <div className="stat">
            <div className="label">30-day avg</div>
            <div className="value">{avg30 !== null ? formatWeight(avg30, u) : '—'}</div>
          </div>
          <div className="stat">
            <div className="label">Rate</div>
            <div className="value">{summary.rate !== null ? (
                <>
                  {formatWeight(summary.rate, u, { signed: true, decimals: 2 })}
                  <small>/wk</small>
                </>
              ) : (
                '—'
              )}</div>
          </div>
          <div className="stat">
            <div className="label">Total change</div>
            <div className="value">{summary.changeKg !== null ? formatWeight(summary.changeKg, u, { signed: true }) : '—'}</div>
          </div>
          {summary.remainingKg !== null && (
            <div className="stat">
              <div className="label">To goal</div>
              <div className="value">{formatWeight(summary.remainingKg, u, { signed: true })}</div>
            </div>
          )}
        </div>
      </section>

      {weekly.length > 0 && (
        <>
          <h2 className="section-title">Weekly averages</h2>
          <div className="list">
            {weekly.map((w, i) => {
              const prev = weekly[i + 1];
              const diff = prev ? w.avg - prev.avg : null;
              return (
                <div key={w.week} className="list-row">
                  <div className="grow">
                    <div className="title">{i === 0 && w.week === startOfWeek(today) ? 'This week' : `Week of ${formatDateShort(w.week)}`}</div>
                    <div className="desc">
                      {w.n} weigh-in{w.n === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="trail">
                    {formatWeight(w.avg, u)}
                    {diff !== null && (
                      <span className="pill" style={{ marginLeft: 6 }}>
                        {formatWeight(diff, u, { signed: true })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {all.length > 0 && (
        <>
          <h2 className="section-title">History</h2>
          <div className="list">
            {[...all]
              .reverse()
              .slice(0, 60)
              .map((w) => (
                <div key={w.id} className="list-row">
                  <button className="grow" style={{ all: 'unset', flex: 1, cursor: 'pointer' }} onClick={() => setSheet({ editing: w })}>
                    <div className="title">{round(toDisplayWeight(w.weightKg, u), 1)} {u}</div>
                    <div className="desc">{relativeDay(w.date, today)}</div>
                  </button>
                  <button className="icon-btn" onClick={() => void del(w)} aria-label="Delete weigh-in">
                    <Icon name="trash" width={20} height={20} color="var(--text-3)" />
                  </button>
                </div>
              ))}
          </div>
        </>
      )}

      <div className="banner">
        <span className="banner-icon">
          <Icon name="sparkles" />
        </span>
        <div className="grow muted">Body measurements, progress photos, goals and full analytics are coming in Phase 3.</div>
      </div>

      {sheet && <LogWeightSheet profile={profile} last={all.at(-1) ?? null} editing={sheet.editing} onClose={() => setSheet(null)} />}
    </main>
  );
}
