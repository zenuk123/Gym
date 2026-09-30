#!/usr/bin/env python3
"""
Fitness OS — put your shopping list in a supermarket basket.

Reads the list exported from the app (Nutrition → Shopping → Send to supermarket) and
works through it on the supermarket's own website, in a real browser window where you
are logged in as yourself:

  assist mode (default)  opens the search for each item; you click "Add" and press Enter.
  auto mode              clicks the first result's "Add" button for you (and the "+"
                         button for extra packs), then moves on. Check the basket after.

It never checks out, never stores your password (you log in yourself; the browser keeps
its own session in a local profile folder), never tries to get past robot checks (it
stops and waits for you), and waits a few seconds between items like a person would.
Check your supermarket's terms of use before using auto mode.

Usage:
  pip install -r requirements.txt
  playwright install chromium          # or use --browser msedge / chrome
  python add_to_cart.py shopping-list.json --shop tesco
  python add_to_cart.py shopping-list.json --shop tesco --mode auto
  python add_to_cart.py shopping-list.json --search-url "https://example.com/search?q={query}"
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus

HERE = Path(__file__).resolve().parent
FORMAT = "fitness-os-shopping-list"

# Buttons we must never press, even if their label starts with "Add".
NOT_ADD = re.compile(r"address|list|favourite|wishlist|review|note|coupon|voucher|promo|checkout|substitut", re.I)
ADD = re.compile(r"^\s*add\b", re.I)
MORE = re.compile(r"increase|increment|add one|\bplus\b|^\s*\+\s*$", re.I)
ROBOT = re.compile(r"captcha|are you a robot|verify you are (a )?human|unusual traffic|access denied|pardon our interruption", re.I)


@dataclass
class Item:
    name: str
    search: str
    need: str = ""
    quantity: int = 1
    price: float | None = None


@dataclass
class Result:
    name: str
    status: str  # added | partial | skipped | not-found | blocked
    added: int = 0
    detail: str = ""
    url: str = ""


@dataclass
class Site:
    name: str
    search: str
    home: str | None = None
    add_selector: str | None = None
    extra: dict = field(default_factory=dict)


def load_list(path: Path) -> tuple[dict, list[Item]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != FORMAT:
        raise SystemExit(f"{path} isn't a Fitness OS shopping list (export it from Nutrition → Shopping).")
    items = []
    for raw in data.get("items", []):
        name = str(raw.get("name", "")).strip()
        if not name:
            continue
        qty = raw.get("quantity") or 1
        items.append(Item(name=name, search=str(raw.get("search") or name), need=str(raw.get("need") or ""), quantity=max(1, min(int(qty), 20)), price=raw.get("price")))
    return data, items


def load_site(shop: str | None, search_url: str | None) -> Site:
    if search_url:
        if "{query}" not in search_url:
            raise SystemExit("--search-url must contain {query}, e.g. https://shop.example/search?q={query}")
        return Site(name="Custom shop", search=search_url)
    sites = json.loads((HERE / "sites.json").read_text(encoding="utf-8"))
    key = re.sub(r"[^a-z]", "", (shop or "").lower())  # "Sainsbury’s" → "sainsburys"
    if key not in sites:
        known = ", ".join(k for k in sites if not k.startswith("_"))
        raise SystemExit(f"Unknown shop '{shop}'. Use one of: {known} — or --search-url.")
    s = sites[key]
    return Site(name=s["name"], search=s["search"], home=s.get("home"), add_selector=s.get("add_selector"))


def search_url(site: Site, term: str) -> str:
    return site.search.replace("{query}", quote_plus(term))


def overlay(page, text: str) -> None:
    """Show which item we're on, inside the page (so you can see it without the terminal)."""
    try:
        page.evaluate(
            """(text) => {
                let el = document.getElementById('fos-overlay');
                if (!el) {
                  el = document.createElement('div');
                  el.id = 'fos-overlay';
                  el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:12px 16px;border-radius:12px;background:#0b0d10;color:#c6f432;font:600 15px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.4);pointer-events:none';
                  document.documentElement.appendChild(el);
                }
                el.textContent = text;
            }""",
            text,
        )
    except Exception:
        pass  # pages mid-navigation can refuse scripts; the terminal still shows the item


def blocked(page) -> bool:
    try:
        return bool(ROBOT.search(page.title() + " " + page.inner_text("body", timeout=3000)[:5000]))
    except Exception:
        return False


def visible_buttons(page, pattern: re.Pattern):
    buttons = page.get_by_role("button", name=pattern)
    out = []
    for i in range(min(buttons.count(), 40)):
        b = buttons.nth(i)
        try:
            label = (b.get_attribute("aria-label") or b.inner_text(timeout=500) or "").strip()
            if b.is_visible() and b.is_enabled() and not NOT_ADD.search(label):
                out.append(b)
        except Exception:
            continue
    return out


def auto_add(page, site: Site, item: Item) -> Result:
    candidates = [page.locator(site.add_selector).first] if site.add_selector else visible_buttons(page, ADD)
    if not candidates:
        return Result(item.name, "not-found", detail="No 'Add' button found — add it yourself or use assist mode.", url=page.url)
    candidates[0].scroll_into_view_if_needed()
    candidates[0].click()
    added = 1
    time.sleep(0.8)
    while added < item.quantity:
        more = visible_buttons(page, MORE)
        if not more:
            break
        more[0].click()
        added += 1
        time.sleep(0.6)
    if added < item.quantity:
        return Result(item.name, "partial", added, f"Added {added} of {item.quantity} — set the quantity yourself.", page.url)
    return Result(item.name, "added", added, url=page.url)


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip().lower()
    except EOFError:
        return "q"


def run(args) -> list[Result]:
    data, items = load_list(Path(args.list))
    site = load_site(args.shop or data.get("shop"), args.search_url)
    items = items[args.start - 1 :]
    print(f"{len(items)} items for {site.name} ({args.mode} mode).")

    if args.dry_run:
        for i, it in enumerate(items, args.start):
            print(f"{i:>3}. {it.name}  ×{it.quantity}  → {search_url(site, it.search)}")
        return []

    from playwright.sync_api import sync_playwright  # imported late so --dry-run works without it

    results: list[Result] = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(Path(args.profile_dir).expanduser()),
            headless=args.headless,
            channel=None if args.browser == "chromium" else args.browser,
            executable_path=os.environ.get("FOS_BROWSER_PATH") or None,
            viewport=None if not args.headless else {"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        if site.home and not args.no_login_pause:
            page.goto(site.home, wait_until="domcontentloaded")
            ask(f"\nLog in to {site.name} in the browser window if you aren't already, then press Enter here to start… ")

        i = 0
        while i < len(items):
            it = items[i]
            n = i + args.start
            url = search_url(site, it.search)
            label = f"{n}/{len(items) + args.start - 1}: {it.name}" + (f" — need {it.need}" if it.need else "") + (f" · {it.quantity} packs" if it.quantity > 1 else "")
            print(f"\n{label}")
            page.goto(url, wait_until="domcontentloaded")
            time.sleep(1.2)
            if blocked(page):
                print("  The site is asking for a robot check. Please complete it in the browser.")
                if ask("  Press Enter when done (q to stop): ") == "q":
                    results.append(Result(it.name, "blocked", detail="Stopped at a robot check", url=url))
                    break
                page.goto(url, wait_until="domcontentloaded")
                time.sleep(1.0)
            overlay(page, f"Fitness OS · {label}")

            if args.mode == "auto":
                try:
                    r = auto_add(page, site, it)
                except Exception as e:  # a site changed its page: record it and keep going
                    r = Result(it.name, "not-found", detail=f"Couldn't add automatically ({type(e).__name__}).", url=url)
                print(f"  {r.status}{': ' + r.detail if r.detail else ''}")
                results.append(r)
                i += 1
                time.sleep(args.delay + random.uniform(0, min(2.0, args.delay)))
            else:
                key = ask("  Add it in the browser, then press Enter  (s = skip, b = back, q = quit): ")
                if key == "q":
                    break
                if key == "b":
                    i = max(0, i - 1)
                    results = results[:-1]
                    continue
                results.append(Result(it.name, "skipped" if key == "s" else "added", 0 if key == "s" else it.quantity, url=url))
                i += 1

        overlay(page, "Fitness OS · Done — review your basket and check out yourself.")
        print("\nDone. Review your basket in the browser and check out yourself — this script never checks out.")
        if not args.headless:
            ask("Press Enter to close the browser… ")
        ctx.close()
    return results


def summarise(results: list[Result]) -> None:
    if not results:
        return
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print("Summary: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    for r in results:
        if r.status not in ("added",):
            print(f"  • {r.name}: {r.status}{' — ' + r.detail if r.detail else ''}")


def main(argv: list[str] | None = None) -> int:
    # Older Windows consoles can't print every character; never crash over an arrow or a dash.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="Add your Fitness OS shopping list to a supermarket basket.")
    ap.add_argument("list", help="shopping-list JSON exported from the app")
    ap.add_argument("--shop", help="tesco, sainsburys, asda, morrisons, ocado, waitrose, iceland (default: the shop chosen in the app)")
    ap.add_argument("--search-url", help="any other shop: its search URL with {query}, e.g. https://shop.example/search?q={query}")
    ap.add_argument("--mode", choices=["assist", "auto"], default="assist", help="assist: you click Add (default); auto: the script clicks Add")
    ap.add_argument("--browser", choices=["chromium", "msedge", "chrome"], default="chromium", help="msedge/chrome use the browser already on your PC")
    ap.add_argument("--profile-dir", default=str(Path.home() / ".fitness-os-shopping"), help="where the browser keeps your login between runs")
    ap.add_argument("--start", type=int, default=1, help="start at item N (to resume)")
    ap.add_argument("--delay", type=float, default=2.0, help="seconds to wait between items in auto mode (plus a little randomness)")
    ap.add_argument("--report", help="write a JSON report of what happened")
    ap.add_argument("--dry-run", action="store_true", help="just list the searches, don't open a browser")
    ap.add_argument("--headless", action="store_true", help=argparse.SUPPRESS)  # tests only
    ap.add_argument("--no-login-pause", action="store_true", help="don't stop to let you log in first")
    args = ap.parse_args(argv)
    if args.start < 1:
        ap.error("--start must be 1 or more")

    results = run(args)
    summarise(results)
    if args.report:
        Path(args.report).write_text(json.dumps([r.__dict__ for r in results], indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
