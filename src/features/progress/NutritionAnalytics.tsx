import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { BarChart } from '../../components/charts/BarChart';
import { StackBar } from '../../components/charts/Bars';
import { ChartTable } from '../../components/charts/ChartTable';
import { PageHeader } from '../../components/PageHeader';
import { useFoodLogsRange, useWaterLogsRange } from '../../db/hooks';
import type { Profile } from '../../db/types';
import { nutritionSummary } from '../../lib/calc/analytics';
import { addDays, formatDateShort, parseISODate } from '../../lib/dates';
import { formatInt, formatLitres } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { ProgressTabs } from './ProgressTabs';
import { RangeChips } from './RangeChips';
import './progress.css';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export function NutritionAnalytics({ profile }: { profile: Profile }) {
  const today = useToday();
  const [days, setDays] = useState(30);
  const from = addDays(today, -(days - 1));
  const logs = useFoodLogsRange(from, today);
  const water = useWaterLogsRange(from, today);
  const s = useMemo(() => (logs && water ? nutritionSummary({ logs, water, profile, from, to: today }) : null), [logs, water, profile, from, today]);
  if (!s) return <main className="page" />;

  const dayLabel = (d: string) => (days <= 7 ? parseISODate(d).toLocaleDateString('en-GB', { weekday: 'short' }) : String(parseISODate(d).getDate()));
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <main className="page">
      <PageHeader title="Progress" />
      <ProgressTabs />
      <RangeChips options={RANGES} value={days} onChange={setDays} />

      {s.daysLogged === 0 ? (
        <section className="card">
          <EmptyState icon="utensils">
            <b className="empty-title">No food logged in this period</b>
            Log meals from Today or the Nutrition tab and your averages appear here.
          </EmptyState>
          <Link to="/nutrition" className="btn btn-block">
            Go to Nutrition
          </Link>
        </section>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Avg calories</div>
              <div className="value">{formatInt(s.avgKcal ?? 0)}</div>
              <div className="stat-sub">{pct(s.avgKcal ?? 0, s.targets.kcal)}% of {formatInt(s.targets.kcal)}</div>
            </div>
            <div className="stat">
              <div className="label">Avg protein</div>
              <div className="value">{formatInt(s.avgProtein ?? 0)} g</div>
              <div className="stat-sub">{pct(s.avgProtein ?? 0, s.targets.protein)}% of {s.targets.protein} g</div>
            </div>
            <div className="stat">
              <div className="label">Days logged</div>
              <div className="value">
                {s.daysLogged}/{s.daysInRange}
              </div>
            </div>
            <div className="stat">
              <div className="label">Calories on target</div>
              <div className="value">{s.kcalOnTarget} days</div>
              <div className="stat-sub">within ±10%</div>
            </div>
            <div className="stat">
              <div className="label">Protein hit</div>
              <div className="value">{s.proteinHit} days</div>
              <div className="stat-sub">≥ 90% of target</div>
            </div>
            <div className="stat">
              <div className="label">Avg water</div>
              <div className="value">{s.avgWaterMl !== null ? formatLitres(s.avgWaterMl) : '—'}</div>
            </div>
          </div>

          <section className="card">
            <h2 className="chart-title">Daily calories</h2>
            <p className="chart-sub">Days without a log show as gaps · dashed line = target</p>
            <BarChart
              bars={s.days.map((d) => ({ key: d.date, label: dayLabel(d.date), title: formatDateShort(d.date), value: d.kcal }))}
              target={s.targets.kcal}
              tone="var(--kcal)"
              label="Daily calories"
              formatValue={(v) => `${formatInt(v)} kcal`}
              formatTick={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))}
            />
          </section>

          <section className="card">
            <h2 className="chart-title">Daily protein</h2>
            <BarChart
              bars={s.days.map((d) => ({ key: d.date, label: dayLabel(d.date), title: formatDateShort(d.date), value: d.proteinG }))}
              target={s.targets.protein}
              tone="var(--protein)"
              height={150}
              label="Daily protein in grams"
              formatValue={(v) => `${formatInt(v)} g`}
              formatTick={(v) => String(Math.round(v))}
            />
            <ChartTable
              caption="Daily intake"
              columns={['Date', 'kcal', 'Protein (g)']}
              rows={[...s.days].reverse().filter((d) => d.logged).map((d) => [formatDateShort(d.date), formatInt(d.kcal), formatInt(d.proteinG)])}
            />
          </section>

          <section className="card">
            <h2 className="chart-title">Where your calories come from</h2>
            {s.macroSplit ? (
              <StackBar
                label="Macro split"
                parts={[
                  { key: 'p', label: 'Protein', share: s.macroSplit.protein, color: 'var(--protein)', detail: `${formatInt(s.avgProtein ?? 0)} g/day` },
                  { key: 'c', label: 'Carbs', share: s.macroSplit.carbs, color: 'var(--carbs)', detail: `${formatInt(s.avgCarbs ?? 0)} g/day` },
                  { key: 'f', label: 'Fat', share: s.macroSplit.fat, color: 'var(--fat)', detail: `${formatInt(s.avgFat ?? 0)} g/day` },
                ]}
              />
            ) : (
              <p className="faint" style={{ fontSize: 14 }}>
                Add carbs and fat when logging food to see your macro split.
              </p>
            )}
            <p className="faint" style={{ fontSize: 13 }}>
              Targets: {s.targets.protein} g protein · {s.targets.carbs} g carbs · {s.targets.fat} g fat
            </p>
          </section>
        </>
      )}
    </main>
  );
}
