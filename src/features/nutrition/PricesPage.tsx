import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/CardHead';
import { SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useFoods, usePrices } from '../../db/hooks';
import { updateProfile } from '../../db/repo';
import type { PriceEntry, Profile, ShoppingItem } from '../../db/types';
import { formatMoney, itemKey } from '../../lib/calc/prices';
import { relativeDay } from '../../lib/dates';
import { useToday } from '../../lib/useToday';
import { PriceSheet } from './PriceSheet';
import './nutrition.css';

const CURRENCIES = ['GBP', 'EUR', 'USD', 'AUD', 'CAD'] as const;

/** Every price you've saved, by item — edit, remove, or change currency. */
export function PricesPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const prices = usePrices();
  const foods = useFoods();
  const currency = profile.currency ?? 'GBP';
  const [editing, setEditing] = useState<{ item: ShoppingItem; shop: string } | null>(null);

  const groups = useMemo(() => {
    const g = new Map<string, PriceEntry[]>();
    for (const p of prices ?? []) g.set(p.itemKey, [...(g.get(p.itemKey) ?? []), p]);
    return [...g.values()].map((xs) => xs.sort((a, b) => a.price - b.price)).sort((a, b) => a[0].name.localeCompare(b[0].name));
  }, [prices]);
  const shops = useMemo(() => [...new Set((prices ?? []).map((p) => p.shop))], [prices]);
  if (!prices || !foods) return <main className="page" />;

  // A stand-in list line so the price sheet can edit an item that isn't on this week's list.
  const asItem = (p: PriceEntry): ShoppingItem => ({
    id: `price-${p.itemKey}`,
    weekStart: '',
    name: p.name,
    category: 'other',
    quantity: null,
    amountG: null,
    foodId: p.itemKey.startsWith('food:') ? p.itemKey.slice(5) : null,
    checked: false,
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  });

  return (
    <main className="page">
      <SubHeader title="Price book" back="/nutrition/shopping" />
      <div className="field">
        <span className="label">Currency</span>
        <Segmented label="Currency" value={currency} onChange={(c) => void updateProfile({ currency: c })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      {groups.length === 0 ? (
        <section className="card">
          <EmptyState icon="cart">
            <b className="empty-title">No prices yet</b>
            On the shopping list, tap “+ price” next to an item and enter what it costs at your shop.
          </EmptyState>
        </section>
      ) : (
        groups.map((xs) => (
          <section key={xs[0].itemKey} className="card price-item">
            <b>{xs[0].name}</b>
            {xs.map((p, i) => (
              <button key={p.id} className="price-compare-row price-line" onClick={() => setEditing({ item: asItem(p), shop: p.shop })}>
                <span>
                  {p.shop}
                  {i === 0 && xs.length > 1 && <span className="pill good" style={{ marginLeft: 6 }}>Cheapest</span>}
                </span>
                <span className="faint">
                  {p.packG ? `${p.packG} ${foods.find((f) => `food:${f.id}` === p.itemKey)?.unit ?? 'g'} · ` : ''}
                  {relativeDay(p.updatedOn, today)}
                </span>
                <b>{formatMoney(p.price, currency)}</b>
              </button>
            ))}
          </section>
        ))
      )}
      <p className="faint" style={{ fontSize: 13, padding: '0 4px' }}>
        Prices are yours to keep up to date — shops change them often. They sync with your account and are included in backups.
      </p>
      {editing && (
        <PriceSheet
          item={editing.item}
          food={editing.item.foodId ? foods.find((f) => f.id === editing.item.foodId) : undefined}
          prices={prices.filter((p) => p.itemKey === itemKey(editing.item))}
          shops={shops}
          initialShop={editing.shop}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
