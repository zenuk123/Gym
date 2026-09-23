import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { NumberField, TextField } from '../../components/NumberField';
import { PageHeader, SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useFoods, useRecentFoodLogs } from '../../db/hooks';
import { create, remove, update } from '../../db/repo';
import { FOOD_CATEGORIES, type FoodCategory } from '../../db/types';
import { CATEGORY_LABEL, foodUsage, searchFoods } from '../../lib/calc/food';
import { parseDecimal, round } from '../../lib/units';
import { NutritionTabs } from './NutritionTabs';
import './nutrition.css';

type Filter = 'all' | 'mine' | 'favourites';

/** Browse / manage foods: built-in database, your own foods, favourites. */
export function FoodsPage() {
  const foods = useFoods();
  const logs = useRecentFoodLogs(365);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const usage = useMemo(() => foodUsage(logs ?? []), [logs]);
  const list = useMemo(() => {
    const base = (foods ?? []).filter((f) => (filter === 'mine' ? f.source !== 'builtin' : filter === 'favourites' ? f.favourite : true));
    return searchFoods(base, q, usage);
  }, [foods, q, filter, usage]);

  return (
    <main className="page">
      <PageHeader
        title="Nutrition"
        action={
          <Link to="/nutrition/foods/new" className="btn btn-primary">
            <Icon name="plus" />
            Food
          </Link>
        }
      />
      <NutritionTabs />
      <div className="input-wrap">
        <Icon name="search" width={20} height={20} color="var(--text-3)" />
        <input type="search" placeholder="Search foods" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 8 }} />
      </div>
      <Segmented
        label="Filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'mine', label: 'My foods' },
          { value: 'favourites', label: 'Favourites' },
        ]}
      />
      <div className="list">
        {list.slice(0, 150).map((f) => (
          <div key={f.id} className="list-row">
            <Link to={`/nutrition/foods/${f.id}`} className="grow">
              <div className="title">{f.name}</div>
              <div className="desc">
                {f.brand ? `${f.brand} · ` : ''}
                {f.kcal} kcal · {round(f.proteinG, 1)} g protein per 100 {f.unit} · {CATEGORY_LABEL[f.category]}
              </div>
            </Link>
            <button
              className={`icon-btn star-btn${f.favourite ? ' on' : ''}`}
              aria-pressed={f.favourite}
              aria-label={f.favourite ? `Unfavourite ${f.name}` : `Favourite ${f.name}`}
              onClick={() => void update('foods', f.id, { favourite: !f.favourite })}
            >
              <Icon name="star" />
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="empty">{filter === 'mine' ? 'Foods you create, scan or find online appear here.' : 'No foods match.'}</p>}
      </div>
      <p className="faint" style={{ fontSize: 13, padding: '0 4px' }}>
        Built-in values are typical averages. For packaged food, scan the barcode for the exact label.
      </p>
    </main>
  );
}

const blank = { name: '', brand: '', category: 'other' as FoodCategory, unit: 'g' as 'g' | 'ml', kcal: '', protein: '', carbs: '', fat: '', fibre: '', servingG: '', servingName: '', barcode: '' };

/** Create or edit a food. Values can be entered per 100 g or per serving (converted on save). */
export function FoodEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const foods = useFoods();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = id && id !== 'new' ? foods?.find((f) => f.id === id) : undefined;
  const [form, setForm] = useState<typeof blank | null>(null);
  const [basis, setBasis] = useState<'100' | 'serving'>('100');

  if (!foods) return <main className="page" />;
  if (id !== 'new' && !existing) {
    return (
      <main className="page">
        <SubHeader title="Food" back="/nutrition/foods" />
        <p className="muted">Food not found.</p>
      </main>
    );
  }
  const f =
    form ??
    (existing
      ? {
          name: existing.name,
          brand: existing.brand ?? '',
          category: existing.category,
          unit: existing.unit,
          kcal: String(existing.kcal),
          protein: String(existing.proteinG),
          carbs: String(existing.carbsG),
          fat: String(existing.fatG),
          fibre: existing.fibreG != null ? String(existing.fibreG) : '',
          servingG: existing.servingG != null ? String(existing.servingG) : '',
          servingName: existing.servingName ?? '',
          barcode: existing.barcode ?? '',
        }
      : { ...blank, barcode: params.get('barcode') ?? '' });
  const set = (k: keyof typeof blank, v: string) => setForm({ ...f, [k]: v });

  const serving = parseDecimal(f.servingG);
  const factor = basis === 'serving' ? (serving && serving > 0 ? 100 / serving : null) : 1;
  const nums = [f.kcal, f.protein, f.carbs || '0', f.fat || '0'].map(parseDecimal);
  const valid = f.name.trim().length > 1 && nums.every((n) => n !== null && n >= 0) && factor !== null;

  async function save() {
    if (!valid) return;
    const [kcal, protein, carbs, fat] = nums as number[];
    const fibre = f.fibre.trim() ? parseDecimal(f.fibre) : null;
    const data = {
      name: f.name.trim(),
      brand: f.brand.trim() || null,
      category: f.category,
      unit: f.unit,
      kcal: Math.round(kcal * factor!),
      proteinG: round(protein * factor!, 1),
      carbsG: round(carbs * factor!, 1),
      fatG: round(fat * factor!, 1),
      fibreG: fibre === null ? null : round(fibre * factor!, 1),
      servingG: serving && serving > 0 ? serving : null,
      servingName: serving && serving > 0 ? f.servingName.trim() || '1 serving' : null,
      barcode: f.barcode.trim() || null,
    };
    if (existing) await update('foods', existing.id, data);
    else await create('foods', { ...data, source: 'custom', favourite: false, archived: false });
    toast(existing ? 'Food updated' : 'Food created');
    navigate('/nutrition/foods');
  }

  return (
    <main className="page">
      <SubHeader title={existing ? 'Edit food' : 'New food'} back="/nutrition/foods" />
      <TextField label="Name" value={f.name} onChange={(v) => set('name', v)} placeholder="e.g. Chicken wrap" />
      <TextField label="Brand (optional)" value={f.brand} onChange={(v) => set('brand', v)} />
      <div className="field-row">
        <div className="field">
          <label htmlFor="food-cat">Aisle</label>
          <div className="input-wrap">
            <select id="food-cat" value={f.category} onChange={(e) => set('category', e.target.value)}>
              {FOOD_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="label">Measured in</span>
          <Segmented
            label="Unit"
            value={f.unit}
            onChange={(v) => set('unit', v)}
            options={[
              { value: 'g', label: 'grams' },
              { value: 'ml', label: 'ml' },
            ]}
          />
        </div>
      </div>
      <div className="field-row">
        <NumberField label="Serving size" suffix={f.unit} value={f.servingG} onChange={(v) => set('servingG', v)} placeholder="optional" />
        <TextField label="Serving name" value={f.servingName} onChange={(v) => set('servingName', v)} placeholder="1 bar" />
      </div>
      <div className="field">
        <span className="label">Nutrition values are per</span>
        <Segmented
          label="Values per"
          value={basis}
          onChange={setBasis}
          options={[
            { value: '100', label: `100 ${f.unit}` },
            { value: 'serving', label: 'serving' },
          ]}
        />
        {basis === 'serving' && !serving && <span className="hint">Enter the serving size above first.</span>}
      </div>
      <div className="field-row">
        <NumberField label="Calories" suffix="kcal" value={f.kcal} onChange={(v) => set('kcal', v)} />
        <NumberField label="Protein" suffix="g" value={f.protein} onChange={(v) => set('protein', v)} />
      </div>
      <div className="field-row">
        <NumberField label="Carbs" suffix="g" value={f.carbs} onChange={(v) => set('carbs', v)} />
        <NumberField label="Fat" suffix="g" value={f.fat} onChange={(v) => set('fat', v)} />
      </div>
      <div className="field-row">
        <NumberField label="Fibre (optional)" suffix="g" value={f.fibre} onChange={(v) => set('fibre', v)} />
        <NumberField label="Barcode (optional)" decimal={false} value={f.barcode} onChange={(v) => set('barcode', v)} />
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        {existing ? 'Save food' : 'Create food'}
      </button>
      {existing && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            if (existing.source === 'builtin') await update('foods', existing.id, { archived: true });
            else await remove('foods', existing.id);
            toast(`${existing.name} removed (your log history is kept)`);
            navigate('/nutrition/foods');
          }}
        >
          {existing.source === 'builtin' ? 'Hide this food' : 'Delete food'}
        </button>
      )}
    </main>
  );
}

