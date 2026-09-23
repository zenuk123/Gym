import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { NumberField } from '../../components/NumberField';
import { SubHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useWeights } from '../../db/hooks';
import { updateProfile } from '../../db/repo';
import type { Profile } from '../../db/types';
import { GOALS, estimateMacros, suggestTargets } from '../../lib/calc/nutrition';
import { summariseWeight } from '../../lib/calc/weight';
import { formatInt } from '../../lib/format';
import { formatWeight, parseDecimal } from '../../lib/units';

const str = (n: number | null) => (n === null ? '' : String(n));

/** Targets are always the user's call — suggestions are shown, never applied automatically. */
export function TargetsSettings({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const toast = useToast();
  const weights = useWeights();
  const [kcal, setKcal] = useState(str(profile.calorieTarget));
  const [protein, setProtein] = useState(str(profile.proteinTarget));
  const [carbs, setCarbs] = useState(str(profile.carbTarget));
  const [fat, setFat] = useState(str(profile.fatTarget));
  const [water, setWater] = useState(String(profile.waterTargetMl / 1000));
  const [workouts, setWorkouts] = useState(profile.workoutsPerWeek);

  const current = useMemo(() => {
    const s = summariseWeight(weights ?? [], profile.startWeightKg, profile.targetWeightKg);
    return s.average7 ?? s.latest?.weightKg ?? profile.startWeightKg;
  }, [weights, profile]);
  const suggestion = suggestTargets({ ...profile, weightKg: current });

  const k = parseDecimal(kcal);
  const p = parseDecimal(protein);
  const c = carbs.trim() === '' ? null : parseDecimal(carbs);
  const f = fat.trim() === '' ? null : parseDecimal(fat);
  const w = parseDecimal(water);
  const valid =
    k !== null && k >= 800 && k <= 8000 && p !== null && p >= 20 && p <= 500 && (carbs.trim() === '' || c !== null) && (fat.trim() === '' || f !== null) && w !== null && w >= 0.5 && w <= 8;
  const derived = k !== null && p !== null ? estimateMacros(k, p) : null;

  async function save() {
    if (!valid) return;
    await updateProfile({
      calorieTarget: Math.round(k!),
      proteinTarget: Math.round(p!),
      carbTarget: c !== null ? Math.round(c) : null,
      fatTarget: f !== null ? Math.round(f) : null,
      waterTargetMl: Math.round(w! * 1000),
      workoutsPerWeek: workouts,
    });
    toast('Targets saved');
    navigate('/more');
  }

  return (
    <main className="page">
      <SubHeader title="Daily targets" />

      <section className="card">
        <div className="card-head" style={{ '--tone': 'var(--coach)' } as React.CSSProperties}>
          <span className="chip-icon">
            <Icon name="sparkles" />
          </span>
          <h2>Suggested for you</h2>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Based on {formatWeight(current, profile.weightUnit)}, {GOALS[profile.goal].label.toLowerCase()}: maintenance ≈{' '}
          <b className="num">{formatInt(suggestion.calories.maintenance)} kcal</b>.
        </p>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">Calories</div>
            <div className="value">{formatInt(suggestion.calories.target)}</div>
          </div>
          <div className="stat">
            <div className="label">Protein</div>
            <div className="value">{suggestion.protein} g</div>
          </div>
        </div>
        <button
          className="btn btn-block"
          onClick={() => {
            setKcal(String(suggestion.calories.target));
            setProtein(String(suggestion.protein));
            setCarbs('');
            setFat('');
          }}
        >
          Use suggestion
        </button>
      </section>

      <div className="field-row">
        <NumberField label="Calories" suffix="kcal" decimal={false} value={kcal} onChange={setKcal} />
        <NumberField label="Protein" suffix="g" decimal={false} value={protein} onChange={setProtein} />
      </div>
      <div className="field-row">
        <NumberField label="Carbs" suffix="g" decimal={false} value={carbs} onChange={setCarbs} placeholder={derived ? `auto ${derived.carbsG}` : 'auto'} />
        <NumberField label="Fat" suffix="g" decimal={false} value={fat} onChange={setFat} placeholder={derived ? `auto ${derived.fatG}` : 'auto'} />
      </div>
      <p className="faint" style={{ fontSize: 13, marginTop: -6 }}>
        Leave carbs/fat empty to split the remaining calories automatically (25% fat).
      </p>
      <NumberField label="Water" suffix="litres / day" value={water} onChange={setWater} />
      <div className="field">
        <span className="label">Workouts per week</span>
        <div className="stepper">
          <button type="button" className="icon-btn" onClick={() => setWorkouts((n) => Math.max(1, n - 1))} aria-label="Fewer">
            <Icon name="minus" />
          </button>
          <span className="big-num">{workouts}</span>
          <button type="button" className="icon-btn" onClick={() => setWorkouts((n) => Math.min(7, n + 1))} aria-label="More">
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Save targets
      </button>
    </main>
  );
}
