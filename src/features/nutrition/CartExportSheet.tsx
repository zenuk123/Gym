import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import type { Food, PriceEntry, ShoppingItem } from '../../db/types';
import { saveFile } from '../../lib/backup';
import { buildCartFile } from '../../lib/calc/cartExport';
import { UK_SHOPS } from '../../lib/calc/prices';
import { todayISO } from '../../lib/dates';

/** Shops the computer script knows by name (anything else works with --search-url). */
const SCRIPT_SHOPS: Record<string, string> = {
  Tesco: 'tesco',
  'Sainsbury’s': 'sainsburys',
  Asda: 'asda',
  Morrisons: 'morrisons',
  Ocado: 'ocado',
  Waitrose: 'waitrose',
  Iceland: 'iceland',
};

/**
 * Export the shopping list for the "add to cart" script (tools/shop_to_cart), which fills your
 * supermarket basket from a computer. Nothing is sent anywhere from the app itself.
 */
export function CartExportSheet({
  list,
  weekStart,
  prices,
  foods,
  initialShop,
  onClose,
}: {
  list: ShoppingItem[];
  weekStart: string;
  prices: PriceEntry[];
  foods: Map<string, Food>;
  initialShop: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const used = [...new Set(prices.map((p) => p.shop))];
  const shops = [...new Set([...Object.keys(SCRIPT_SHOPS), ...used, ...UK_SHOPS])];
  const [shop, setShop] = useState(initialShop && shops.includes(initialShop) ? initialShop : 'Tesco');
  const file = buildCartFile(list, { weekStart, shop, prices, foods });
  const name = `shopping-list-${todayISO()}.json`;
  const key = SCRIPT_SHOPS[shop];
  const command = key ? `python add_to_cart.py ${name} --shop ${key}` : `python add_to_cart.py ${name} --search-url "https://…/search?q={query}"`;

  return (
    <Sheet title="Send to supermarket" onClose={onClose}>
      <p className="muted" style={{ fontSize: 14 }}>
        Fill your online basket from a computer: export this list, then run the Fitness OS shopping script. It opens your supermarket in a browser where you log in yourself,
        searches each item, and adds it — you check out yourself.
      </p>
      <div className="field">
        <span className="label">Shop</span>
        <div className="chip-scroll" role="group" aria-label="Shop">
          {shops.map((s) => (
            <button key={s} className="chip" aria-pressed={s === shop} onClick={() => setShop(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        {file.items.length} items to buy
        {file.items.some((i) => i.quantity > 1) ? ` · pack counts from your ${shop} prices` : ''}
        {key ? '' : ` · ${shop} isn’t built into the script, so give it the shop’s search address`}
      </p>
      <button
        className="btn btn-primary btn-lg btn-block"
        disabled={file.items.length === 0}
        onClick={async () => {
          await saveFile(JSON.stringify(file, null, 2), name, 'application/json');
          toast('List exported');
        }}
      >
        <Icon name="download" /> Export list ({file.items.length} items)
      </button>
      <ol className="steps-plain">
        <li>Save the file somewhere your computer can reach (iCloud Drive, OneDrive, or email it to yourself).</li>
        <li>
          On the computer, open a terminal in <code>tools/shop_to_cart</code> (first time: <code>pip install -r requirements.txt</code>).
        </li>
        <li>
          Run:
          <div className="command">
            <code>{command}</code>
            <button
              className="icon-btn"
              aria-label="Copy command"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(command);
                  toast('Command copied');
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              <Icon name="copy" width={18} height={18} />
            </button>
          </div>
        </li>
        <li>Log in, then click Add for each item (or add <code>--mode auto</code> to let it click for you). Review the basket and check out yourself.</li>
      </ol>
      <p className="faint" style={{ fontSize: 12 }}>
        The script never checks out and never sees your password. Full instructions: <code>tools/shop_to_cart/README.md</code>.
      </p>
    </Sheet>
  );
}
