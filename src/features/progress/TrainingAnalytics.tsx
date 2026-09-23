import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { BarChart } from '../../components/charts/BarChart';
import { MeterList } from '../../components/charts/Bars';
import { ChartTable } from '../../components/charts/ChartTable';
import { LineChart } from '../../components/LineChart';
import { PageHeader } from '../../components/PageHeader';
import type { Profile } from '../../db/types';
import { trainingSummary } from '../../lib/calc/analytics';
import { weekStreak } from '../../lib/calc/training';
import { addDays, daysBetween, formatDateShort } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { formatWeight, round, toDisplayWeight } from '../../lib/units';
import { useToday } from '../../lib/useToday';
import { MUSCLE_LABEL, useTraining } from '../workout/useTraining';
import { ProgressTabs } from './ProgressTabs';
import { RangeChips } from './RangeChips';
import './progress.css';

const RANGES = [
  { value: 28, label: '4 weeks' },
  { value: 84, label: '12 weeks' },
  { value: 182, label: '6 months' },
  { value: 365, label: '1 year' },
];

export function TrainingAnalytics({ profile }: { profile: Profile }) {
  const t = useTraining();
  const today = useToday();
  const [days, setDays] = useState(84);
  const from = addDays(today, -(days - 1));
  const u = profile.weightUnit;
  const s = useMemo(() => (t ? trainingSummary({ finished: t.finished, exMap: t.exMap, pbs: t.pbs, from, to: today }) : null), [t, from, today]);
  if (!t || !s) return <main className="page" />;

  const weeksInRange = s.weeks.length;
  const onTarget = s.weeks.filter((w) => w.workouts >= profile.workoutsPerWeek).length;
  const volTick = (v: number) => (v >= 1000 ? `${round(toDisplayWeight(v, u) / 1000, 1)}k` : String(Math.round(toDisplayWeight(v, u))));
  const weekLabel = (d: string) => formatDateShort(d);

  return (
    <main className="page">
      <PageHeader title="Progress" />
      <ProgressTabs />
      <RangeChips options={RANGES} value={days} onChange={setDays} />

      {s.workouts === 0 ? (
        <section className="card">
          <EmptyState icon="dumbbell">No finished workouts in this period yet.</EmptyState>
        </section>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Workouts</div>
              <div className="value">{s.workouts}</div>
            </div>
            <div className="stat">
              <div className="label">Per week</div>
              <div className="value">{round(s.workouts / weeksInRange, 1)}</div>
            </div>
            <div className="stat">
              <div className="label">PBs</div>
              <div className="value">{s.pbs}</div>
            </div>
            <div className="stat">
              <div className="label">Sets</div>
              <div className="value">{formatInt(s.sets)}</div>
            </div>
            <div className="stat">
              <div className="label">Volume</div>
              <div className="value">{volTick(s.volumeKg)} {u}</div>
            </div>
            <div className="stat">
              <div className="label">Avg session</div>
              <div className="value">{s.avgMinutes !== null ? `${Math.round(s.avgMinutes)} min` : '—'}</div>
            </div>
          </div>

          <section className="card">
            <h2 className="chart-title">Sessions per week</h2>
            <p className="chart-sub">
              {onTarget} of {weeksInRange} weeks on your target of {profile.workoutsPerWeek} · current streak {weekStreak(t.finished, profile.workoutsPerWeek, today)} weeks
            </p>
            <BarChart
              bars={s.weeks.map((w) => ({ key: w.weekStart, label: weekLabel(w.weekStart), title: `Week of ${formatDateShort(w.weekStart)}`, value: w.workouts }))}
              target={profile.workoutsPerWeek}
              tone="var(--streak)"
              height={150}
              label="Workouts per week"
              formatValue={(v) => `${v} workout${v === 1 ? '' : 's'}`}
              formatTick={(v) => String(v)}
            />
          </section>

          <section className="card">
            <h2 className="chart-title">Weekly volume</h2>
            <p className="chart-sub">Weight × reps of all working sets ({u})</p>
            <BarChart
              bars={s.weeks.map((w) => ({ key: w.weekStart, label: weekLabel(w.weekStart), title: `Week of ${formatDateShort(w.weekStart)}`, value: w.volumeKg }))}
              tone="var(--accent)"
              height={170}
              label={`Weekly training volume in ${u}`}
              formatValue={(v) => formatWeight(v, u, { decimals: 0 })}
              formatTick={volTick}
            />
            <ChartTable
              caption="Weekly training"
              columns={['Week of', 'Workouts', 'Sets', `Volume (${u})`]}
              rows={[...s.weeks].reverse().map((w) => [formatDateShort(w.weekStart), w.workouts, w.sets, formatInt(toDisplayWeight(w.volumeKg, u))])}
            />
          </section>

          {s.muscleSets.length > 0 && (
            <section className="card">
              <h2 className="chart-title">Working sets by muscle</h2>
              <p className="chart-sub">Total over the period · ~10–20 hard sets per muscle per week is a common target</p>
              <MeterList rows={s.muscleSets.map((m) => ({ key: m.muscle, label: MUSCLE_LABEL[m.muscle], value: m.sets }))} tone="var(--protein)" />
            </section>
          )}

          {s.lifts.length > 0 && (
            <>
              <h2 className="section-title">Strength (estimated 1RM)</h2>
              <div className="list">
                {s.lifts.map((l) => (
                  <Link key={l.exerciseId} to={`/workout/exercises/${l.exerciseId}`} className="list-row lift-row">
                    <div className="grow">
                      <div className="title">{t.exMap.get(l.exerciseId)?.name}</div>
                      <div className="desc">
                        {formatWeight(l.firstE1rm, u)} → {formatWeight(l.latestE1rm, u)} · {l.sessions} sessions
                      </div>
                    </div>
                    <div className="lift-spark">
                      {l.points.length >= 2 && (
                        <LineChart
                          compact
                          raw={[]}
                          trend={l.points.map((p) => ({ x: daysBetween(today, p.date), y: p.value }))}
                          tone="var(--accent)"
                          height={36}
                          label={`${t.exMap.get(l.exerciseId)?.name} estimated 1RM trend`}
                        />
                      )}
                    </div>
                    <span className="trail">
                      <b>{l.changePct >= 0 ? '+' : ''}{Math.round(l.changePct)}%</b>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
