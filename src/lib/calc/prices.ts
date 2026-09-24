import type { PriceEntry, ShoppingItem } from '../../db/types';

// Price book maths: which saved price applies to a shopping-list line, what that line costs
// (whole packs), and totals per shop. Prices are the user's own — the app never guesses them.

export const UK_SHOPS = ['Tesco', 'Sainsbury’s', 'Asda', 'Aldi', 'Lidl', 'Morrisons', 'Co-op', 'Waitrose', 'M&S', 'Iceland', 'Ocado'];

/** Stable key linking a list line to its prices: the food when known, otherwise the normalised name. */
export function itemKey(item: Pick<ShoppingItem, 'foodId' | 'name'>): string {
  return item.foodId ? `food:${item.foodId}` : `name:${item.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export interface LineCost {
  cost: number;
  /** Packs to buy (null when the price is per item). */
  packs: number | null;
}

/** Cost of one list line at a price: whole packs when the pack size and the amount needed are known. */
export function lineCost(p: Pick<PriceEntry, 'price' | 'packG'>, amountG: number | null): LineCost {
  if (p.packG && p.packG > 0 && amountG && amountG > 0) {
    // Small tolerance so 1000 g of a 500 g pack is 2 packs, not 3, after rounding noise.
    const packs = Math.max(1, Math.ceil(amountG / p.packG - 1e-6));
    return { cost: round2(packs * p.price), packs };
  }
  return { cost: round2(p.price), packs: null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Latest saved price for each item at each shop: key → shop → entry. */
export function priceIndex(prices: PriceEntry[]): Map<string, Map<string, PriceEntry>> {
  const idx = new Map<string, Map<string, PriceEntry>>();
  for (const p of prices) {
    if (p.deletedAt !== null) continue;
    const byShop = idx.get(p.itemKey) ?? new Map<string, PriceEntry>();
    const prev = byShop.get(p.shop);
    if (!prev || p.updatedAt > prev.updatedAt) byShop.set(p.shop, p);
    idx.set(p.itemKey, byShop);
  }
  return idx;
}

export interface ShopTotal {
  shop: string;
  total: number;
  /** Lines with a price at this shop. */
  priced: number;
  lines: number;
}

/** Totals per shop over the given lines (usually the ones still to buy), cheapest first among equal coverage. */
export function shopTotals(items: ShoppingItem[], idx: Map<string, Map<string, PriceEntry>>): ShopTotal[] {
  const totals = new Map<string, ShopTotal>();
  for (const it of items) {
    for (const [shop, p] of idx.get(itemKey(it)) ?? []) {
      const t = totals.get(shop) ?? { shop, total: 0, priced: 0, lines: items.length };
      t.total = round2(t.total + lineCost(p, it.amountG).cost);
      t.priced++;
      totals.set(shop, t);
    }
  }
  return [...totals.values()].sort((a, b) => b.priced - a.priced || a.total - b.total);
}

export interface BestMix {
  total: number;
  priced: number;
  /** line id → the shop where it's cheapest */
  shopFor: Map<string, string>;
}

/** Buy each line wherever it's cheapest. */
export function bestMix(items: ShoppingItem[], idx: Map<string, Map<string, PriceEntry>>): BestMix {
  let total = 0;
  const shopFor = new Map<string, string>();
  for (const it of items) {
    let best: { shop: string; cost: number } | null = null;
    for (const [shop, p] of idx.get(itemKey(it)) ?? []) {
      const c = lineCost(p, it.amountG).cost;
      if (!best || c < best.cost) best = { shop, cost: c };
    }
    if (best) {
      total += best.cost;
      shopFor.set(it.id, best.shop);
    }
  }
  return { total: round2(total), priced: shopFor.size, shopFor };
}

export function formatMoney(n: number, currency = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
