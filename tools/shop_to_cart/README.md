# Shopping list → supermarket basket

Put the shopping list from Fitness OS into your supermarket basket from a computer (Windows, Linux — any
machine with Python). You stay in control: it runs in a normal browser window where **you** log in, it
**never checks out**, never sees or stores your password, and stops if the site shows a robot check.

## 1. Export the list (iPhone)

*Nutrition → Shopping → Send to supermarket → Export list.* Pick your shop (used for pack counts from your
price book), then save the file to iCloud Drive / OneDrive / email it to yourself.

## 2. One-time setup (computer)

```bash
cd tools/shop_to_cart
pip install -r requirements.txt
playwright install chromium        # or skip this and use --browser msedge (Edge is already on Windows)
```

## 3. Run it

```bash
python add_to_cart.py shopping-list-2026-09-30.json --shop tesco
```

- A browser window opens on the shop. **Log in** (first time only — the login is remembered in
  `~/.fitness-os-shopping`), then press Enter in the terminal.
- **Assist mode (default):** for each item the search results open with a banner showing what you need
  (e.g. "Chicken breast — need 1.1 kg · 2 packs"). Click *Add* on the product you want, press Enter for the
  next item. `s` skips, `b` goes back, `q` stops.
- **Auto mode:** `--mode auto` clicks the first result's *Add* button (and "+" for extra packs), waits a few
  seconds, and moves on. It lists anything it couldn't add at the end — always check the basket, because the
  first result isn't always the one you'd pick. Check your supermarket's terms before using auto mode.

Shops built in: `tesco`, `sainsburys`, `asda`, `morrisons`, `ocado`, `waitrose`, `iceland` (their public
search pages — see `sites.json`). **Any other shop:** give its search URL with `{query}` where the search
words go:

```bash
python add_to_cart.py list.json --search-url "https://www.example-shop.com/search?q={query}"
```

Other options: `--browser msedge|chrome` (use the browser you already have), `--start 8` (resume from item 8),
`--dry-run` (just show the searches), `--report report.json`, `--delay 4` (slower pacing).

Websites change their pages. If auto mode stops finding the *Add* button on your shop, use assist mode or add
an `"add_selector"` (a CSS selector for the add button) to that shop in `sites.json`.

## Tests

```bash
pip install pytest && python -m pytest tests   # uses a fake local shop, never a real one
```
