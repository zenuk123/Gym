import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/CardHead';
import { ChartTable } from '../../components/charts/ChartTable';
import { Icon } from '../../components/Icon';
import { LineChart } from '../../components/LineChart';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useMeasurements, useWeights } from '../../db/hooks';
import { remove, update } from '../../db/repo';
import type { Measurement, MeasurementSite, Profile, WeightEntry } from '../../db/types';
import { SITE_LABEL, siteSeries, summariseMeasurements } from '../../lib/calc/measurements';
import { dailySeries, monthlyAverages, movingAverage, summariseWeight, windowAverage } from '../../lib/calc/weight';
import { addDays, daysBetween, formatDateShort, parseISODate, relativeDay, startOfWeek } from '../../lib/dates';
import { formatWeight, round, toDisplayLength, toDisplayWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { LogWeightSheet } from './LogWeightSheet';
import { MeasurementSheet } from './MeasurementSheet';
import { ProgressTabs } from './ProgressTabs';
import './progress.css';

type Range = '30' | '90' | '365' | 'all';

/** Body: weight trend + averages, and body measurements. */
export function BodyPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const toast = useToast();
  const weights = useWeights();
  const measurements = useMeasurements();
  const [range, setRange] = useState<Range>('90');
  const [sheet, setSheet] = useState<{ editing?: WeightEntry } | null>(null);
  const [mSheet, setMSheet] = useState<{ editing?: Measurement } | null>(null);
  const [site, setSite] = useState<MeasurementSite | null>(null);
  const [avgView, setAvgView] = useState<'week' | 'month'>('week');
  const u = profile.weightUnit;
  const lu = profile.lengthUnit;

  const all = useMemo(() => weights ?? [], [weights]);
  const ms = useMemo(() => measurements ?? [], [measurements]);
  const summary = useMemo(() => summariseWeight(all, profile.startWeightKg, profile.targetWeightKg), [all, profile]);
  const series = useMemo(() => dailySeries(all), [all]);
  const trend = useMemo(() => movingAverage(series), [series]);
  const from = range === 'all' ? '0000-00-00' : addDays(today, -(Number(range) - 1));
  const toPts = (xs: { date: string; weightKg: number }[]) =>
    xs.filter((d) => d.date >= from).map((d) => ({ x: daysBetween(today, d.date), y: toDisplayWeight(d.weightKg, u) }));
  const xDate = (x: number) => formatDateShort(addDays(today, x));

  const averages = useMemo(() => {
    if (avgView === 'month') {
      return monthlyAverages(series)
        .slice(0, 12)
        .map((m) => ({ key: m.month, label: parseISODate(`${m.month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), avg: m.avg, n: m.n }));
    }
    const weeks = new Map<string, number[]>();
    for (const d of series) weeks.set(startOfWeek(d.date), [...(weeks.get(startOfWeek(d.date)) ?? []), d.weightKg]);
    return [...weeks.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 8)
      .map(([week, ws]) => ({
        key: week,
        label: week === startOfWeek(today) ? 'This week' : `Week of ${formatDateShort(week)}`,
        avg: ws.reduce((s, w) => s + w, 0) / ws.length,
        n: ws.length,
      }));
  }, [series, avgView, today]);

  const sites = useMemo(() => summariseMeasurements(ms), [ms]);
  const activeSite = site ?? sites[0]?.site ?? null;
  const siteData = activeSite ? siteSeries(ms, activeSite) : [];
  const avg30 = summary.latest ? windowAverage(series, summary.latest.date, 30) : null;
  const fmtLen = (cm: number, signed = false) => {
    const v = round(toDisplayLength(cm, lu), 1) || 0;
    return `${signed && v > 0 ? '+' : ''}${v} ${lu}`;
  };

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
      <ProgressTabs />

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--weight)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="scale" />
          </span>
          <h2>Body weight</h2>
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
              height={200}
              formatX={xDate}
              formatValue={(v) => `${round(v, 1)} ${u}`}
              label="Body weight: 7-day average with daily weigh-ins"
              seriesName="7-day average"
              rawName="Weigh-in"
            />
            <p className="faint" style={{ fontSize: 12 }}>
              Line = 7-day average · dots = weigh-ins{profile.targetWeightKg !== null && ' · dashed = goal'} · drag to read values
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
            <div className="value">
              {summary.rate !== null ? (
                <>
                  {formatWeight(summary.rate, u, { signed: true, decimals: 2 })}
                  <small>/wk</small>
                </>
              ) : (
                '—'
              )}
            </div>
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

      {averages.length > 0 && (
        <>
          <h2 className="section-title section-row">
            <span>Averages</span>
          </h2>
          <Segmented
            label="Average period"
            value={avgView}
            onChange={setAvgView}
            options={[
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
            ]}
          />
          <div className="list">
            {averages.map((w, i) => {
              const prev = averages[i + 1];
              const diff = prev ? w.avg - prev.avg : null;
              return (
                <div key={w.key} className="list-row">
                  <div className="grow">
                    <div className="title">{w.label}</div>
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

      {/* ── Measurements ───────────────────────────────────────────── */}
      <h2 className="section-title section-row">
        <span>Measurements</span>
        <button className="link-btn" onClick={() => setMSheet({})}>
          <Icon name="plus" width={16} height={16} /> Add
        </button>
      </h2>
      {sites.length === 0 ? (
        <section className="card">
          <EmptyState icon="target">
            <b className="empty-title">Track more than the scale</b>
            Chest, waist, arms, thighs, shoulders, hips and neck — in {lu === 'cm' ? 'centimetres' : 'inches'}.
          </EmptyState>
          <button className="btn btn-block" onClick={() => setMSheet({})}>
            <Icon name="plus" /> Add measurements
          </button>
        </section>
      ) : (
        <section className="card">
          <div className="site-grid">
            {sites.map((s) => (
              <button key={s.site} className={`site-tile${s.site === activeSite ? ' on' : ''}`} onClick={() => setSite(s.site)} aria-pressed={s.site === activeSite}>
                <span className="label">{SITE_LABEL[s.site]}</span>
                <span className="value">{fmtLen(s.latest.value)}</span>
                <span className="delta">{s.count > 1 ? `${fmtLen(s.sinceFirst, true)} total` : relativeDay(s.latest.date, today)}</span>
              </button>
            ))}
          </div>
          {activeSite && siteData.length >= 2 ? (
            <>
              <LineChart
                raw={[]}
                trend={siteData.map((p) => ({ x: daysBetween(today, p.date), y: toDisplayLength(p.value, lu) }))}
                tone="var(--accent)"
                height={160}
                formatX={xDate}
                formatY={(v) => String(round(v, 1))}
                formatValue={(v) => `${round(v, 1)} ${lu}`}
                label={`${SITE_LABEL[activeSite]} measurements over time`}
                seriesName={SITE_LABEL[activeSite]}
              />
              <ChartTable
                caption={`${SITE_LABEL[activeSite]} history`}
                columns={['Date', SITE_LABEL[activeSite]]}
                rows={[...siteData].reverse().map((p) => [formatDateShort(p.date), fmtLen(p.value)])}
              />
            </>
          ) : (
            <p className="faint" style={{ fontSize: 13 }}>
              Measure again in a couple of weeks to see a trend.
            </p>
          )}
        </section>
      )}
      {ms.length > 0 && (
        <div className="list">
          {[...ms]
            .reverse()
            .slice(0, 10)
            .map((m) => (
              <button key={m.id} className="list-row" onClick={() => setMSheet({ editing: m })}>
                <div className="grow">
                  <div className="title">{relativeDay(m.date, today)}</div>
                  <div className="desc">
                    {summariseMeasurements([m])
                      .map((s) => `${SITE_LABEL[s.site]} ${fmtLen(s.latest.value)}`)
                      .join(' · ')}
                  </div>
                </div>
                <span className="trail">
                  <Icon name="edit" />
                </span>
              </button>
            ))}
        </div>
      )}

      {all.length > 0 && (
        <>
          <h2 className="section-title">Weigh-ins</h2>
          <div className="list">
            {[...all]
              .reverse()
              .slice(0, 30)
              .map((w) => (
                <div key={w.id} className="list-row">
                  <button className="grow" style={{ all: 'unset', flex: 1, cursor: 'pointer' }} onClick={() => setSheet({ editing: w })}>
                    <div className="title">
                      {round(toDisplayWeight(w.weightKg, u), 1)} {u}
                    </div>
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

      {sheet && <LogWeightSheet profile={profile} last={all.at(-1) ?? null} editing={sheet.editing} onClose={() => setSheet(null)} />}
      {mSheet && <MeasurementSheet unit={lu} last={ms.at(-1) ?? null} editing={mSheet.editing} onClose={() => setMSheet(null)} />}
    </main>
  );
}
