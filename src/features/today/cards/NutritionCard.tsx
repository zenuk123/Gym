import { useState } from 'react';
import { CardHead } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { ProgressBar } from '../../../components/ProgressBar';
import type { Profile } from '../../../db/types';
import { formatInt } from '../../../lib/format';
import type { Intake } from '../../../lib/intake';
import { QuickAddSheet } from '../../nutrition/QuickAddSheet';

export function NutritionCard({ profile, intake, date }: { profile: Profile; intake: Intake; date: string }) {
  const [adding, setAdding] = useState(false);
  const kcalLeft = profile.calorieTarget - intake.kcal;
  const proteinLeft = profile.proteinTarget - intake.proteinG;

  return (
    <section className="card">
      <CardHead icon="utensils" tone="var(--kcal)" title="Nutrition" link={{ to: '/nutrition', label: 'Meals' }} />
      <div className="macro-row">
        <div className="top">
          <span className="name">Calories</span>
          <span className="amount">
            <b>{formatInt(intake.kcal)}</b> / {formatInt(profile.calorieTarget)} kcal
          </span>
        </div>
        <ProgressBar value={intake.kcal} max={profile.calorieTarget} tone="var(--kcal)" allowOver />
      </div>
      <div className="macro-row">
        <div className="top">
          <span className="name">Protein</span>
          <span className="amount">
            <b>{formatInt(intake.proteinG)}</b> / {formatInt(profile.proteinTarget)} g
          </span>
        </div>
        <ProgressBar value={intake.proteinG} max={profile.proteinTarget} tone="var(--protein)" />
      </div>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">{kcalLeft >= 0 ? 'Remaining' : 'Over by'}</div>
          <div className="value" style={{ color: kcalLeft >= 0 ? undefined : 'var(--danger)' }}>
            {formatInt(Math.abs(kcalLeft))} <small className="faint">kcal</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">Protein to go</div>
          <div className="value">
            {proteinLeft > 0 ? formatInt(proteinLeft) : '✓'} {proteinLeft > 0 && <small className="faint">g</small>}
          </div>
        </div>
      </div>
      <button className="btn btn-block" onClick={() => setAdding(true)}>
        <Icon name="plus" />
        Quick add food
      </button>
      {adding && <QuickAddSheet date={date} onClose={() => setAdding(false)} />}
    </section>
  );
}
