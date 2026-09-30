import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../../components/Icon';
import { SubHeader } from '../../../components/PageHeader';
import { ProgressBar } from '../../../components/ProgressBar';
import { useToast } from '../../../components/Toast';
import { updateProfile } from '../../../db/repo';
import { ALLERGENS, CUISINES, type FoodChallenge, type FoodPrefs, type Profile } from '../../../db/types';
import { GOALS } from '../../../lib/calc/nutrition';
import { CUISINE_LABEL, prefsOf, prefTips } from '../../../lib/calc/foodPrefs';
import { ALLERGEN_LABEL } from '../../../lib/calc/ingredients';
import '../nutrition.css';

type Opt<T> = { value: T; label: string; desc?: string };

const FOCUS: Opt<FoodPrefs['focus']>[] = [
  { value: 'protein', label: 'Hitting my protein', desc: 'Build or keep muscle' },
  { value: 'fullness', label: 'Feeling full on fewer calories', desc: 'Best for fat loss' },
  { value: 'fuel', label: 'Eating enough to grow', desc: 'Bigger, calorie-rich meals' },
  { value: 'healthy', label: 'Eating healthier overall', desc: 'More veg, fibre and balance' },
  { value: 'time', label: 'Saving time', desc: 'Quick meals and batch cooking' },
];
const DIETS: Opt<FoodPrefs['diet']>[] = [
  { value: 'everything', label: 'I eat everything' },
  { value: 'pescatarian', label: 'Pescatarian', desc: 'Fish, no meat' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
];
const DISLIKES = ['mushroom', 'fish', 'prawn', 'tofu', 'beans', 'lentil', 'chickpea', 'cottage cheese', 'avocado', 'broccoli', 'sweet potato', 'egg', 'spinach', 'pepper', 'couscous', 'curry'];
const CHALLENGES: Opt<FoodChallenge>[] = [
  { value: 'snacking', label: 'Evening snacking' },
  { value: 'protein', label: 'Not enough protein' },
  { value: 'hungry', label: 'Always hungry' },
  { value: 'low-appetite', label: 'Struggle to eat enough' },
  { value: 'eating-out', label: 'Eating out / takeaways' },
  { value: 'no-time', label: 'No time to cook' },
  { value: 'bored', label: 'Getting bored of the same food' },
];
const MINUTES: Opt<number | null>[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: null, label: 'No limit' },
];

function Choice<T>({ options, value, onChange }: { options: Opt<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="choice-list" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={`choice${o.value === value ? ' on' : ''}`} onClick={() => onChange(o.value)}>
          <span className="radio" aria-hidden="true" />
          <span className="grow">
            <b>{o.label}</b>
            {o.desc && <span className="desc">{o.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Multi<T extends string>({ options, value, onChange }: { options: Opt<T>[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="chip-wrap">
      {options.map((o) => (
        <button key={o.value} className="chip" aria-pressed={value.includes(o.value)} onClick={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Tell me how you eat": a short questionnaire that shapes recipe suggestions and auto-fill. */
export function FoodPrefsPage({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [a, setA] = useState<FoodPrefs>(() => prefsOf(profile));
  const [step, setStep] = useState(0);
  const [other, setOther] = useState('');
  const set = (p: Partial<FoodPrefs>) => setA((x) => ({ ...x, ...p }));

  const steps: { title: string; hint?: string; body: ReactNode }[] = [
    {
      title: 'What matters most right now?',
      hint: `Your goal is “${GOALS[profile.goal].label}” with ${profile.calorieTarget} kcal and ${profile.proteinTarget} g protein a day. Recipes will be picked to support it.`,
      body: <Choice options={FOCUS} value={a.focus} onChange={(focus) => set({ focus })} />,
    },
    { title: 'How do you eat?', body: <Choice options={DIETS} value={a.diet} onChange={(diet) => set({ diet })} /> },
    {
      title: 'Any allergies or intolerances?',
      hint: 'Recipes with these are left out. This works from ingredient names — always check labels if an allergy is serious.',
      body: <Multi options={ALLERGENS.map((x) => ({ value: x, label: ALLERGEN_LABEL[x] }))} value={a.avoid} onChange={(avoid) => set({ avoid })} />,
    },
    {
      title: 'Anything you don’t like?',
      hint: 'Tap any you’d rather not eat, or type your own.',
      body: (
        <>
          <Multi options={[...new Set([...DISLIKES, ...a.dislikes])].map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} value={a.dislikes} onChange={(dislikes) => set({ dislikes })} />
          <form
            className="barcode-manual"
            onSubmit={(e) => {
              e.preventDefault();
              const w = other.trim().toLowerCase();
              if (w && !a.dislikes.includes(w)) set({ dislikes: [...a.dislikes, w] });
              setOther('');
            }}
          >
            <div className="input-wrap">
              <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. coriander" aria-label="Another food you don't like" enterKeyHint="done" />
            </div>
            <button className="btn" disabled={!other.trim()}>
              Add
            </button>
          </form>
        </>
      ),
    },
    {
      title: 'How do you like to eat in a day?',
      body: (
        <>
          <span className="label">Breakfast</span>
          <Choice
            options={[
              { value: true, label: 'I eat breakfast' },
              { value: false, label: 'I skip breakfast', desc: 'Your calories are spread over the other meals' },
            ]}
            value={a.breakfast}
            onChange={(breakfast) => set({ breakfast })}
          />
          <span className="label">Snacks</span>
          <Choice
            options={[
              { value: 0 as const, label: 'No snacks' },
              { value: 1 as const, label: 'One snack' },
              { value: 2 as const, label: 'Two snacks' },
            ]}
            value={a.snacks}
            onChange={(snacks) => set({ snacks })}
          />
          <span className="label">Breakfast variety</span>
          <Choice
            options={[
              { value: false, label: 'Mix it up' },
              { value: true, label: 'Same breakfast every day is fine', desc: 'Simpler shopping' },
            ]}
            value={a.sameBreakfast}
            onChange={(sameBreakfast) => set({ sameBreakfast })}
          />
        </>
      ),
    },
    {
      title: 'How long can you spend cooking?',
      hint: 'For lunch and dinner. Batch-cook recipes are allowed twice as long, since they cover several meals.',
      body: (
        <>
          <span className="label">On weekdays</span>
          <Multi
            options={MINUTES.map((m) => ({ value: String(m.value), label: m.label }))}
            value={[String(a.weekdayMin)]}
            onChange={(v) => set({ weekdayMin: v.at(-1) === 'null' ? null : Number(v.at(-1)) })}
          />
          <span className="label">At weekends</span>
          <Multi
            options={MINUTES.map((m) => ({ value: String(m.value), label: m.label }))}
            value={[String(a.weekendMin)]}
            onChange={(v) => set({ weekendMin: v.at(-1) === 'null' ? null : Number(v.at(-1)) })}
          />
        </>
      ),
    },
    {
      title: 'How do you feel about batch cooking?',
      body: (
        <Choice<FoodPrefs['batch']>
          options={[
            { value: 'love', label: 'Love it', desc: 'Cook once, eat for days' },
            { value: 'sometimes', label: 'Sometimes' },
            { value: 'fresh', label: 'I’d rather cook fresh' },
          ]}
          value={a.batch}
          onChange={(batch) => set({ batch })}
        />
      ),
    },
    {
      title: 'What’s your food budget like?',
      body: (
        <Choice<FoodPrefs['budget']>
          options={[
            { value: 'tight', label: 'Tight', desc: 'Favour cheaper ingredients (beans, eggs, chicken, lentils)' },
            { value: 'normal', label: 'Normal' },
            { value: 'treat', label: 'Happy to spend a bit more', desc: 'Salmon, steak and prawns are fine' },
          ]}
          value={a.budget}
          onChange={(budget) => set({ budget })}
        />
      ),
    },
    {
      title: 'Which cuisines do you enjoy?',
      hint: 'Pick any — these come up more often.',
      body: <Multi options={CUISINES.map((c) => ({ value: c, label: CUISINE_LABEL[c] }))} value={a.cuisines} onChange={(cuisines) => set({ cuisines })} />,
    },
    {
      title: 'What gets in the way most?',
      hint: 'Pick up to three. You’ll get tips and recipes aimed at these.',
      body: <Multi options={CHALLENGES} value={a.challenges} onChange={(challenges) => set({ challenges: challenges.slice(-3) })} />,
    },
  ];
  const last = step === steps.length;

  async function save() {
    await updateProfile({ foodPrefs: { ...a, answeredAt: Date.now() } });
    toast('Thanks — recipes and auto-fill now follow your answers');
    navigate('/nutrition/meals');
  }

  return (
    <main className="page">
      <SubHeader title="How you eat" back="/nutrition/meals" />
      <ProgressBar value={Math.min(step, steps.length)} max={steps.length} tone="var(--accent)" />
      {!last ? (
        <section className="card wizard-step">
          <p className="faint" style={{ fontSize: 13 }}>
            Question {step + 1} of {steps.length}
          </p>
          <h2 className="wizard-title">{steps[step].title}</h2>
          {steps[step].hint && <p className="muted" style={{ fontSize: 14 }}>{steps[step].hint}</p>}
          {steps[step].body}
        </section>
      ) : (
        <section className="card wizard-step">
          <h2 className="wizard-title">Here’s how I’ll use this</h2>
          <ul className="summary-list">
            <li>
              Recipes are filtered to <b>{DIETS.find((d) => d.value === a.diet)!.label.toLowerCase()}</b>
              {a.avoid.length ? `, without ${a.avoid.map((x) => ALLERGEN_LABEL[x].toLowerCase()).join(', ')}` : ''}
              {a.dislikes.length ? ` and no ${a.dislikes.join(', ')}` : ''}.
            </li>
            <li>
              “For you” ranks them for <b>{FOCUS.find((f) => f.value === a.focus)!.label.toLowerCase()}</b>
              {a.cuisines.length ? `, with more ${a.cuisines.map((c) => CUISINE_LABEL[c]).join(', ')}` : ''}
              {a.budget === 'tight' ? ', favouring budget-friendly ingredients' : ''}.
            </li>
            <li>
              Auto-fill plans {a.breakfast ? 'breakfast, ' : ''}lunch, dinner{a.snacks ? ` and ${a.snacks} snack${a.snacks > 1 ? 's' : ''}` : ''}
              {a.weekdayMin ? `, with weekday meals under ${a.weekdayMin} min` : ''}
              {a.batch === 'love' ? ' and plenty of batch cooking' : ''}.
            </li>
          </ul>
          {prefTips(a, profile)
            .slice(0, 3)
            .map((t) => (
              <div key={t.text} className="insight">
                <span className={`pill kind-${t.kind}`}>{t.kind[0].toUpperCase() + t.kind.slice(1)}</span>
                <p>{t.text}</p>
              </div>
            ))}
          <p className="faint" style={{ fontSize: 13 }}>
            Your calorie and protein targets don’t change — edit them any time in <Link to="/more/targets">Daily targets</Link>.
          </p>
        </section>
      )}
      <div className="btn-row">
        <button className="btn" onClick={() => (step === 0 ? navigate('/nutrition/meals') : setStep(step - 1))}>
          <Icon name="chevronLeft" /> {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {last ? (
          <button className="btn btn-primary" onClick={() => void save()}>
            <Icon name="check" /> Save my answers
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
            Next <Icon name="chevronRight" />
          </button>
        )}
      </div>
    </main>
  );
}
