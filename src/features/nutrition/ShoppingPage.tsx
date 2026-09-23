import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useFoods, usePlanItems, useShopping } from '../../db/hooks';
import { create, remove, update } from '../../db/repo';
import { FOOD_CATEGORIES, type FoodCategory, type ShoppingItem } from '../../db/types';
import { CATEGORY_LABEL, searchFoods } from '../../lib/calc/food';
import { buildShoppingList, mergeShopping, shoppingText } from '../../lib/calc/plan';
import { addDays, formatDateShort, startOfWeek } from '../../lib/dates';
import { useToday } from '../../lib/useToday';
import { haptic } from '../../pwa/platform';
import { NutritionTabs } from './NutritionTabs';
import './nutrition.css';

/** Shopping list for a plan week, grouped by aisle. Plan items are generated; your own additions are kept. */
export function ShoppingPage() {
  const today = useToday();
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const plan = usePlanItems(weekStart, addDays(weekStart, 6));
  const list = useShopping(weekStart);
  const foods = useFoods();
  const [newItem, setNewItem] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const foodMap = useMemo(() => new Map((foods ?? []).map((f) => [f.id, f])), [foods]);

  const groups = useMemo(() => {
    const g = new Map<FoodCategory, ShoppingItem[]>();
    for (const c of FOOD_CATEGORIES) g.set(c, []);
    for (const i of list ?? []) g.get(i.category)!.push(i);
    for (const xs of g.values()) xs.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name));
    return [...g.entries()].filter(([, xs]) => xs.length > 0);
  }, [list]);

  if (!plan || !list || !foods) return <main className="page" />;
  const remaining = list.filter((i) => !i.checked).length;

  async function rebuild() {
    const lines = buildShoppingList(plan!, foodMap);
    const { upserts, removals } = mergeShopping(list!, lines);
    for (const id of removals) await remove('shopping', id);
    for (const u of upserts) {
      const { id, ...data } = u;
      if (id) await update('shopping', id, data);
      else await create('shopping', { ...data, weekStart, source: 'plan' });
    }
    toast(lines.length ? `${lines.length} items from your plan` : 'Nothing planned this week yet');
  }

  async function addManual() {
    const name = newItem.trim();
    if (!name) return;
    const match = searchFoods(foods!, name)[0];
    await create('shopping', { weekStart, name, category: match?.category ?? 'other', quantity: null, amountG: null, foodId: null, checked: false, source: 'manual' });
    setNewItem('');
  }

  async function share() {
    const text = shoppingText(list!, CATEGORY_LABEL);
    if (!text) return toast('Everything is ticked off');
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'Shopping list', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <button className="btn btn-primary" onClick={() => void rebuild()}>
            <Icon name="refresh" />
            From plan
          </button>
        }
      />
      <NutritionTabs />

      <div className="day-switch">
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
          <Icon name="chevronLeft" />
        </button>
        <span>{weekStart === startOfWeek(today) ? 'This week' : `Week of ${formatDateShort(weekStart)}`}</span>
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
          <Icon name="chevronRight" />
        </button>
      </div>

      <form
        className="barcode-manual"
        onSubmit={(e) => {
          e.preventDefault();
          void addManual();
        }}
      >
        <div className="input-wrap">
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item (e.g. washing-up liquid)" aria-label="Add shopping item" enterKeyHint="done" />
        </div>
        <button className="btn" disabled={!newItem.trim()}>
          Add
        </button>
      </form>

      {list.length === 0 ? (
        <section className="card">
          <EmptyState icon="cart">
            <b className="empty-title">No list yet</b>
            {plan.length > 0 ? 'Tap “From plan” to add up every ingredient in this week’s meals.' : 'Plan your week first — the list builds itself from your meals.'}
          </EmptyState>
          {plan.length === 0 && (
            <Link to="/nutrition/plan" className="btn btn-block">
              Go to meal plan
            </Link>
          )}
        </section>
      ) : (
        <>
          <p className="faint" style={{ fontSize: 13, padding: '0 4px' }}>
            {remaining} of {list.length} left to buy
          </p>
          {groups.map(([cat, xs]) => (
            <section key={cat}>
              <h2 className="section-title" style={{ marginBottom: 8 }}>
                {CATEGORY_LABEL[cat]}
              </h2>
              <div className="list">
                {xs.map((i) => (
                  <div key={i.id} className={`list-row shop-row${i.checked ? ' done' : ''}`}>
                    <button
                      className={`shop-check${i.checked ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={i.checked}
                      aria-label={i.name}
                      onClick={() => {
                        haptic(8);
                        void update('shopping', i.id, { checked: !i.checked });
                      }}
                    >
                      <Icon name="check" />
                    </button>
                    <div className="grow">
                      <div className="title">{i.name}</div>
                      {i.quantity && <div className="desc">{i.quantity}</div>}
                    </div>
                    {i.source === 'manual' && (
                      <button className="icon-btn" onClick={() => void remove('shopping', i.id)} aria-label={`Remove ${i.name}`}>
                        <Icon name="x" color="var(--text-3)" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => void share()}>
              <Icon name="share" /> Share list
            </button>
            {confirmClear ? (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  for (const i of list.filter((x) => x.checked)) await remove('shopping', i.id);
                  setConfirmClear(false);
                }}
              >
                Remove ticked
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmClear(true)} disabled={remaining === list.length}>
                Clear ticked
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
