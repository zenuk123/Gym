import { useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useFoods, useRecentFoodLogs, useSavedMeals } from '../../db/hooks';
import { create, remove } from '../../db/repo';
import type { Food, ISODate, MealSlot, SavedMeal } from '../../db/types';
import { describeAmount, foodUsage, mealPerServing, nutritionFor, recentFoods, scaleNutrients, searchFoods, type Nutrients } from '../../lib/calc/food';
import { formatInt } from '../../lib/format';
import { searchOpenFoodFacts, type OffFood } from '../../lib/openFoodFacts';
import { parseDecimal, round } from '../../lib/units';
import { useOnline } from '../../pwa/platform';
import { MEALS, QuickAddSheet, mealForNow } from './QuickAddSheet';
import { BarcodeScanner } from './BarcodeScanner';
import './nutrition.css';

type Picked = { kind: 'food'; food: Food; grams: number } | { kind: 'meal'; meal: SavedMeal; servings: number };

/**
 * Add food: search your foods + the built-in database (works offline), recent foods,
 * favourites and saved meals; online search / barcode via Open Food Facts.
 * `mode="pick"` returns the choice instead of logging it (meal editor, planner).
 */
export function AddFoodSheet({
  date,
  initialSlot,
  mode = 'log',
  allowMeals = true,
  title,
  onPick,
  onClose,
}: {
  date?: ISODate;
  initialSlot?: MealSlot;
  mode?: 'log' | 'pick';
  allowMeals?: boolean;
  title?: string;
  onPick?: (p: Picked, slot: MealSlot) => void | Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const online = useOnline();
  const foods = useFoods();
  const meals = useSavedMeals();
  const logs = useRecentFoodLogs();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'recent' | 'favourites' | 'meals'>('recent');
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? mealForNow());
  const [picked, setPicked] = useState<Picked | null>(null);
  const [quick, setQuick] = useState(false);
  const [scan, setScan] = useState(false);
  const [offResults, setOffResults] = useState<OffFood[] | null>(null);
  const [offBusy, setOffBusy] = useState(false);
  const [offError, setOffError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const foodMap = useMemo(() => new Map((foods ?? []).map((f) => [f.id, f])), [foods]);
  const usage = useMemo(() => foodUsage(logs ?? []), [logs]);
  const results = useMemo(() => (q.trim() ? searchFoods(foods ?? [], q, usage).slice(0, 40) : []), [foods, q, usage]);
  const recent = useMemo(() => recentFoods(logs ?? [], foodMap), [logs, foodMap]);
  const favourites = (foods ?? []).filter((f) => f.favourite && !f.archived);
  const mealHits = (meals ?? []).filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));

  async function searchOnline() {
    abort.current?.abort();
    abort.current = new AbortController();
    setOffBusy(true);
    setOffError(null);
    try {
      setOffResults(await searchOpenFoodFacts(q.trim(), abort.current.signal));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setOffError('Couldn’t reach the online food database. Try again when you have signal.');
    } finally {
      setOffBusy(false);
    }
  }

  /** Online foods are saved to your foods so they work offline next time. */
  async function adoptOff(f: OffFood | Food): Promise<Food> {
    if ('id' in f) return f;
    const existing = (foods ?? []).find((x) => (f.barcode && x.barcode === f.barcode) || (x.name === f.name && x.brand === f.brand));
    return existing ?? create('foods', f);
  }

  async function confirm(p: Picked) {
    if (mode === 'pick') {
      await onPick?.(p, slot);
      return;
    }
    const n: Nutrients = p.kind === 'food' ? nutritionFor(p.food, p.grams) : scaleNutrients(mealPerServing(p.meal), p.servings);
    const rec = await create('foodLogs', {
      date: date!,
      meal: slot,
      name: p.kind === 'food' ? (p.food.brand ? `${p.food.name} (${p.food.brand})` : p.food.name) : p.meal.name,
      kcal: n.kcal,
      proteinG: n.proteinG,
      carbsG: n.carbsG,
      fatG: n.fatG,
      fibreG: n.fibreG,
      foodId: p.kind === 'food' ? p.food.id : null,
      amountG: p.kind === 'food' ? p.grams : null,
      savedMealId: p.kind === 'meal' ? p.meal.id : null,
      servings: p.kind === 'meal' ? p.servings : null,
    });
    toast(`Added ${n.kcal} kcal to ${MEALS.find((m) => m.value === slot)!.label.toLowerCase()}`, { label: 'Undo', run: () => void remove('foodLogs', rec.id) });
    setPicked(null);
  }

  if (quick && date) return <QuickAddSheet date={date} initialSlot={slot} onClose={() => setQuick(false)} />;
  if (scan) {
    return (
      <BarcodeScanner
        onClose={() => setScan(false)}
        onFound={async (f) => {
          const food = await adoptOff(f);
          setScan(false);
          setPicked({ kind: 'food', food, grams: food.servingG ?? 100 });
        }}
      />
    );
  }

  if (picked) {
    return (
      <AmountStep
        picked={picked}
        slot={slot}
        setSlot={setSlot}
        showSlot={mode === 'log' || !!initialSlot}
        actionLabel={mode === 'pick' ? 'Add' : `Add to ${MEALS.find((m) => m.value === slot)!.label.toLowerCase()}`}
        onBack={() => setPicked(null)}
        onChange={setPicked}
        onConfirm={() => void confirm(picked)}
      />
    );
  }

  const foodRow = (food: Food, grams: number, key?: string) => {
    const n = nutritionFor(food, grams);
    return (
      <button key={key ?? food.id} className="list-row food-row" onClick={() => setPicked({ kind: 'food', food, grams })}>
        <div className="grow">
          <div className="title">
            {food.name}
            {food.favourite && <span className="star">★</span>}
          </div>
          <div className="desc">
            {food.brand ? `${food.brand} · ` : ''}
            {describeAmount(food, grams)} · {n.kcal} kcal · {round(n.proteinG, 0)} g protein
          </div>
        </div>
        <span className="trail">
          <Icon name="plus" />
        </span>
      </button>
    );
  };

  return (
    <Sheet title={title ?? (mode === 'pick' ? 'Choose food' : 'Add food')} onClose={onClose}>
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input
          type="search"
          placeholder="Search foods"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffResults(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && online && q.trim() && results.length === 0 && void searchOnline()}
          autoCorrect="off"
          enterKeyHint="search"
          style={{ paddingLeft: 8 }}
        />
      </div>
      <div className="add-actions">
        <button className="chip" onClick={() => setScan(true)}>
          <Icon name="scan" width={16} height={16} /> Scan barcode
        </button>
        {mode === 'log' && (
          <button className="chip" onClick={() => setQuick(true)}>
            <Icon name="plus" width={16} height={16} /> Quick calories
          </button>
        )}
      </div>

      {q.trim() ? (
        <>
          {allowMeals && mealHits.length > 0 && (
            <div className="list">
              {mealHits.slice(0, 3).map((m) => (
                <MealRow key={m.id} meal={m} onPick={() => setPicked({ kind: 'meal', meal: m, servings: 1 })} />
              ))}
            </div>
          )}
          <div className="list picker-list">
            {results.map((f) => foodRow(f, f.servingG ?? 100))}
            {results.length === 0 && <p className="empty">No match in your foods.</p>}
          </div>
          {offResults === null ? (
            <button className="btn btn-block" disabled={!online || offBusy} onClick={() => void searchOnline()}>
              <Icon name="search" />
              {!online ? 'Online search needs signal' : offBusy ? 'Searching…' : `Search online for “${q.trim()}”`}
            </button>
          ) : (
            <>
              <h3 className="section-title">Online (Open Food Facts)</h3>
              <div className="list picker-list">
                {offResults.map((f, i) => (
                  <button
                    key={`${f.barcode}-${i}`}
                    className="list-row food-row"
                    onClick={async () => {
                      const food = await adoptOff(f);
                      setPicked({ kind: 'food', food, grams: food.servingG ?? 100 });
                    }}
                  >
                    <div className="grow">
                      <div className="title">{f.name}</div>
                      <div className="desc">
                        {f.brand ? `${f.brand} · ` : ''}
                        {f.kcal} kcal · {round(f.proteinG, 1)} g protein per 100 g
                      </div>
                    </div>
                    <span className="trail">
                      <Icon name="plus" />
                    </span>
                  </button>
                ))}
                {offResults.length === 0 && <p className="empty">Nothing found online.</p>}
              </div>
            </>
          )}
          {offError && <p className="error-text">{offError}</p>}
        </>
      ) : (
        <>
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'favourites', label: 'Favourites' },
              ...(allowMeals ? [{ value: 'meals' as const, label: 'My meals' }] : []),
            ]}
          />
          <div className="list picker-list">
            {tab === 'recent' && recent.map((r) => foodRow(r.food, r.grams))}
            {tab === 'recent' && recent.length === 0 && <p className="empty">Foods you log appear here. Search above to start — there are {foods?.length ?? 0} foods built in.</p>}
            {tab === 'favourites' && favourites.map((f) => foodRow(f, f.servingG ?? 100))}
            {tab === 'favourites' && favourites.length === 0 && <p className="empty">Star foods in Foods to keep them here.</p>}
            {tab === 'meals' && (meals ?? []).map((m) => <MealRow key={m.id} meal={m} onPick={() => setPicked({ kind: 'meal', meal: m, servings: 1 })} />)}
            {tab === 'meals' && (meals ?? []).length === 0 && <p className="empty">Save a meal from your log, or build one in Meals.</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}

function MealRow({ meal, onPick }: { meal: SavedMeal; onPick: () => void }) {
  const n = mealPerServing(meal);
  return (
    <button className="list-row food-row" onClick={onPick} style={{ '--tone': 'var(--kcal)' } as React.CSSProperties}>
      <span className="lead">
        <Icon name="utensils" />
      </span>
      <div className="grow">
        <div className="title">{meal.name}</div>
        <div className="desc">
          Per serving · {n.kcal} kcal · {round(n.proteinG, 0)} g protein · {meal.items.length} items
        </div>
      </div>
      <span className="trail">
        <Icon name="plus" />
      </span>
    </button>
  );
}

function AmountStep({
  picked,
  slot,
  setSlot,
  showSlot,
  actionLabel,
  onBack,
  onChange,
  onConfirm,
}: {
  picked: Picked;
  slot: MealSlot;
  setSlot: (s: MealSlot) => void;
  showSlot: boolean;
  actionLabel: string;
  onBack: () => void;
  onChange: (p: Picked) => void;
  onConfirm: () => void;
}) {
  const isFood = picked.kind === 'food';
  const food = isFood ? picked.food : null;
  const hasServing = !!food?.servingG;
  const [unitMode, setUnitMode] = useState<'serving' | 'g'>(hasServing ? 'serving' : 'g');
  const current = isFood ? (unitMode === 'serving' && hasServing ? picked.grams / food!.servingG! : picked.grams) : picked.servings;
  const [text, setText] = useState(String(round(current, 2)));
  const n: Nutrients = isFood ? nutritionFor(picked.food, picked.grams) : scaleNutrients(mealPerServing(picked.meal), picked.servings);

  const setAmount = (v: number, mode = unitMode) => {
    setText(String(round(v, 2)));
    if (isFood) onChange({ ...picked, grams: Math.max(0, round(mode === 'serving' && hasServing ? v * food!.servingG! : v, 1)) });
    else onChange({ ...picked, servings: Math.max(0, v) });
  };
  const unitLabel = isFood ? (unitMode === 'serving' && hasServing ? `× ${food!.servingName ?? 'serving'} (${food!.servingG} ${food!.unit})` : food!.unit) : 'servings';
  const presets = isFood ? (unitMode === 'serving' && hasServing ? [0.5, 1, 1.5, 2, 3] : [50, 100, 150, 200, 250]) : [0.5, 1, 1.5, 2];
  const valid = (isFood ? picked.grams : picked.servings) > 0;

  return (
    <Sheet title={isFood ? picked.food.name : picked.meal.name} onClose={onBack}>
      <button className="link-btn" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <Icon name="chevronLeft" width={16} height={16} /> Back to search
      </button>
      {isFood && (
        <p className="muted" style={{ fontSize: 14, marginTop: -6 }}>
          {food!.brand ? `${food!.brand} · ` : ''}per 100 {food!.unit}: {food!.kcal} kcal · P {food!.proteinG} · C {food!.carbsG} · F {food!.fatG}
        </p>
      )}
      {isFood && hasServing && (
        <Segmented
          label="Amount unit"
          value={unitMode}
          onChange={(m) => {
            setUnitMode(m);
            setText(String(round(m === 'serving' ? picked.grams / food!.servingG! : picked.grams, 2)));
          }}
          options={[
            { value: 'serving', label: food!.servingName ?? 'Serving' },
            { value: 'g', label: food!.unit === 'ml' ? 'Millilitres' : 'Grams' },
          ]}
        />
      )}
      <div className="field">
        <label htmlFor="amount">Amount</label>
        <div className="input-wrap big">
          <input
            id="amount"
            inputMode="decimal"
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.,]/g, '');
              setText(v);
              const num = parseDecimal(v);
              if (num !== null) setAmount(num);
              setText(v);
            }}
          />
          <span className="suffix">{unitLabel}</span>
        </div>
      </div>
      <div className="quick-row">
        {presets.map((p) => (
          <button key={p} className="btn" onClick={() => setAmount(p)}>
            {p}
            {isFood && unitMode === 'g' ? '' : '×'}
          </button>
        ))}
      </div>
      <div className="macro-preview">
        <div>
          <b>{formatInt(n.kcal)}</b>
          <span>kcal</span>
        </div>
        <div>
          <b>{round(n.proteinG, 1)}</b>
          <span>protein</span>
        </div>
        <div>
          <b>{round(n.carbsG, 1)}</b>
          <span>carbs</span>
        </div>
        <div>
          <b>{round(n.fatG, 1)}</b>
          <span>fat</span>
        </div>
      </div>
      {showSlot && <Segmented label="Meal" value={slot} onChange={setSlot} options={MEALS} />}
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={onConfirm}>
        {actionLabel}
      </button>
    </Sheet>
  );
}
