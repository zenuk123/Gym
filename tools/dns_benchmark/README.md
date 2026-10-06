# DNS Benchmark — find the best DNS for *your* connection

A Windows desktop app that sends **real DNS queries** from your PC to the major public DNS providers *and* to the DNS
you use now, measures speed, reliability and consistency, and tells you — in plain English — which DNS servers to put
in your router. Optional one-click "Apply to Windows" with a safe, verified "Restore previous DNS".

Runs locally. No account, no adverts, no telemetry, nothing uploaded.

![The app's icon](assets/app.png)

---

## 1. Get the app

### Easiest: download the ready-made .exe
1. Open the repository on GitHub → **Actions** → **DNS Benchmark (Windows app)** → the latest green run.
2. Under **Artifacts**, download **DNSBenchmark-windows** and unzip it.
3. Double-click **DNSBenchmark.exe**. (`DNSBenchmark-cli.exe` is the command-line version.)

The .exe isn't code-signed, so the first time Windows SmartScreen may say *"Windows protected your PC"*: click
**More info → Run anyway**. That's normal for unsigned apps you build yourself.

**Portable mode:** create an empty file called `portable.txt` next to the .exe and the app keeps its settings and
history in a `data` folder beside it instead of `%APPDATA%\DNS Benchmark`.

### Run from source (any Windows PC with Python)
Requirements: **Windows 10 or 11**, **Python 3.10+** (python.org installer, tick "Add to PATH").

```powershell
cd tools\dns_benchmark
py -3 -m pip install -r requirements.txt
py -3 run.py            # the desktop app
py -3 run.py --cli      # the command-line version
py -3 run.py --demo     # explore the UI with clearly-labelled simulated results
```

Dependencies: [`dnspython`](https://www.dnspython.org/) (real DNS wire-protocol queries) and
[`PySide6`](https://doc.qt.io/qtforpython-6/) (Qt 6 user interface). Nothing else.

## 2. Using it

1. Open the app. The **Dashboard** shows your current DNS (and how fast it is), your network adapter, connection type,
   IPv4/IPv6, default gateway and whether a VPN is active.
2. Click **TEST MY DNS** (quick test, ~30–60 s). Or **Full benchmark** (~3 min, more reliable) or **Gaming DNS**.
3. Watch live progress; **Cancel** at any time.
4. See **🏆 BEST DNS FOR YOUR CONNECTION** with the primary/secondary addresses (and IPv6 ones when your connection has
   IPv6), why it won, and how much faster it is than your current DNS.
5. **Copy DNS** → paste into your router (see §6), or **Apply to Windows** for this PC only.
6. **View details** / click any provider for averages, medians, min/max, reliability, failures, cached vs uncached
   times, per-server results and a response-time graph.
7. **History** keeps every completed test so you can see if your best DNS changes over time. **Export** CSV, JSON or
   TXT from the Results page.

### Command line

```
DNSBenchmark-cli.exe                         # quick test, prints the report
DNSBenchmark-cli.exe --mode full --export results.csv --export results.json
DNSBenchmark-cli.exe --no-ipv6 --dot         # skip IPv6, also try DNS-over-TLS
DNSBenchmark-cli.exe --help
```

Ctrl+C cancels and still prints the partial results.

## 3. How the benchmark works (methodology)

**It measures DNS, not ping.** Each measurement is a real DNS query (EDNS0, recursion desired, UDP port 53 with
automatic TCP retry if the answer is truncated — exactly what Windows and routers do), timed from just before it is
sent until the parsed answer is back. ICMP ping is never used: it measures a different service and can disagree with
DNS speed.

**What's tested.** Cloudflare, Google, Quad9, AdGuard, OpenDNS, Control D, DNS.SB, DNS4EU and CleanBrowsing by
default; filtered variants (malware/family) can be switched on in Settings, and you can add your own servers.
**Your current DNS servers are detected from Windows and always included** — never assumed. If Windows uses a known
provider, that provider is marked "current"; otherwise a "Current DNS" entry tests exactly the detected address
(often your router, which forwards to your ISP). Both the primary and secondary address of each provider are tested.

**Fair comparison.**
- *Rounds:* every server gets exactly one query per round, and in each round all servers are asked about **the same
  domain**, so nobody gets an easier question.
- *Random order:* the order of servers is reshuffled every round, the order of domains every run.
- *Spread over time:* rounds are paced (1.5–2.5 s apart) so every server is sampled across the whole test and a
  temporary hiccup affects everyone equally. Every query is time-stamped (visible in the Timeline graph and raw
  export).
- *Warm-up:* one unmeasured query per server first (opens NAT/firewall state; finds dead servers early).
- *Gentle:* ≤ 4 queries in flight, never two to one server, a global rate limit, and a server that never answers is
  dropped after 5 failures.

**Cache bias.** Repeating one name only measures a cache hit. The app uses two kinds of lookup and reports them
separately:
- **Cached** — popular sites (google.com, youtube.com, bbc.co.uk, steampowered.com, … 32 domains across many CDNs and
  DNS operators). A busy public resolver almost always has these cached; this is what browsing feels like.
- **Uncached** — a unique random name under a real zone (e.g. `dnsbk3j9x0a2.wikipedia.org`). Nobody has asked for it
  before, so the resolver must ask the zone's authoritative servers. The zones (google.com, microsoft.com,
  amazon.com, wikipedia.org, bbc.co.uk, yahoo.com, akamai.com, mozilla.org, spotify.com) were checked to answer random
  names with a plain "does not exist" (no wildcard) and use different DNS operators, so no provider is favoured.
  25–30 % of rounds are uncached. "Does not exist" (NXDOMAIN) counts as a successful answer.

**Modes.** Quick: 16 rounds (32 queries per provider over ~25 s). Full: 60 rounds (120 per provider over ~2.5 min).
Gaming: 20 rounds using game platform, launcher and voice-chat domains.

**IPv4 / IPv6.** Before testing, the app checks whether IPv6 has a route *and* actually reaches well-known DNS
servers. IPv6 servers are benchmarked separately (their own tab) only when it works; otherwise the app says
"IPv6 testing unavailable" and **does not mark any provider as failed**.

**Pre-flight diagnostics** (shown as plain-English notes):
- *No internet* — nothing answers → the test doesn't start and says why.
- *Firewall/ISP blocking DNS* — your current DNS works but public DNS doesn't.
- *Captive portal* — Windows' own connectivity page (`www.msftconnecttest.com`) returns something else (optional).
- *DNS interception / router redirection* — Cloudflare (`id.server` CH TXT → airport code), Quad9 and OpenDNS
  "who are you?" queries come back wrong, or a reserved address (192.0.2.1) answers. If so, "Cloudflare" results may
  really be your router's/ISP's resolver, and the app warns you.
- *NXDOMAIN redirection* — your ISP returns an address for non-existent names.
- *VPN* — detected from the network adapters; you're warned that results may not reflect your normal connection
  (testing still runs).

What the numbers are: response times for real lookups **from this PC on this connection, right now**. The best DNS
is not the same for everyone — ISP, location, routing, peering, congestion, server load, caching, IPv4/IPv6, VPNs and
router behaviour all matter, and it can change over time. That's why the app recommends from measurements, not
rankings, and keeps a history.

## 4. How the score works

Never "lowest single result wins". Each provider (per IP family) gets three sub-scores, 0–100:

| Part | Default weight | How it's calculated |
|---|---|---|
| **Speed** | 50 % | *Typical time* = 0.7 × median + 0.3 × average, blended 70/30 cached/uncached. Log scale: ≤ 5 ms → 100, 1000 ms → 0 (10→20 ms costs the same as 50→100 ms). |
| **Reliability** | 30 % | 100 − 10 points per 1 % of queries that failed or timed out (90 % success → 0). |
| **Consistency** | 20 % | How far the 90th percentile sits above the median (log scale, 0 ms → 100, 200 ms → 0), minus 2 points per 1 % of *slow spikes* (≥ 3× median and ≥ 50 ms over it). |

Rules on top: a provider needs ≥ 5 successful answers to be ranked, and if any provider reached ≥ 98 % success, one
below 95 % can't be recommended. So a server with a great median but occasional 100 ms spikes, or one that drops
queries, loses to a steady one — the Timeline and Consistency graphs show why. When two providers are within normal
run-to-run variation (< 1 ms or 5 %, same reliability) the app says they're effectively tied; when your current DNS
is nearly as good it says switching is optional. Weights are adjustable in **Settings → Scoring** (saved results are
re-ranked with the new weights).

## 5. Windows DNS (optional, reversible)

**Apply to Windows** (Results page): confirm → Windows UAC prompt → the app
1. records the active adapter's current DNS (automatic/DHCP **or** the static list, IPv4 and IPv6) to
   `%APPDATA%\DNS Benchmark\dns_backup.json` **before** changing anything — and never overwrites an earlier backup,
   so Restore always returns to what you had before first using the app;
2. sets the new servers (`Set-DnsClientServerAddress`) — IPv6 too when your connection has IPv6 (recommended, or
   Windows may keep using your ISP's IPv6 DNS);
3. flushes the DNS cache;
4. reads the settings back and verifies them, then reports success or a plain-English failure.

**Restore previous DNS** (Results or Settings) puts the original configuration back the same way and verifies it.
Declining the UAC prompt changes nothing. Only this PC is affected — the router is never touched.

## 6. Putting the DNS on your router

Router DNS usually applies to **every device** on your network (Windows DNS only to this PC). Every router differs, so
the app gives general steps (also in the app under **Learn → Set up your router**):

1. Browse to your router — usually the **default gateway** shown on the Dashboard (e.g. `192.168.0.1`,
   `192.168.1.1`, `192.168.1.254`) — and sign in (the password is often on a sticker on the router).
2. Find **Internet / WAN / DNS** or **DHCP / LAN** settings. *WAN DNS* is what the router itself uses; *DHCP/LAN DNS*
   is what it hands to your devices. Either usually works.
3. Change DNS from automatic to manual and enter the **primary** and **secondary** addresses ("Copy DNS").
4. If there are **IPv6 DNS** fields and you have IPv6, enter the provider's IPv6 addresses too.
5. Save, restart the router or reconnect devices, then run the test again — "Your current DNS" should now show the new
   provider.

Some ISP routers don't allow changing DNS; then set it per device (e.g. Apply to Windows) or use your own router.

## 7. "Best DNS right now" (automatic checks)

Settings → *Disabled / Daily / Weekly / Monthly*. This creates a Windows Task Scheduler task
(`DNS Benchmark\Best DNS check`) that runs a quick headless test at 12:00 while you're signed in, saves it to history
and shows a notification **only** if a different provider is now clearly better (≥ 10 % and ≥ 3 ms faster, or your
previous best became unreliable). Skipped when offline or on a VPN. Nothing runs in the background otherwise.

## 8. Privacy

- No account, no telemetry, no adverts, nothing uploaded. Settings, history and backups stay on this PC.
- The benchmark necessarily sends DNS queries to the providers it tests (that *is* the measurement): popular site
  names and random test names.
- Diagnostics add a handful of DNS queries (identity checks to Cloudflare/Quad9/OpenDNS, one to 192.0.2.1, one made-up
  name, and Google's `o-o.myaddr.l.google.com` to show which resolver serves you).
- The optional captive-portal check fetches `http://www.msftconnecttest.com/connecttest.txt` — the page Windows itself
  checks. Turn it off in Settings.
- Your public IP is only looked up if you click **Show** (one DNS query to OpenDNS's `myip.opendns.com`).
- Saved results contain your adapter name, connection type and DNS server addresses — no public IP, no MAC address.

## 9. Gaming

The Gaming test measures how fast game platforms, launchers, log-in and voice services resolve. **DNS does not change
in-game ping** — once you're connected to a game server DNS isn't involved. It can affect launcher start-up, log-in,
matchmaking service discovery and which CDN you download from.

## 10. Tests

```powershell
py -3 -m pip install -r requirements-dev.txt
py -3 -m pytest
```

105 automated tests (they run on Windows and Linux; the UI tests render off-screen) cover:

| Area | Tests |
|---|---|
| DNS resolution | real queries to a local DNS server: answers, NXDOMAIN, SERVFAIL, REFUSED, TCP fallback on truncation, closed port (`test_transport.py`) |
| Timeout handling | silent server times out within the limit; unreachable servers dropped early (`test_transport.py`, `test_engine.py`) |
| Statistics | percentiles, mean/median/stdev, spikes, rates, cached vs uncached (`test_stats.py`) |
| Scoring + test mode | fake latency profiles prove a steady server beats a spiky one, a reliable one beats a fast-but-flaky one, ties and "switching optional" are reported, and scheduled-change detection (`test_scoring.py`) |
| Engine | randomised fair plan, every domain used, unique uncached names, pacing, rate limit, concurrency limit, one query in flight per server, cancellation (`test_engine.py`) |
| Providers | built-in database valid; current DNS detection (router/ISP, never assumed), custom providers (`test_providers.py`) |
| IPv4/IPv6 & network | Windows PowerShell JSON parsing (active adapter, global IPv6 only, VPN, connection type), Linux parsing, IPv6 unavailable/not working/available, no internet, blocked DNS, interception + NXDOMAIN redirection (`test_network.py`) |
| DNS backup/restore | a fake Windows that *executes the generated PowerShell*: backup written before change, verify, restore to DHCP or static, original backup kept, UAC declined, failures, injection attempts rejected (`test_windows_dns.py`) |
| Export & storage | CSV/JSON/TXT, JSON round-trip, settings corruption recovery, history save/load/rebuild, scheduler arguments (`test_export_storage.py`) |
| UI | every page and chart renders with simulated data in dark and light themes (`test_ui_smoke.py`) |

**Test/demo mode:** `dnsbench/fake.py` provides `FakeTransport` + `LatencyProfile` (base latency, jitter, spike and
timeout probability…) so the whole pipeline can run on supplied fake results. `--demo` uses it for the UI, with a
"DEMO MODE — simulated" label everywhere; demo results never feed the scheduler or "Apply to Windows".

## 11. Build a standalone .exe

On Windows:

```powershell
cd tools\dns_benchmark
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

This creates a virtual environment, installs dependencies, runs the tests, and runs PyInstaller with
`packaging/DNSBenchmark.spec`, producing `dist\DNSBenchmark.exe` (the app, no console window) and
`dist\DNSBenchmark-cli.exe`. Both are single files (~45–70 MB, Qt included) that need no Python.

Manually: `pip install -r requirements-dev.txt` then `pyinstaller --noconfirm packaging/DNSBenchmark.spec`.

Without a Windows build machine: push to GitHub — `.github/workflows/dns-benchmark.yml` runs the tests on Windows,
checks real network detection, runs a real quick benchmark, builds both .exe files and uploads them as an artifact.
Run it manually from the Actions tab with **Run workflow**.

The icon is drawn in code; regenerate `assets/app.ico` with `python packaging/make_icon.py`.

## 12. Architecture

```
dnsbench/
  providers.py, data/providers.json   DNS provider database (+ custom providers, current-DNS merge)
  domains.py                          test domain lists, uncached-name generator
  transport.py                        DNS resolver: UDP(+TCP fallback), TCP, DoT — the only benchmark network code
  engine.py                           benchmark engine: plan, randomise, pace, rate-limit, cancel, timestamps
  stats.py                            statistics engine
  scoring.py                          scoring engine + plain-English recommendation
  results.py                          BenchmarkRun (saved) + analysis per view (IPv4 / IPv6 / DoT)
  network.py, diagnostics.py          network detection, IPv6/VPN/interception/captive-portal checks
  benchmark.py                        orchestration shared by UI, CLI and scheduled checks
  windows_dns.py, winshell.py         Windows DNS manager (backup → apply → flush → verify → restore)
  storage.py, export.py               settings/history storage, CSV/JSON/TXT export
  scheduler.py, scheduled.py          Task Scheduler integration + headless check
  errors.py                           exception → plain-English message (+ technical detail)
  fake.py                             test mode / demo transport
  cli.py, main.py                     command line + entry point
  ui/                                 PySide6 interface (pages, custom-painted charts, theme)
```

Networking and maths never import the UI; the engine only talks to a `Transport`, so it is tested with the fake one.
New protocols plug in as a new transport class (DNS-over-TLS is already implemented and optional; DNS-over-HTTPS would
be another class). Planned/possible next steps: router auto-detection and model-specific guides, DoH benchmarking,
filtering/privacy comparisons, tray app.

## 13. Troubleshooting

- **All providers fail / "public DNS servers can't be reached"** — your router, ISP, workplace or antivirus firewall
  blocks outbound DNS (UDP/TCP 53). Changing DNS won't work on that network.
- **"DNS redirection detected"** — your router or ISP answers DNS itself regardless of the server you ask. Look for a
  "DNS proxy", "DNS hijack", "safe browsing" or "web protection" option in the router/ISP account.
- **VPN warning** — disconnect the VPN for a home-router result.
- **Apply to Windows failed** — the message says why; "Technical details" has the PowerShell error. Nothing is left
  half-changed without a backup; use **Restore previous DNS**.
