import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useFoodLogs, useFoods, useRecentFoodLogs } from '../../db/hooks';
import { create } from '../../db/repo';
import type { MealSlot, Profile, SavedMeal } from '../../db/types';
import { recentFoods } from '../../lib/calc/food';
import { planMeal } from '../../lib/calc/plan';
import { formatDateShort, todayISO } from '../../lib/dates';
import { formatInt } from '../../lib/format';
import { sumIntake } from '../../lib/intake';
import { addPlanItem } from '../nutrition/planActions';
import { MEALS } from '../nutrition/QuickAddSheet';
import { aiReady, loadAi, useAiSettings } from './aiSettings';
import { createClient, describeError, modelParams } from './claude';
import { MEAL_SCHEMA, MEAL_SYSTEM, mealPrompt, toMealIdeas, type MealIdea, type MealIdeaRequest } from './mealIdeas';
import './coach.css';

type Kind = MealIdeaRequest['kind'];

/** AI meal generator: ideas that fit your targets, built from foods you already use. Nothing is saved until you tap. */
export function MealIdeasSheet({ profile, date, initialKind = 'meal', initialSlot = 'dinner', onClose }: { profile: Profile; date: string; initialKind?: Kind; initialSlot?: MealSlot; onClose: () => void }) {
  const toast = useToast();
  const settings = useAiSettings();
  const foods = useFoods();
  const recent = useRecentFoodLogs(60);
  const todayLogs = useFoodLogs(date);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [prefs, setPrefs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<MealIdea[] | null>(null);
  const [saved, setSaved] = useState<Record<string, SavedMeal>>({});
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);

  const common = useMemo(() => {
    if (!foods || !recent) return [];
    const mine = recentFoods(recent, new Map(foods.map((f) => [f.id, f])), 30).map((r) => r.food);
    const favs = foods.filter((f) => f.favourite && !f.archived && !mine.includes(f));
    return [...mine, ...favs];
  }, [foods, recent]);

  async function generate() {
    const s = await loadAi();
    if (!foods) return;
    setBusy(true);
    setError(null);
    setIdeas(null);
    const eaten = sumIntake(todayLogs ?? []);
    const req: MealIdeaRequest = {
      kind,
      slot,
      count: 3,
      preferences: prefs,
      targets: { kcal: profile.calorieTarget, proteinG: profile.proteinTarget },
      remainingToday: { kcal: profile.calorieTarget - eaten.kcal, proteinG: profile.proteinTarget - eaten.proteinG },
      foods: common,
    };
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const client = await createClient(s);
      const msg = await client.beta.messages
        .stream(
          {
            ...modelParams(s.model),
            max_tokens: 64000,
            thinking: { type: 'adaptive' },
            system: MEAL_SYSTEM,
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: MEAL_SCHEMA as unknown as Record<string, unknown> } },
            messages: [{ role: 'user', content: mealPrompt(req) }],
          },
          { signal: ctrl.signal },
        )
        .finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('No ideas for that request — try rewording your preferences.');
      if (msg.stop_reason === 'max_tokens') throw new Error('The answer was cut short. Try again.');
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const out = toMealIdeas(JSON.parse(text), foods);
      if (!out.length) throw new Error('Couldn’t read any ideas from the answer. Try again.');
      setIdeas(out);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Couldn’t read the answer. Try again.' : await describeError(err));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  async function saveMeal(i: MealIdea): Promise<SavedMeal> {
    if (saved[i.key]) return saved[i.key];
    const m = await create('meals', { name: i.name, slot: i.slot, servings: i.servings, items: i.items, notes: i.method || null, favourite: false });
    setSaved((x) => ({ ...x, [i.key]: m }));
    return m;
  }

  async function plan(i: MealIdea) {
    const m = await saveMeal(i);
    await addPlanItem(planMeal(date, kind === 'rest-of-day' ? i.slot : slot, m, 1));
    setPlanned((p) => new Set(p).add(i.key));
    toast(`Planned for ${formatDateShort(date)} — shopping list can pick it up`);
  }

  if (!settings) return null;

  return (
    <Sheet
      title="Meal ideas"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      {!aiReady(settings) ? (
        <>
          <p className="muted">Meal ideas use Claude. Connect it once in settings — it takes a minute.</p>
          <Link to="/more/ai" className="btn btn-primary btn-block">
            Connect Claude
          </Link>
        </>
      ) : !ideas ? (
        <>
          <Segmented<Kind>
            label="What for"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'meal', label: 'A meal' },
              { value: 'rest-of-day', label: 'Rest of today' },
              { value: 'prep', label: 'Meal prep' },
            ]}
          />
          {kind !== 'rest-of-day' ? (
            <Segmented<MealSlot> label="Meal" value={slot} onChange={setSlot} options={MEALS.map((m) => ({ value: m.value, label: m.label }))} />
          ) : (
            <p className="faint" style={{ fontSize: 14 }}>
              Based on what’s logged for {formatDateShort(date)}: about {formatInt(Math.max(0, profile.calorieTarget - sumIntake(todayLogs ?? []).kcal))} kcal and{' '}
              {formatInt(Math.max(0, profile.proteinTarget - sumIntake(todayLogs ?? []).proteinG))} g protein left.
            </p>
          )}
          <div className="field">
            <label htmlFor="meal-prefs">Preferences (optional)</label>
            <div className="input-wrap">
              <input id="meal-prefs" value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="e.g. vegetarian, 20 minutes, no mushrooms" enterKeyHint="go" />
            </div>
          </div>
          {error && <p className="chat-error">{error}</p>}
          <button className="btn btn-primary btn-lg btn-block" onClick={() => void generate()} disabled={busy || !navigator.onLine}>
            {busy ? (
              <>
                <span className="typing">
                  <span className="dot" />
                </span>
                Creating ideas…
              </>
            ) : (
              <>
                <Icon name="sparkles" /> Suggest meals
              </>
            )}
          </button>
          {!navigator.onLine && <p className="faint">You’re offline — meal ideas need a connection.</p>}
        </>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 13 }}>
            <span className="pill kind-suggestion">Suggestion</span> Nothing is saved until you tap. Nutrition is a <span className="pill kind-calculation">Calculation</span> from your food
            database where the ingredient matches, otherwise an AI estimate — check labels for packaged food.
          </p>
          {ideas.map((i) => (
            <section key={i.key} className="card idea-card">
              <div className="idea-head">
                <b>{i.name}</b>
                <span className="faint">{i.servings > 1 ? `${i.servings} portions` : MEALS.find((m) => m.value === i.slot)?.label}</span>
              </div>
              <div className="idea-macros">
                <b>{formatInt(i.perServing.kcal)}</b> kcal · <b>{formatInt(i.perServing.proteinG)}</b> g protein · {formatInt(i.perServing.carbsG)} C · {formatInt(i.perServing.fatG)} F
                {i.servings > 1 && <span className="faint"> per portion</span>}
              </div>
              {i.why && <p className="muted" style={{ fontSize: 14 }}>{i.why}</p>}
              <details>
                <summary>
                  Ingredients & method <span className="faint">· {i.matched}/{i.items.length} from your foods</span>
                </summary>
                <ul className="idea-list">
                  {i.items.map((it) => (
                    <li key={it.key}>
                      {it.name} — {it.grams} g{it.foodId === null && <span className="faint"> (est.)</span>}
                    </li>
                  ))}
                </ul>
                {i.method && <p style={{ fontSize: 14 }}>{i.method}</p>}
              </details>
              <div className="btn-row">
                <button className="btn" onClick={() => void saveMeal(i).then(() => toast('Saved to your meals'))} disabled={!!saved[i.key]}>
                  <Icon name={saved[i.key] ? 'check' : 'star'} /> {saved[i.key] ? 'Saved' : 'Save meal'}
                </button>
                <button className="btn btn-primary" onClick={() => void plan(i)} disabled={planned.has(i.key)}>
                  <Icon name={planned.has(i.key) ? 'check' : 'calendar'} /> {planned.has(i.key) ? 'Planned' : date === todayISO() ? 'Plan today' : 'Add to plan'}
                </button>
              </div>
            </section>
          ))}
          <button className="btn btn-ghost btn-block" onClick={() => setIdeas(null)}>
            <Icon name="refresh" /> Different ideas
          </button>
        </>
      )}
    </Sheet>
  );
}
