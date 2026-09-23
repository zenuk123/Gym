import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useFoodLogsRange, useMeasurements, usePhotos, useWaterLogsRange, useWeights } from '../../db/hooks';
import type { Profile } from '../../db/types';
import { nutritionSummary, trainingSummary } from '../../lib/calc/analytics';
import { dailySeries, windowAverage } from '../../lib/calc/weight';
import { addDays, relativeDay } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { formatWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { useTraining } from '../workout/useTraining';
import { LogWeightSheet } from './LogWeightSheet';
import { MeasurementSheet } from './MeasurementSheet';
import { GoalRow } from './GoalRow';
import { ProgressTabs } from './ProgressTabs';
import { AddPhotoSheet } from './photos/AddPhotoSheet';
import { useGoalStatuses } from './useGoalStatuses';
import './progress.css';

/** Headline numbers: the last 4 weeks against the 4 before, plus goals and quick logging. */
export function OverviewPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const t = useTraining();
  const goals = useGoalStatuses(profile);
  const weights = useWeights();
  const measurements = useMeasurements();
  const photos = usePhotos();
  const [sheet, setSheet] = useState<null | 'weight' | 'measure' | 'photo'>(null);
  const curFrom = addDays(today, -27);
  const prevFrom = addDays(today, -55);
  const prevTo = addDays(today, -28);
  const logs = useFoodLogsRange(prevFrom, today);
  const water = useWaterLogsRange(prevFrom, today);
  const u = profile.weightUnit;

  const k = useMemo(() => {
    if (!t || !logs || !water || !weights) return null;
    const tr = (from: string, to: string) => trainingSummary({ finished: t.finished, exMap: t.exMap, pbs: t.pbs, from, to });
    const nu = (from: string, to: string) => nutritionSummary({ logs, water, profile, from, to });
    const series = dailySeries(weights);
    const wNow = windowAverage(series, today, 7);
    const w4 = windowAverage(series, addDays(today, -28), 7);
    return { cur: tr(curFrom, today), prev: tr(prevFrom, prevTo), nCur: nu(curFrom, today), nPrev: nu(prevFrom, prevTo), wChange: wNow !== null && w4 !== null ? wNow - w4 : null };
  }, [t, logs, water, weights, profile, today, curFrom, prevFrom, prevTo]);

  if (!t || !goals || !k) return <main className="page" />;

  const tiles: { label: string; value: string; delta: string | null }[] = [
    { label: 'Workouts', value: String(k.cur.workouts), delta: diff(k.cur.workouts, k.prev.workouts) },
    { label: 'PBs', value: String(k.cur.pbs), delta: diff(k.cur.pbs, k.prev.pbs) },
    { label: 'Volume', value: formatWeight(k.cur.volumeKg, u, { decimals: 0 }), delta: pctDiff(k.cur.volumeKg, k.prev.volumeKg) },
    { label: 'Avg calories', value: k.nCur.avgKcal !== null ? formatInt(k.nCur.avgKcal) : '—', delta: k.nCur.avgKcal !== null && k.nPrev.avgKcal !== null ? diff(Math.round(k.nCur.avgKcal), Math.round(k.nPrev.avgKcal)) : null },
    { label: 'Avg protein', value: k.nCur.avgProtein !== null ? `${formatInt(k.nCur.avgProtein)} g` : '—', delta: k.nCur.avgProtein !== null && k.nPrev.avgProtein !== null ? diff(Math.round(k.nCur.avgProtein), Math.round(k.nPrev.avgProtein), ' g') : null },
    { label: 'Weight (7-day avg)', value: k.wChange !== null ? formatWeight(k.wChange, u, { signed: true }) : '—', delta: null },
  ];
  const lastMeasure = measurements?.at(-1);
  const lastPhoto = photos?.[0];

  return (
    <main className="page">
      <PageHeader title="Progress" />
      <ProgressTabs />

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--accent-text)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="target" />
          </span>
          <h2>Goals</h2>
          <Link className="head-link" to="/progress/goals">
            All
            <Icon name="chevronRight" width={16} height={16} />
          </Link>
        </div>
        {goals.map((s) => (
          <GoalRow key={s.id} s={s} profile={profile} exMap={t.exMap} compact />
        ))}
      </section>

      <h2 className="section-title">Last 4 weeks vs the 4 before</h2>
      <div className="stat-grid">
        {tiles.map((x) => (
          <div key={x.label} className="stat">
            <div className="label">{x.label}</div>
            <div className="value">{x.value}</div>
            {x.delta && <div className="stat-sub">{x.delta}</div>}
          </div>
        ))}
      </div>

      <h2 className="section-title">Log progress</h2>
      <div className="quick-row">
        <button className="btn" onClick={() => setSheet('weight')}>
          <Icon name="scale" /> Weight
        </button>
        <button className="btn" onClick={() => setSheet('measure')}>
          <Icon name="target" /> Measure
        </button>
        <button className="btn" onClick={() => setSheet('photo')}>
          <Icon name="user" /> Photo
        </button>
      </div>
      <div className="list">
        <Link to="/progress/body" className="list-row">
          <div className="grow">
            <div className="title">Measurements</div>
            <div className="desc">{lastMeasure ? `Last measured ${relativeDay(lastMeasure.date, today).toLowerCase()}` : 'None yet'}</div>
          </div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </Link>
        <Link to="/progress/photos" className="list-row">
          <div className="grow">
            <div className="title">Progress photos</div>
            <div className="desc">{lastPhoto ? `${photos!.length} photos · latest ${relativeDay(lastPhoto.date, today).toLowerCase()}` : 'None yet'}</div>
          </div>
          <span className="trail">
            <Icon name="chevronRight" />
          </span>
        </Link>
      </div>

      {sheet === 'weight' && <LogWeightSheet profile={profile} last={weights?.at(-1) ?? null} onClose={() => setSheet(null)} />}
      {sheet === 'measure' && <MeasurementSheet unit={profile.lengthUnit} last={lastMeasure ?? null} onClose={() => setSheet(null)} />}
      {sheet === 'photo' && <AddPhotoSheet onClose={() => setSheet(null)} />}
    </main>
  );
}

function diff(cur: number, prev: number, unit = ''): string {
  const d = cur - prev;
  if (d === 0) return 'same as before';
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString('en-GB')}${unit} vs before`;
}

function pctDiff(cur: number, prev: number): string | null {
  if (prev <= 0) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return p === 0 ? 'same as before' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs before`;
}
