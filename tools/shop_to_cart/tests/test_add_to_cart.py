"""Runs the script against a tiny fake supermarket served locally (no real shop is contacted).

  pip install playwright pytest && playwright install chromium
  python -m pytest tools/shop_to_cart/tests
(Set FOS_BROWSER_PATH to use an existing Chromium instead.)
"""
from __future__ import annotations

import html
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import add_to_cart  # noqa: E402

BASKET: dict[str, int] = {}
LISTED: list[str] = []

PAGE = """<!doctype html><html><head><title>{title}</title></head><body>
<h1>{title}</h1>{body}
<script>
async function post(path, body) {{ await fetch(path, {{method: 'POST', body: JSON.stringify(body)}}); }}
document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {{
  const id = b.dataset.add;
  await post('/basket', {{id, delta: 1}});
  const tile = b.closest('.tile');
  b.remove();
  const plus = document.createElement('button');
  plus.setAttribute('aria-label', 'Increase quantity');
  plus.textContent = '+';
  plus.addEventListener('click', () => post('/basket', {{id, delta: 1}}));
  tile.appendChild(plus);
}}));
document.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => post('/list', {{id: b.dataset.list}})));
</script></body></html>"""


class Shop(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, body: str, kind="text/html"):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/basket":
            return self._send(200, json.dumps(BASKET), "application/json")
        q = parse_qs(u.query).get("q", [""])[0]
        if "robot" in q:
            return self._send(200, PAGE.format(title="Pardon our interruption", body="<p>Please complete the captcha.</p>"))
        if "nothing" in q:
            return self._send(200, PAGE.format(title="Search", body="<p>No results.</p>"))
        tiles = "".join(
            f'<div class="tile"><h2>{html.escape(q)} {i}</h2>'
            f'<button data-list="{html.escape(q)}-{i}">Add to list</button>'
            f'<button data-add="{html.escape(q)}-{i}" aria-label="Add {html.escape(q)} {i} to basket">Add</button></div>'
            for i in (1, 2)
        )
        # A promo button that also starts with "Add" must never be pressed.
        return self._send(200, PAGE.format(title=f"Search: {html.escape(q)}", body=f'<button onclick="fetch(\'/promo\',{{method:\'POST\'}})">Add promo code</button>{tiles}'))

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}"
        data = json.loads(body)
        if self.path == "/basket":
            BASKET[data["id"]] = BASKET.get(data["id"], 0) + data["delta"]
        elif self.path == "/list":
            LISTED.append(data["id"])
        elif self.path == "/promo":
            LISTED.append("PROMO")
        self._send(200, "{}", "application/json")


@pytest.fixture(scope="module")
def shop():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Shop)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/search?q={{query}}"
    srv.shutdown()


def write_list(tmp_path: Path, items: list[dict]) -> Path:
    p = tmp_path / "list.json"
    p.write_text(json.dumps({"format": "fitness-os-shopping-list", "version": 1, "shop": None, "items": items}))
    return p


def run(argv, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda *_: (_ for _ in ()).throw(EOFError()))
    return add_to_cart.main(argv)


def test_auto_mode_adds_items_and_extra_packs(tmp_path, shop, monkeypatch):
    BASKET.clear()
    LISTED.clear()
    lst = write_list(tmp_path, [
        {"name": "Chicken breast (raw)", "search": "chicken breast", "need": "1.1 kg", "quantity": 2},
        {"name": "Rolled oats", "search": "rolled oats", "quantity": 1},
        {"name": "Mystery", "search": "nothing here", "quantity": 1},
    ])
    report = tmp_path / "report.json"
    run([str(lst), "--search-url", shop, "--mode", "auto", "--headless", "--no-login-pause", "--delay", "0", "--report", str(report), "--profile-dir", str(tmp_path / "profile")], monkeypatch)
    results = json.loads(report.read_text())
    assert [(r["name"], r["status"], r["added"]) for r in results] == [
        ("Chicken breast (raw)", "added", 2),
        ("Rolled oats", "added", 1),
        ("Mystery", "not-found", 0),
    ]
    assert BASKET == {"chicken breast-1": 2, "rolled oats-1": 1}
    assert LISTED == []  # never pressed "Add to list" or "Add promo code"


def test_stops_at_robot_check(tmp_path, shop, monkeypatch):
    lst = write_list(tmp_path, [{"name": "Robot", "search": "robot", "quantity": 1}, {"name": "Later", "search": "later", "quantity": 1}])
    report = tmp_path / "report.json"
    run([str(lst), "--search-url", shop, "--mode", "auto", "--headless", "--no-login-pause", "--delay", "0", "--report", str(report), "--profile-dir", str(tmp_path / "profile")], monkeypatch)
    results = json.loads(report.read_text())
    assert [(r["name"], r["status"]) for r in results] == [("Robot", "blocked")]


def test_dry_run_and_validation(tmp_path, capsys, monkeypatch):
    lst = write_list(tmp_path, [{"name": "Turkey mince", "search": "turkey mince 5% fat", "quantity": 1}])
    run([str(lst), "--shop", "tesco", "--dry-run"], monkeypatch)
    out = capsys.readouterr().out
    assert "https://www.tesco.com/groceries/en-GB/search?query=turkey+mince+5%25+fat" in out
    # The shop name as the app writes it (curly apostrophe) is understood.
    lst2 = tmp_path / "l2.json"
    lst2.write_text(json.dumps({"format": "fitness-os-shopping-list", "version": 1, "shop": "Sainsbury’s", "items": [{"name": "Oats", "search": "oats"}]}))
    run([str(lst2), "--dry-run"], monkeypatch)
    assert "sainsburys.co.uk/gol-ui/SearchResults/oats" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    with pytest.raises(SystemExit):
        add_to_cart.main([str(bad), "--dry-run"])
    with pytest.raises(SystemExit):
        add_to_cart.main([str(lst), "--search-url", "https://x.example/search", "--dry-run"])
