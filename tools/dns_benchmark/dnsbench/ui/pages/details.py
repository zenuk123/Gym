"""Provider details: everything measured for one provider, per server and per protocol."""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QDialog, QHBoxLayout, QHeaderView, QPlainTextEdit, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from ... import fmt
from ...errors import friendly_error
from ...models import Protocol
from ...results import VIEWS, Analysis
from ..charts import TimelineChart, TimelinePoint, TimelineSeries
from ..widgets import AddressBox, Card, Details, button, label, scrollable, stat_grid

if TYPE_CHECKING:
    from ..app import MainWindow


class ProviderDetailsDialog(QDialog):
    def __init__(self, app: MainWindow, a: Analysis, provider_id: str, view_id: str | None = None) -> None:
        super().__init__(app)
        self.app = app
        p = a.run.provider(provider_id)
        self.setWindowTitle(f"{p.name if p else provider_id} — details")
        self.resize(940, 760)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        inner = QWidget()
        inner.setObjectName("page")
        col = QVBoxLayout(inner)
        col.setContentsMargins(24, 20, 24, 20)
        col.setSpacing(14)
        outer.addWidget(scrollable(inner))

        view_id = view_id or a.primary_view
        entry = next((e for e in a.ranking(view_id) if e.provider_id == provider_id), None)
        if entry is None:  # provider not tested in this view: fall back to any view it appears in
            for v in VIEWS:
                entry = next((e for e in a.ranking(v.id) if e.provider_id == provider_id), None)
                if entry:
                    view_id = v.id
                    break
        view = next(v for v in VIEWS if v.id == view_id)
        timeout = float(a.run.config.get("timeout_s", 2))

        head = QHBoxLayout()
        title = QVBoxLayout()
        title.addWidget(label(p.name if p else provider_id, "h1"))
        if p and p.description:
            title.addWidget(label(p.description, "secondary", wrap=True))
        head.addLayout(title, 1)
        if p and p.is_current:
            head.addWidget(label("Currently in use", "tagAccent"), 0, Qt.AlignmentFlag.AlignTop)
        col.addLayout(head)

        addr = QHBoxLayout()
        if p:
            for i, a4 in enumerate(p.ipv4[:2]):
                addr.addWidget(AddressBox(f"{'Primary' if i == 0 else 'Secondary'} IPv4", a4))
            for i, a6 in enumerate(p.ipv6[:2]):
                addr.addWidget(AddressBox(f"{'Primary' if i == 0 else 'Secondary'} IPv6", a6))
        addr.addStretch(1)
        col.addLayout(addr)

        if entry is not None:
            st = entry.stats
            ls = st.latency
            summary = Card(f"{view.label} summary")
            summary.add(stat_grid([
                ("Average", fmt.ms(ls.mean if ls else None), ""),
                ("Median", fmt.ms(ls.median if ls else None), "typical lookup"),
                ("Best", fmt.ms(ls.min if ls else None), ""),
                ("Worst", fmt.ms(ls.max if ls else None), ""),
                ("Reliability", fmt.pct(st.success_rate), f"{st.ok} of {st.total} answered"),
                ("Tests", str(st.total), ""),
                ("Failures", str(st.failures), f"{st.timeouts} timed out, {st.errors} errors"),
                ("Score", f"{entry.score.total:.0f}/100" if entry.eligible else "—",
                 "" if entry.eligible else entry.reason or ""),
                ("Cached lookups", fmt.ms(st.cached.median if st.cached else None), "median, popular sites"),
                ("Uncached lookups", fmt.ms(st.uncached.median if st.uncached else None), "median, never-seen names"),
                ("90th percentile", fmt.ms(ls.p90 if ls else None), "9 in 10 lookups were faster"),
                ("Std deviation", fmt.ms(ls.stdev if ls else None), f"{ls.spikes if ls else 0} slow spikes"),
            ]))
            sub = (f"Speed {entry.score.latency:.0f} · Reliability {entry.score.reliability:.0f} · "
                   f"Consistency {entry.score.consistency:.0f} (each out of 100)")
            summary.add(label(sub, "muted"))
            col.addWidget(summary)

        # per-server table, all views
        servers = Card("Each server")
        tbl = QTableWidget()
        cols = ["Server", "Role", "IP", "Protocol", "Tests", "Success", "Avg", "Median", "Min", "Max"]
        tbl.setColumnCount(len(cols))
        tbl.setHorizontalHeaderLabels(cols)
        tbl.verticalHeader().setVisible(False)
        tbl.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        tbl.setShowGrid(False)
        tbl.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        targets = a.targets_for(provider_id)
        tbl.setRowCount(len(targets))
        for r, t in enumerate(targets):
            gs = a.target_stats.get(t.id)
            ls = gs.latency if gs else None
            skipped = a.run.skipped.get(t.id)
            vals = [t.address, t.role, t.family.label, "DoT" if t.protocol is Protocol.DOT else "UDP/TCP",
                    str(gs.total if gs else 0), fmt.pct(gs.success_rate if gs and gs.total else None),
                    fmt.ms(ls.mean if ls else None), fmt.ms(ls.median if ls else None),
                    fmt.ms(ls.min if ls else None), fmt.ms(ls.max if ls else None)]
            for c, v in enumerate(vals):
                it = QTableWidgetItem(v)
                if skipped:
                    it.setToolTip(skipped)
                if c >= 4:
                    it.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                tbl.setItem(r, c, it)
        hh = tbl.horizontalHeader()
        hh.setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        tbl.resizeRowsToContents()
        tbl.setFixedHeight(hh.height() + sum(tbl.rowHeight(i) for i in range(tbl.rowCount())) + 4)
        servers.add(tbl)
        if a.run.ipv6_status not in ("available", "disabled") and p and p.ipv6:
            servers.add(label("IPv6 servers were not tested because IPv6 isn't available on this connection.",
                              "muted", wrap=True))
        tcp = sum(a.target_stats[t.id].tcp_fallbacks for t in targets if t.id in a.target_stats)
        servers.add(label(f"Protocol: standard DNS over UDP port 53, retried over TCP for large answers "
                          f"({tcp} answer{'s' if tcp != 1 else ''} needed TCP) — the same way your router and "
                          f"Windows talk to DNS servers.", "muted", wrap=True))
        col.addWidget(servers)

        # response-time graph, one strip per server
        graph = Card("Response times during the test")
        chart = TimelineChart()
        series = []
        for t in targets:
            pts = []
            for s in a.run.samples:
                if s.target_id != t.id:
                    continue
                tip = (f"{t.address}<br>{s.domain} ({s.kind.value})<br>" +
                       (fmt.ms(s.latency_ms) if s.ok else "No answer: " + friendly_error(s.error_code, t.address, timeout)))
                pts.append(TimelinePoint(s.elapsed_s, s.latency_ms if s.ok else None, tip))
            gs = a.target_stats.get(t.id)
            proto = " DoT" if t.protocol is Protocol.DOT else ""
            series.append(TimelineSeries(f"{t.address}{proto}", pts,
                                         gs.latency.median if gs and gs.latency else None))
        chart.set_series(series)
        graph.add(chart)
        col.addWidget(graph)

        # problems in plain English + technical details
        failures = [s for t in targets for s in a.run.samples if s.target_id == t.id and not s.ok]
        if failures:
            prob = Card("Problems")
            codes = Counter(s.error_code or "other" for s in failures)
            for code, n in codes.most_common():
                prob.add(label(f"• {n}× — {friendly_error(code, p.display_name if p else provider_id, timeout)}",
                               "secondary", wrap=True))
            tech = QPlainTextEdit()
            tech.setReadOnly(True)
            tech.setPlainText("\n".join(
                f"{fmt.when(s.started_at)}  {next((t.address for t in targets if t.id == s.target_id), '')}  "
                f"{s.domain}  {s.outcome.value}  {s.rcode or ''}  {s.detail or ''}" for s in failures[:200]))
            tech.setFixedHeight(160)
            prob.add(Details("Technical details", tech))
            col.addWidget(prob)

        col.addStretch(1)
        btns = QHBoxLayout()
        if p and provider_id != "current":
            btns.addWidget(button("Copy DNS", "primary", lambda: app.copy_dns(p, a)))
            ab = button("Apply to Windows", None, lambda: (self.accept(), app.apply_to_windows(p, a)))
            ab.setEnabled(app.can_change_dns() and not p.is_current)
            btns.addWidget(ab)
        btns.addStretch(1)
        btns.addWidget(button("Close", None, self.accept))
        col.addLayout(btns)
