import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { NumberField } from '../../components/NumberField';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { create, remove, update } from '../../db/repo';
import type { Food, PriceEntry, ShoppingItem } from '../../db/types';
import { formatMoney, itemKey, lineCost, UK_SHOPS } from '../../lib/calc/prices';
import { todayISO } from '../../lib/dates';
import { parseDecimal, round } from '../../lib/units';

export const currencySymbol = (currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;

/** Set what one shopping-list item costs at a shop. Remembered for next week's list too. */
export function PriceSheet({
  item,
  food,
  prices,
  shops,
  initialShop,
  currency,
  onClose,
}: {
  item: ShoppingItem;
  food?: Food;
  /** Saved prices for this item (all shops). */
  prices: PriceEntry[];
  /** Shops already used in the price book. */
  shops: string[];
  initialShop: string | null;
  currency: string;
  onClose: (shop?: string) => void;
}) {
  const toast = useToast();
  const [shop, setShop] = useState(initialShop ?? shops[0] ?? 'Tesco');
  const [custom, setCustom] = useState('');
  const existing = prices.find((p) => p.shop === shop);
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  // Pack size: the saved one, else the food's usual pack/serving (as a starting point).
  const [pack, setPack] = useState(existing ? (existing.packG ? String(existing.packG) : '') : food?.servingG && food.servingG >= 100 ? String(food.servingG) : '');
  const unit = food?.unit ?? 'g';

  const pickShop = (s: string) => {
    setShop(s);
    const e = prices.find((p) => p.shop === s);
    setPrice(e ? String(e.price) : '');
    if (e) setPack(e.packG ? String(e.packG) : '');
  };

  const p = parseDecimal(price);
  const packG = pack.trim() ? parseDecimal(pack) : null;
  const valid = p !== null && p > 0 && p < 10_000 && (packG === null || packG > 0) && shop.trim().length > 0;
  const preview = valid ? lineCost({ price: p!, packG }, item.amountG) : null;
  const allShops = [...new Set([...shops, ...UK_SHOPS])];

  async function save() {
    if (!valid) return;
    const data = { itemKey: itemKey(item), name: item.name, shop: shop.trim(), price: round(p!, 2), packG: packG ? round(packG, 0) : null, updatedOn: todayISO() };
    if (existing) await update('prices', existing.id, data);
    else await create('prices', data);
    toast(`${item.name}: ${formatMoney(data.price, currency)} at ${data.shop}`);
    onClose(data.shop);
  }

  return (
    <Sheet title={`Price · ${item.name}`} onClose={() => onClose()}>
      <div className="field">
        <span className="label">Shop</span>
        <div className="chip-scroll" role="group" aria-label="Shop">
          {allShops.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={s === shop} onClick={() => pickShop(s)}>
              {s}
              {prices.some((x) => x.shop === s) && <span className="faint"> · {formatMoney(prices.find((x) => x.shop === s)!.price, currency)}</span>}
            </button>
          ))}
        </div>
        <form
          className="barcode-manual"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) {
              pickShop(custom.trim().slice(0, 30));
              setCustom('');
            }
          }}
        >
          <div className="input-wrap">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other shop or market" aria-label="Other shop" enterKeyHint="done" />
          </div>
          <button className="btn" disabled={!custom.trim()}>
            Use
          </button>
        </form>
      </div>
      <div className="field-row">
        <NumberField label={`Price at ${shop}`} suffix={currencySymbol(currency)} value={price} onChange={setPrice} autoFocus={!existing} />
        <NumberField label="Pack size (optional)" suffix={unit} decimal={false} value={pack} onChange={setPack} placeholder="per item" />
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        {preview
          ? item.amountG && preview.packs !== null
            ? `This list needs ${round(item.amountG, 0)} ${unit} → ${preview.packs} ${preview.packs === 1 ? 'pack' : 'packs'} = ${formatMoney(preview.cost, currency)}`
            : `${formatMoney(preview.cost, currency)} for this item`
          : 'Enter the shelf price. Add the pack size and the list works out how many packs you need.'}
      </p>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Save price
      </button>
      {existing && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await remove('prices', existing.id);
            toast(`Removed ${shop} price`);
            onClose();
          }}
        >
          <Icon name="trash" /> Remove {shop} price
        </button>
      )}
    </Sheet>
  );
}
