import type { Food, FoodCategory } from '../db/types';

/**
 * Open Food Facts (free, open database of packaged foods, no API key).
 * Used for online search and barcode lookup; chosen products are saved as your own
 * foods so they keep working offline.
 */

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_quantity,serving_size,categories_tags,quantity';

export type OffFood = Omit<Food, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_quantity?: number | string;
  serving_size?: string;
  categories_tags?: string[];
  nutriments?: Record<string, number | string | undefined>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function categoryFromTags(tags: string[] = []): FoodCategory {
  const t = tags.join(' ');
  if (/meat|poultr|fish|seafood|sausage|ham|tofu/.test(t)) return 'meat';
  if (/dair|milk|yogurt|yoghurt|chees|egg/.test(t)) return 'dairy';
  if (/fruit/.test(t)) return 'fruit';
  if (/vegetable|legume|bean|pulse/.test(t)) return 'vegetables';
  if (/cereal|bread|pasta|rice|noodle|breakfast/.test(t)) return 'carbs';
  if (/snack|sweet|chocolate|biscuit|confection|crisp|dessert/.test(t)) return 'snacks';
  return 'other';
}

/** Map an OFF product to a Food. Returns null if it lacks basic nutrition data. */
export function fromOff(p: OffProduct): OffFood | null {
  const n = p.nutriments ?? {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = num(n['energy_100g']);
    if (kj !== null) kcal = kj / 4.184;
  }
  const protein = num(n['proteins_100g']);
  const name = (p.product_name_en || p.product_name || '').trim();
  if (kcal === null || protein === null || !name) return null;
  const serving = num(p.serving_quantity);
  return {
    name,
    brand: p.brands?.split(',')[0]?.trim() || null,
    category: categoryFromTags(p.categories_tags),
    unit: 'g',
    kcal: Math.round(kcal),
    proteinG: protein,
    carbsG: num(n['carbohydrates_100g']) ?? 0,
    fatG: num(n['fat_100g']) ?? 0,
    fibreG: num(n['fiber_100g']),
    servingG: serving && serving > 0 ? serving : null,
    servingName: serving && serving > 0 ? (p.serving_size?.trim() || '1 serving') : null,
    barcode: p.code ?? null,
    source: 'openfoodfacts',
    favourite: false,
    archived: false,
  };
}

async function get(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Food database unavailable (${res.status})`);
  return res.json();
}

export async function searchOpenFoodFacts(query: string, signal?: AbortSignal): Promise<OffFood[]> {
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=24&fields=${FIELDS}`;
  const data = (await get(url, signal)) as { products?: OffProduct[] };
  return (data.products ?? []).map(fromOff).filter((f): f is OffFood => f !== null);
}

export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<OffFood | null> {
  const clean = code.replace(/\D/g, '');
  if (!clean) return null;
  const data = (await get(`${BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`, signal)) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return fromOff({ ...data.product, code: clean });
}
