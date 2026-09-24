import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/CardHead';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useFoods, usePlanItems, usePrices, useShopping } from '../../db/hooks';
import { create, remove, update } from '../../db/repo';
import { FOOD_CATEGORIES, type FoodCategory, type Profile, type ShoppingItem } from '../../db/types';
import { CATEGORY_LABEL, searchFoods } from '../../lib/calc/food';
import { buildShoppingList, mergeShopping, shoppingText } from '../../lib/calc/plan';
import { bestMix, formatMoney, itemKey, lineCost, priceIndex, shopTotals } from '../../lib/calc/prices';
import { addDays, formatDateShort, startOfWeek } from '../../lib/dates';
import { useToday } from '../../lib/useToday';
import { haptic } from '../../pwa/platform';
import { NutritionTabs } from './NutritionTabs';
import { PriceSheet } from './PriceSheet';
import './nutrition.css';

/** Shopping list for a plan week, grouped by aisle. Plan items are generated; your own additions are kept. */
export function ShoppingPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const currency = profile.currency ?? 'GBP';
  const prices = usePrices();
  const [pricing, setPricing] = useState<ShoppingItem | null>(null);
  const [view, setView] = useState<string | null>(null);
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

  const idx = useMemo(() => priceIndex(prices ?? []), [prices]);
  const toBuy = useMemo(() => (list ?? []).filter((i) => !i.checked), [list]);
  const totals = useMemo(() => shopTotals(toBuy, idx), [toBuy, idx]);
  const mix = useMemo(() => bestMix(toBuy, idx), [toBuy, idx]);
  const shopsUsed = useMemo(() => [...new Set((prices ?? []).map((p) => p.shop))], [prices]);

  if (!plan || !list || !foods || !prices) return <main className="page" />;
  const remaining = toBuy.length;
  // Which prices to show: the chosen shop, else the shop covering most of the list; 'best' = cheapest per item.
  const shownShop = view ?? totals[0]?.shop ?? null;
  const rowPrice = (i: ShoppingItem) => {
    const byShop = idx.get(itemKey(i));
    const shop = shownShop === 'best' ? mix.shopFor.get(i.id) : shownShop;
    const entry = shop ? byShop?.get(shop) : undefined;
    return entry ? { shop: shop!, cost: lineCost(entry, i.amountG).cost } : null;
  };
  const shownTotal = shownShop === 'best' ? { total: mix.total, priced: mix.priced } : totals.find((t) => t.shop === shownShop);

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
          {remaining > 0 && (
            <section className="card price-card">
              {totals.length === 0 ? (
                <p className="muted" style={{ fontSize: 14 }}>
                  <b style={{ color: 'var(--text)' }}>What will it cost?</b> Tap <b>+ price</b> on an item and enter what it costs at your shop. Prices are remembered, so
                  next week’s list adds itself up and compares shops.
                </p>
              ) : (
                <>
                  <div className="chip-scroll" role="group" aria-label="Prices from">
                    {totals.map((t) => (
                      <button key={t.shop} className="chip" aria-pressed={shownShop === t.shop} onClick={() => setView(t.shop)}>
                        {t.shop}
                      </button>
                    ))}
                    {totals.length > 1 && (
                      <button className="chip" aria-pressed={shownShop === 'best'} onClick={() => setView('best')}>
                        Cheapest mix
                      </button>
                    )}
                  </div>
                  <div className="price-total">
                    <span className="big-num">{formatMoney(shownTotal?.total ?? 0, currency)}</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {shownShop === 'best' ? 'each item at its cheapest shop' : `at ${shownShop}`} · {shownTotal?.priced ?? 0} of {remaining} items priced
                    </span>
                  </div>
                  {totals.length > 1 && (
                    <div className="price-compare">
                      {totals.map((t) => (
                        <div key={t.shop} className="price-compare-row">
                          <span>{t.shop}</span>
                          <span className="faint">
                            {t.priced}/{t.lines} priced
                          </span>
                          <b>{formatMoney(t.total, currency)}</b>
                        </div>
                      ))}
                      <div className="price-compare-row best">
                        <span>Cheapest mix</span>
                        <span className="faint">
                          {mix.priced}/{remaining} priced
                        </span>
                        <b>{formatMoney(mix.total, currency)}</b>
                      </div>
                    </div>
                  )}
                  <p className="faint" style={{ fontSize: 12 }}>
                    <span className="pill kind-calculation">Calculation</span> From prices you’ve saved (whole packs), not live shop prices — totals only include priced items.{' '}
                    <Link to="/nutrition/prices">Price book</Link>
                  </p>
                </>
              )}
            </section>
          )}
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
                    {(() => {
                      const rp = rowPrice(i);
                      return (
                        <button className={`price-btn${rp ? '' : ' empty'}`} onClick={() => setPricing(i)} aria-label={rp ? `Price of ${i.name}: ${formatMoney(rp.cost, currency)} at ${rp.shop}` : `Add price for ${i.name}`}>
                          {rp ? (
                            <>
                              <b>{formatMoney(rp.cost, currency)}</b>
                              {shownShop === 'best' && <span>{rp.shop}</span>}
                            </>
                          ) : (
                            '+ price'
                          )}
                        </button>
                      );
                    })()}
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
      {pricing && (
        <PriceSheet
          item={pricing}
          food={pricing.foodId ? foodMap.get(pricing.foodId) : undefined}
          prices={idx.get(itemKey(pricing)) ? [...idx.get(itemKey(pricing))!.values()] : []}
          shops={shopsUsed}
          initialShop={shownShop && shownShop !== 'best' ? shownShop : null}
          currency={currency}
          onClose={(shop) => {
            setPricing(null);
            if (shop && !view) setView(shop);
          }}
        />
      )}
    </main>
  );
}
