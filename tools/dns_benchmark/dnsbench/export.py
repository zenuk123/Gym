"""Export results as CSV, JSON or TXT. Pure functions returning text; ``write_export`` saves to disk."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from . import APP_NAME, __version__
from . import fmt
from .diagnostics import Preflight
from .engine import MODES
from .errors import friendly_error
from .results import VIEWS, Analysis

SUMMARY_COLUMNS = ["Provider", "Average", "Median", "Min", "Max", "SuccessRate", "Score",
                   "Family", "Protocol", "Primary", "Secondary", "StdDev", "P90", "Tests", "Timeouts", "Failures",
                   "CachedMedian", "UncachedMedian", "Rank", "Eligible", "Current"]


def summary_rows(a: Analysis) -> list[dict]:
    rows = []
    for v in VIEWS:
        for e in a.views.get(v.id, []):
            p = a.run.provider(e.provider_id)
            addrs = p.addresses(v.family) if p else []
            ls = e.stats.latency
            rows.append({
                "Provider": e.name,
                "Average": fmt.num(ls.mean if ls else None),
                "Median": fmt.num(ls.median if ls else None),
                "Min": fmt.num(ls.min if ls else None),
                "Max": fmt.num(ls.max if ls else None),
                "SuccessRate": f"{e.stats.success_rate * 100:.1f}".rstrip("0").rstrip("."),
                "Score": f"{e.score.total:.0f}",
                "Family": v.family.label,
                "Protocol": v.protocol.value.upper(),
                "Primary": addrs[0] if addrs else "",
                "Secondary": addrs[1] if len(addrs) > 1 else "",
                "StdDev": fmt.num(ls.stdev if ls else None),
                "P90": fmt.num(ls.p90 if ls else None),
                "Tests": e.stats.total,
                "Timeouts": e.stats.timeouts,
                "Failures": e.stats.errors,
                "CachedMedian": fmt.num(e.stats.cached.median if e.stats.cached else None),
                "UncachedMedian": fmt.num(e.stats.uncached.median if e.stats.uncached else None),
                "Rank": e.rank,
                "Eligible": "yes" if e.eligible else f"no ({e.reason})",
                "Current": "yes" if e.is_current else "",
            })
    return rows


def to_csv(a: Analysis) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=SUMMARY_COLUMNS, lineterminator="\n")
    w.writeheader()
    w.writerows(summary_rows(a))
    return buf.getvalue()


def samples_csv(a: Analysis) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["Timestamp", "ElapsedS", "Round", "Provider", "Server", "Family", "Protocol", "Domain", "Kind",
                "Outcome", "LatencyMs", "Rcode", "Error", "ViaTCP"])
    for s in sorted(a.run.samples, key=lambda s: s.started_at):
        t = a.run.target(s.target_id)
        p = a.run.provider(t.provider_id) if t else None
        w.writerow([f"{s.started_at:.3f}", f"{s.elapsed_s:.3f}", s.round, p.display_name if p else "",
                    t.address if t else "", t.family.label if t else "", t.protocol.value if t else "", s.domain,
                    s.kind.value, s.outcome.value, fmt.num(s.latency_ms, 2), s.rcode or "", s.error_code or "",
                    "yes" if s.via_tcp else ""])
    return buf.getvalue()


def to_json(a: Analysis) -> str:
    rec = a.recommendation
    doc = a.run.to_dict()
    doc["analysis"] = {
        "weights": a.weights.to_dict(),
        "primary_view": a.primary_view,
        "recommendation": None if rec is None else {
            "provider_id": rec.winner.provider_id, "name": rec.winner.name, "headline": rec.headline,
            "details": rec.details, "vs_current": rec.vs_current, "switching_optional": rec.switching_optional,
        },
        "rankings": {
            view: [{"rank": e.rank, "provider_id": e.provider_id, "name": e.name, "eligible": e.eligible,
                    "reason": e.reason, "current": e.is_current, "score": e.score.to_dict(),
                    "stats": e.stats.to_dict()} for e in entries]
            for view, entries in a.views.items()
        },
    }
    return json.dumps(doc, indent=2)


def _table(rows: list[list[str]]) -> list[str]:
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    out = []
    for n, r in enumerate(rows):
        out.append("  ".join(c.ljust(widths[i]) if i == 0 else c.rjust(widths[i]) for i, c in enumerate(r)).rstrip())
        if n == 0:
            out.append("  ".join("-" * w for w in widths))
    return out


def to_txt(a: Analysis) -> str:
    run = a.run
    lines = [f"{APP_NAME} {__version__} — results", "=" * 40, ""]
    if run.demo:
        lines += ["*** DEMO MODE: these results are SIMULATED, not measured. ***", ""]
    lines.append(f"Date:      {fmt.when(run.started_at)}")
    lines.append(f"Test:      {MODES.get(run.mode, {}).get('label', run.mode)} ({fmt.duration(run.duration_s)}, "
                 f"{len(run.samples)} DNS queries){' — CANCELLED, partial results' if run.cancelled else ''}")
    net = run.network
    if net.get("adapter"):
        lines.append(f"Network:   {net.get('adapter')} ({net.get('connection_type') or 'unknown type'})")
    if net.get("dns_servers"):
        lines.append(f"Your DNS:  {', '.join(net['dns_servers'])}")
    lines.append(f"IPv6:      {'tested' if run.ipv6_status == 'available' else 'not available — IPv4 only'}")
    if net.get("vpn"):
        lines.append(f"VPN:       {net['vpn']} appears to be active — results may not reflect your normal connection")
    lines.append("")
    rec = a.recommendation
    if rec:
        w = rec.winner
        p = run.provider(w.provider_id)
        fam = VIEWS[0].family if a.primary_view == "ipv4" else VIEWS[1].family
        addrs = p.addresses(fam) if p else []
        lines += ["RECOMMENDED DNS", "---------------", f"{p.name if p else w.name}"]
        if addrs:
            lines.append(f"  Primary:   {addrs[0]}")
        if len(addrs) > 1:
            lines.append(f"  Secondary: {addrs[1]}")
        if p and p.ipv6 and run.ipv6_status == "available":
            lines.append(f"  IPv6:      {', '.join(p.ipv6[:2])}")
        lines += ["", rec.headline]
        lines += rec.details
        if rec.vs_current:
            lines.append(rec.vs_current)
        lines.append("")
    else:
        lines += ["No provider could be recommended — no server answered reliably.", ""]
    for v in VIEWS:
        entries = a.views.get(v.id)
        if not entries:
            continue
        rows = [["Provider", "Avg", "Median", "Best", "Worst", "Success", "Score"]]
        for e in entries:
            ls = e.stats.latency
            current = " (current)" if e.is_current and e.provider_id != "current" else ""
            rows.append([e.name + current, fmt.ms(ls.mean if ls else None),
                         fmt.ms(ls.median if ls else None), fmt.ms(ls.min if ls else None),
                         fmt.ms(ls.max if ls else None), fmt.pct(e.stats.success_rate),
                         f"{e.score.total:.0f}" if e.eligible else "—"])
        lines += [f"{v.label} results", *_table(rows), ""]
        for e in entries:
            if not e.eligible:
                why = friendly_error(e.stats.main_error, e.name, float(run.config.get("timeout_s", 2))) \
                    if e.stats.main_error else ""
                lines.append(f"  • {e.name}: not recommended — {e.reason}. {why}".rstrip())
        lines.append("")
    pf = run.diagnostics.get("preflight")
    if pf:
        warns = Preflight.from_dict(pf).warnings()
        if warns:
            lines += ["Notes", "-----"] + [f"• {m}" for _, m in warns] + [""]
    lines += ["How to read this", "----------------",
              ("Times are SIMULATED (demo mode)." if run.demo else
               "Times are real DNS lookups measured from this computer.") + " 'Median' is the typical lookup; the score",
              "combines speed (50%), reliability (30%) and consistency (20%). The best DNS differs between",
              "connections — it depends on your ISP, location, routing and time of day.", ""]
    return "\n".join(lines)


def write_export(a: Analysis, path: str | Path) -> Path:
    path = Path(path)
    ext = path.suffix.lower()
    if ext == ".csv":
        text = to_csv(a)
    elif ext == ".json":
        text = to_json(a)
    elif ext == ".txt":
        text = to_txt(a)
    else:
        raise ValueError("Choose a .csv, .json or .txt file name.")
    # utf-8-sig so Excel opens the CSV with the right encoding
    path.write_text(text, encoding="utf-8-sig" if ext == ".csv" else "utf-8", newline="")
    return path
