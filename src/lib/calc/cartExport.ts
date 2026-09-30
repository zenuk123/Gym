import type { Food, ISODate, PriceEntry, ShoppingItem } from '../../db/types';
import { itemKey, lineCost } from './prices';

// Shopping list → a file the "add to cart" script (tools/shop_to_cart) reads on a computer.
// It carries a supermarket search term, what you need, and how many packs to add when the
// pack size is known from your price book. Ticked items are left out.

export const CART_FORMAT = 'fitness-os-shopping-list';

export interface CartLine {
  name: string;
  /** What to type in the supermarket's search box. */
  search: string;
  /** Human description of the amount needed. */
  need: string;
  amountG: number | null;
  /** Packs/items to add (from your price book's pack size; otherwise 1). */
  quantity: number;
  category: string;
  /** Your saved price at the chosen shop, if any. */
  price: number | null;
}

export interface CartFile {
  format: typeof CART_FORMAT;
  version: 1;
  exportedAt: string;
  weekStart: ISODate;
  shop: string | null;
  items: CartLine[];
}

/** Words in brackets that describe state, not the product you'd search for. */
const DROP = /^(raw|cooked|dry|drained|canned|frozen|large|liquid|sliced)$/i;

/** "Turkey mince, 5% fat (raw)" → "turkey mince 5% fat"; "Dark chocolate (70%)" → "dark chocolate 70%". */
export function searchTerm(name: string): string {
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((w) => w.trim())).filter((w) => w && !DROP.test(w));
  const base = name.replace(/\s*\([^)]*\)/g, '').replace(/,/g, ' ');
  return [base, ...inner].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildCartFile(list: ShoppingItem[], opts: { weekStart: ISODate; shop: string | null; prices: PriceEntry[]; foods: Map<string, Food>; now?: Date }): CartFile {
  const byKey = new Map<string, PriceEntry>();
  for (const p of opts.prices) if (p.deletedAt === null && p.shop === opts.shop) {
    const prev = byKey.get(p.itemKey);
    if (!prev || p.updatedAt > prev.updatedAt) byKey.set(p.itemKey, p);
  }
  return {
    format: CART_FORMAT,
    version: 1,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    weekStart: opts.weekStart,
    shop: opts.shop,
    items: list
      .filter((i) => !i.checked && i.deletedAt === null)
      .map((i) => {
        const price = byKey.get(itemKey(i));
        const cost = price ? lineCost(price, i.amountG) : null;
        return {
          name: i.name,
          search: searchTerm(i.foodId ? opts.foods.get(i.foodId)?.name ?? i.name : i.name),
          need: i.quantity ?? '1',
          amountG: i.amountG,
          quantity: cost?.packs ?? 1,
          category: i.category,
          price: cost ? cost.cost : null,
        };
      }),
  };
}
