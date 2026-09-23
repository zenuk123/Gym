import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { HeightField } from '../../components/HeightField';
import { NumberField, TextField } from '../../components/NumberField';
import { Segmented } from '../../components/Segmented';
import { InstallBanner } from '../../components/InstallBanner';
import { create, saveProfile } from '../../db/repo';
import type { ActivityLevel, Goal, LengthUnit, Sex, WeightUnit } from '../../db/types';
import { ACTIVITY_LEVELS, GOALS, suggestTargets } from '../../lib/calc/nutrition';
import { todayISO } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { fromDisplayWeight, parseDecimal, round, toDisplayWeight } from '../../lib/units';
import { cloudConfigured } from '../../sync/config';
import { SignInSheet } from '../more/SignInSheet';
import './onboarding.css';

const GOAL_EMOJI: Record<Goal, string> = { lose: '🔥', maintain: '⚖️', gain_weight: '📈', gain_muscle: '💪' };
const STEPS = ['welcome', 'about', 'body', 'goal', 'activity', 'targets'] as const;
type Step = (typeof STEPS)[number];

const thisYear = new Date().getFullYear();

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [signIn, setSignIn] = useState(false);
  const [saving, setSaving] = useState(false);

  // About you
  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex>('male');
  const [birthYear, setBirthYear] = useState('');
  // Body
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('cm');
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weight, setWeight] = useState('');
  const [target, setTarget] = useState('');
  // Goal + activity
  const [goal, setGoal] = useState<Goal | null>(null);
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  // Targets (strings so the user can edit freely; null = use suggestion)
  const [kcal, setKcal] = useState<string | null>(null);
  const [protein, setProtein] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState(4);

  const by = parseDecimal(birthYear);
  const birthYearValid = by !== null && by >= thisYear - 100 && by <= thisYear - 13;
  const w = parseDecimal(weight);
  const weightKg = w !== null ? fromDisplayWeight(w, weightUnit) : null;
  const weightValid = weightKg !== null && weightKg >= 25 && weightKg <= 350;
  const t = parseDecimal(target);
  const targetKg = t !== null && target.trim() !== '' ? fromDisplayWeight(t, weightUnit) : null;
  const targetValid = target.trim() === '' || (targetKg !== null && targetKg >= 25 && targetKg <= 350);

  const suggestion = useMemo(() => {
    if (!birthYearValid || !weightValid || !heightCm || !goal || !activity) return null;
    return suggestTargets({ sex, birthYear: by!, heightCm, weightKg: weightKg!, activityLevel: activity, goal });
  }, [sex, by, birthYearValid, heightCm, weightKg, weightValid, goal, activity]);

  const kcalStr = kcal ?? (suggestion ? String(suggestion.calories.target) : '');
  const proteinStr = protein ?? (suggestion ? String(suggestion.protein) : '');
  const kcalNum = parseDecimal(kcalStr);
  const proteinNum = parseDecimal(proteinStr);
  const targetsValid = kcalNum !== null && kcalNum >= 800 && kcalNum <= 8000 && proteinNum !== null && proteinNum >= 20 && proteinNum <= 500;

  const canContinue: Record<Step, boolean> = {
    welcome: true,
    about: name.trim().length > 0 && birthYearValid,
    body: heightCm !== null && weightValid && targetValid,
    goal: goal !== null,
    activity: activity !== null,
    targets: targetsValid,
  };

  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]);
  const back = () => setStep(STEPS[Math.max(0, idx - 1)]);

  const direction =
    targetKg !== null && weightKg !== null
      ? targetKg > weightKg + 0.5
        ? 'gain'
        : targetKg < weightKg - 0.5
          ? 'lose'
          : 'same'
      : null;

  async function finish() {
    if (!suggestion || !goal || !activity || !heightCm || weightKg === null) return;
    setSaving(true);
    const today = todayISO();
    await create('weights', { date: today, weightKg: round(weightKg, 2), note: null });
    await saveProfile({
      name: name.trim(),
      sex,
      birthYear: by!,
      heightCm: round(heightCm, 1),
      activityLevel: activity,
      goal,
      startWeightKg: round(weightKg, 2),
      startDate: today,
      targetWeightKg: targetKg !== null ? round(targetKg, 2) : null,
      calorieTarget: Math.round(kcalNum!),
      proteinTarget: Math.round(proteinNum!),
      // null = derive from calories/protein (see estimateMacros); set manually in Targets.
      carbTarget: null,
      fatTarget: null,
      waterTargetMl: 2500,
      workoutsPerWeek: workouts,
      weightUnit,
      lengthUnit,
    });
    // The live profile query flips the app to the Today screen.
  }

  return (
    <div className="page no-nav onboarding">
      {step !== 'welcome' && (
        <div className="ob-top">
          <button className="icon-btn" onClick={back} aria-label="Back">
            <Icon name="chevronLeft" />
          </button>
          <div className="ob-progress" aria-label={`Step ${idx} of ${STEPS.length - 1}`}>
            {STEPS.slice(1).map((s, i) => (
              <span key={s} className={i < idx ? 'on' : ''} />
            ))}
          </div>
          <span style={{ width: 44 }} />
        </div>
      )}

      {step === 'welcome' && (
        <div className="ob-welcome">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={96} height={96} className="ob-logo" />
          <h1>
            Your personal
            <br />
            <span className="accent">fitness OS</span>
          </h1>
          <p className="muted">Training, nutrition and progress in one place — built for your iPhone and it works offline in the gym.</p>
          <ul className="ob-points">
            <li>
              <Icon name="dumbbell" /> Know exactly what to lift today
            </li>
            <li>
              <Icon name="utensils" /> Hit your calories and protein
            </li>
            <li>
              <Icon name="chart" /> See your real progress over time
            </li>
          </ul>
          <InstallBanner />
        </div>
      )}

      {step === 'about' && (
        <section className="ob-step">
          <h1>About you</h1>
          <p className="muted">Used to estimate your daily energy needs.</p>
          <TextField label="First name" value={name} onChange={setName} placeholder="Alex" autoComplete="given-name" />
          <div className="field">
            <span className="label">Sex</span>
            <Segmented
              label="Sex"
              value={sex}
              onChange={setSex}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <NumberField
            label="Year of birth"
            decimal={false}
            value={birthYear}
            onChange={setBirthYear}
            placeholder={String(thisYear - 25)}
            hint={birthYear && !birthYearValid ? 'Enter a 4-digit year (you must be 13 or older).' : undefined}
          />
        </section>
      )}

      {step === 'body' && (
        <section className="ob-step">
          <h1>Your body</h1>
          <p className="muted">Your starting point. Progress is measured from here.</p>
          <div className="field-row">
            <Segmented
              label="Weight unit"
              value={weightUnit}
              onChange={(u) => {
                // Convert what's typed so switching units doesn't change the actual weight.
                const conv = (s: string) => {
                  const n = parseDecimal(s);
                  return n === null ? s : String(round(toDisplayWeight(fromDisplayWeight(n, weightUnit), u), 1));
                };
                setWeight(conv(weight));
                setTarget(conv(target));
                setWeightUnit(u);
              }}
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
            />
            <Segmented
              label="Height unit"
              value={lengthUnit}
              onChange={setLengthUnit}
              options={[
                { value: 'cm', label: 'cm' },
                { value: 'in', label: 'ft / in' },
              ]}
            />
          </div>
          <HeightField key={lengthUnit} cm={heightCm} unit={lengthUnit} onChange={setHeightCm} />
          <NumberField big label="Current weight" suffix={weightUnit} value={weight} onChange={setWeight} placeholder={weightUnit === 'kg' ? '70.0' : '154.0'} />
          <NumberField
            label="Target weight (optional)"
            suffix={weightUnit}
            value={target}
            onChange={setTarget}
            placeholder={weightUnit === 'kg' ? '75.0' : '165.0'}
            hint={
              direction && direction !== 'same' && weightKg !== null && targetKg !== null
                ? `That's ${direction === 'gain' ? '+' : '−'}${round(Math.abs(toDisplayWeight(targetKg - weightKg, weightUnit)), 1)} ${weightUnit} from today.`
                : undefined
            }
          />
        </section>
      )}

      {step === 'goal' && (
        <section className="ob-step">
          <h1>What's your goal?</h1>
          <p className="muted">This sets your calorie and protein targets. You can change it any time.</p>
          <div className="options">
            {(Object.keys(GOALS) as Goal[]).map((g) => (
              <button key={g} type="button" className="option" aria-pressed={goal === g} onClick={() => setGoal(g)}>
                <span className="emoji">{GOAL_EMOJI[g]}</span>
                <span>
                  <div className="title">{GOALS[g].label}</div>
                  <div className="desc">{GOALS[g].hint}</div>
                </span>
              </button>
            ))}
          </div>
          {goal && direction && ((goal === 'lose' && direction === 'gain') || ((goal === 'gain_weight' || goal === 'gain_muscle') && direction === 'lose')) && (
            <p className="error-text">Heads up: your target weight is in the opposite direction to this goal.</p>
          )}
        </section>
      )}

      {step === 'activity' && (
        <section className="ob-step">
          <h1>How active are you?</h1>
          <p className="muted">Include your job and your training.</p>
          <div className="options">
            {(Object.keys(ACTIVITY_LEVELS) as ActivityLevel[]).map((a) => (
              <button key={a} type="button" className="option" aria-pressed={activity === a} onClick={() => setActivity(a)}>
                <span>
                  <div className="title">{ACTIVITY_LEVELS[a].label}</div>
                  <div className="desc">{ACTIVITY_LEVELS[a].hint}</div>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'targets' && suggestion && (
        <section className="ob-step">
          <h1>Your daily targets</h1>
          <p className="muted">
            Estimated maintenance is <b className="num">{formatInt(suggestion.calories.maintenance)} kcal</b>
            {suggestion.calories.adjustment !== 0 && (
              <>
                {' '}
                ({suggestion.calories.adjustment > 0 ? '+' : '−'}
                {Math.abs(suggestion.calories.adjustment)} kcal for your goal)
              </>
            )}
            . Adjust if you know better — these are starting points.
          </p>
          <NumberField big label="Calories" suffix="kcal / day" decimal={false} value={kcalStr} onChange={setKcal} />
          <NumberField
            big
            label="Protein"
            suffix="g / day"
            decimal={false}
            value={proteinStr}
            onChange={setProtein}
            hint={`Suggested ${suggestion.protein} g (${GOALS[goal!].proteinPerKg} g per kg of body weight).`}
          />
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
          {!targetsValid && <p className="error-text">Calories 800–8,000 and protein 20–500 g.</p>}
        </section>
      )}

      <div className="ob-actions">
        {step === 'targets' ? (
          <button className="btn btn-primary btn-lg btn-block" disabled={!targetsValid || saving} onClick={() => void finish()}>
            {saving ? 'Saving…' : "Let's go"}
            <Icon name="chevronRight" />
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={!canContinue[step]} onClick={next}>
            {step === 'welcome' ? 'Get started' : 'Continue'}
            <Icon name="chevronRight" />
          </button>
        )}
        {step === 'welcome' && cloudConfigured && (
          <button className="btn btn-ghost btn-block" onClick={() => setSignIn(true)}>
            I already have an account
          </button>
        )}
      </div>

      {signIn && <SignInSheet onClose={() => setSignIn(false)} />}
    </div>
  );
}
