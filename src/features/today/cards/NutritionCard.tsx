import { useState } from 'react';
import { CardHead } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { ProgressBar } from '../../../components/ProgressBar';
import type { Profile } from '../../../db/types';
import { formatInt } from '../../../lib/format';
import type { Intake } from '../../../lib/intake';
import { AddFoodSheet } from '../../nutrition/AddFoodSheet';
import { usePlanItems } from '../../../db/hooks';
import { markEaten } from '../../nutrition/planActions';
import { Link } from 'react-router-dom';

export function NutritionCard({ profile, intake, date }: { profile: Profile; intake: Intake; date: string }) {
  const [adding, setAdding] = useState(false);
  const planned = (usePlanItems(date, date) ?? []).filter((p) => !p.loggedId);
  const slotOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
  planned.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot));
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
      {planned.length > 0 && (
        <div className="planned-today">
          <span className="cmp-label">Planned today</span>
          {planned.slice(0, 3).map((p) => (
            <div key={p.id} className="planned-row">
              <div className="grow">
                <div className="title">{p.name}</div>
                <div className="desc">
                  {p.slot} · {formatInt(p.kcal)} kcal · {formatInt(p.proteinG)} g protein
                </div>
              </div>
              <button className="btn planned-eat" onClick={() => void markEaten(p)}>
                Eaten
              </button>
            </div>
          ))}
          {planned.length > 3 && (
            <Link to="/nutrition/plan" className="faint" style={{ fontSize: 13 }}>
              +{planned.length - 3} more planned
            </Link>
          )}
        </div>
      )}
      <button className="btn btn-block" onClick={() => setAdding(true)}>
        <Icon name="plus" />
        Add food
      </button>
      {adding && <AddFoodSheet date={date} onClose={() => setAdding(false)} />}
    </section>
  );
}
