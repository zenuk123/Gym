"""Results: the recommendation, the comparison table, graphs, export and router guidance."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QButtonGroup, QHBoxLayout, QHeaderView, QTableWidget,
                               QTableWidgetItem, QTabBar, QVBoxLayout, QWidget)

from ... import fmt
from ...diagnostics import Preflight
from ...engine import MODES
from ...errors import friendly_error
from ...models import Family
from ...results import VIEWS, Analysis
from ...scoring import Ranked
from ...stats import spike_threshold
from ..charts import BarChart, BarRow, DistributionChart, DistRow, TimelineChart, TimelinePoint, TimelineSeries
from ..widgets import AddressBox, Banner, Card, button, clear_layout, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow


class SortItem(QTableWidgetItem):
    """Table cell that sorts by a numeric key but shows formatted text."""

    def __init__(self, text: str, key: float | str) -> None:
        super().__init__(text)
        self.key = key

    def __lt__(self, other) -> bool:  # noqa: D105
        if isinstance(other, SortItem):
            return self.key < other.key
        return super().__lt__(other)


def entry_tooltip(e: Ranked) -> str:
    ls = e.stats.latency
    lines = [f"<b>{e.name}</b>"]
    if ls:
        lines += [f"Average: {fmt.ms(ls.mean)}", f"Median: {fmt.ms(ls.median)}",
                  f"Best / worst: {fmt.ms(ls.min)} / {fmt.ms(ls.max)}"]
    lines.append(f"Success: {fmt.pct(e.stats.success_rate)} of {e.stats.total} queries")
    lines.append(f"Score: {e.score.total:.0f}/100" if e.eligible else f"Not recommended: {e.reason}")
    return "<br>".join(lines)


class ResultsPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        self.analysis: Analysis | None = None
        self.view_id = "ipv4"
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll, self.col = page_container()
        outer.addWidget(scroll)
        self.content = QVBoxLayout()
        self.content.setSpacing(16)
        self.col.addLayout(self.content)
        self.col.addStretch(1)
        self._empty()

    def _empty(self) -> None:
        clear_layout(self.content)
        c = Card()
        c.add(label("No results yet", "h2"))
        c.add(label("Run a benchmark from the Dashboard to see which DNS is fastest on your connection.", "secondary",
                    wrap=True))
        c.add(button("Go to Dashboard", "primary", lambda: self.app.go("dashboard")), )
        self.content.addWidget(c)

    # ------------------------------------------------------------------ build
    def show_analysis(self, a: Analysis, saved: bool = True) -> None:
        self.analysis = a
        self.view_id = a.primary_view
        clear_layout(self.content)
        run = a.run
        head = QHBoxLayout()
        title = QVBoxLayout()
        title.addWidget(label("Results", "h1"))
        mode = MODES.get(run.mode, {}).get("label", "Scheduled check" if run.mode == "scheduled" else run.mode)
        title.addWidget(label(f"{fmt.when(run.started_at)} · {mode} · {len(run.samples)} DNS queries in "
                              f"{fmt.duration(run.duration_s)}", "secondary"))
        head.addLayout(title, 1)
        self.content.addLayout(head)

        for level, text in self._warnings(a, saved):
            self.content.addWidget(Banner(level, text))

        self.content.addWidget(self._winner_card(a))
        self.content.addWidget(self._table_card(a))
        self.content.addWidget(self._charts_card(a))
        self.content.addWidget(self._router_card(a))
        self.content.addWidget(self._export_card(a))

    def _warnings(self, a: Analysis, saved: bool) -> list[tuple[str, str]]:
        run = a.run
        out: list[tuple[str, str]] = []
        if run.demo:
            out.append(("warning", "<b>Demo mode:</b> these results are simulated to show how the app works. Run the "
                                   "app normally to measure your real connection."))
        if run.cancelled:
            out.append(("warning", "The benchmark was cancelled, so these are partial results"
                                   + (" and were not saved to history." if not saved else ".")))
        if run.network.get("vpn"):
            out.append(("warning", self.app.vpn_warning(run.network["vpn"])))
        pf = run.diagnostics.get("preflight")
        if pf:
            out += [(lvl, txt) for lvl, txt in Preflight.from_dict(pf).warnings() if lvl != "error"]
        return out

    # ------------------------------------------------------------------ winner
    def _winner_card(self, a: Analysis) -> Card:
        rec = a.recommendation
        card = Card(hero=rec is not None)
        if rec is None:
            card.add(label("No DNS server could be recommended", "h2"))
            card.add(label("None of the tested servers answered reliably. Check your internet connection, firewall or "
                           "VPN, then test again. Details for each server are in the table below.", "secondary", wrap=True))
            card.add(button("Test again", "primary", lambda: self.app.start_benchmark(a.run.mode
                                                                                        if a.run.mode in MODES else "quick")))
            return card
        w = rec.winner
        p = a.run.provider(w.provider_id)
        card.add(label("🏆  BEST DNS FOR YOUR CONNECTION", "eyebrow"))
        name_row = QHBoxLayout()
        name_row.addWidget(label(p.name if p else w.name, "hero"))
        if w.is_current:
            name_row.addWidget(label("You're already using this", "tagAccent"), 0, Qt.AlignmentFlag.AlignVCenter)
        for f in (p.features if p else [])[:3]:
            name_row.addWidget(label(f.replace("-", " "), "tag"), 0, Qt.AlignmentFlag.AlignVCenter)
        name_row.addStretch(1)
        card.add(name_row)
        ls = w.stats.latency
        metrics = QHBoxLayout()
        metrics.setSpacing(36)
        for t, v in (("Median", fmt.ms(ls.median if ls else None)), ("Average", fmt.ms(ls.mean if ls else None)),
                     ("Reliability", fmt.pct(w.stats.success_rate)), ("Score", f"{w.score.total:.0f}/100")):
            box = QVBoxLayout()
            box.setSpacing(0)
            box.addWidget(label(t, "muted"))
            box.addWidget(label(v, "big"))
            metrics.addLayout(box)
        metrics.addStretch(1)
        card.add(metrics)
        card.add(label(rec.headline, wrap=True))
        for d in rec.details:
            card.add(label(d, "secondary", wrap=True))
        if rec.vs_current:
            card.add(label(rec.vs_current, "good" if not rec.switching_optional and not w.is_current else "secondary",
                           wrap=True))

        fam = Family.V4 if a.primary_view == "ipv4" else Family.V6
        addrs = p.addresses(fam) if p else []
        boxes = QHBoxLayout()
        boxes.setSpacing(12)
        roles = ["Primary", "Secondary"]
        for i, addr in enumerate(addrs[:2]):
            boxes.addWidget(AddressBox(f"{roles[i]} {'IPv4' if fam is Family.V4 else 'IPv6'}", addr))
        if p and fam is Family.V4 and a.run.ipv6_status == "available" and p.ipv6:
            for i, addr in enumerate(p.ipv6[:2]):
                boxes.addWidget(AddressBox(f"{roles[i]} IPv6", addr))
        boxes.addStretch(1)
        card.add(boxes)
        if w.provider_id == "current":
            card.add(label("Your current DNS came out on top, so there's nothing to change. 🎉", "secondary", wrap=True))
        else:
            card.add(label("These are the fastest DNS servers measured from your current connection.", "secondary",
                           wrap=True))
        btns = QHBoxLayout()
        btns.setSpacing(10)
        btns.addWidget(button("Copy DNS", "primary", lambda: self.app.copy_dns(p, a)))
        apply_btn = button("Apply to Windows", None, lambda: self.app.apply_to_windows(p, a))
        if w.provider_id == "current" or w.is_current:
            apply_btn.setEnabled(False)
            apply_btn.setToolTip("This is already the DNS this PC uses.")
        elif not self.app.can_change_dns():
            apply_btn.setEnabled(False)
            apply_btn.setToolTip("Changing DNS settings is only available on Windows.")
        btns.addWidget(apply_btn)
        btns.addWidget(button("Test again", None, lambda: self.app.start_benchmark(a.run.mode
                                                                                    if a.run.mode in MODES else "quick")))
        btns.addWidget(button("View details", None, lambda: self.app.open_details(a, w.provider_id)))
        btns.addStretch(1)
        card.add(btns)
        hint = QHBoxLayout()
        hint.addWidget(label("To use these permanently on your entire home network, enter these addresses in your "
                             "router's Internet/WAN/DNS settings.", "muted", wrap=True), 1)
        hint.addWidget(button("Router setup guide", "link", lambda: self.app.go("help", "router")))
        card.add(hint)
        return card

    # ------------------------------------------------------------------ table
    def _table_card(self, a: Analysis) -> Card:
        card = Card()
        top = QHBoxLayout()
        top.addWidget(label("All providers", "h2"), 1)
        views = [v for v in VIEWS if v.id in a.views]
        group = QButtonGroup(card)
        if len(views) > 1:
            for v in views:
                b = button(v.label, "segment")
                b.setCheckable(True)
                b.setChecked(v.id == self.view_id)
                b.clicked.connect(lambda _=False, vid=v.id: self._switch_view(vid))
                group.addButton(b)
                top.addWidget(b)
        card.add(top)
        self._btn_group = group
        if a.run.ipv6_status != "available" and a.run.ipv6_status != "disabled":
            card.add(label("IPv6 testing unavailable on this connection — IPv6 servers were skipped, not failed.",
                           "muted", wrap=True))
        self.table = QTableWidget()
        self.table.setColumnCount(8)
        self.table.setHorizontalHeaderLabels(["#", "DNS provider", "Avg", "Median", "Best", "Worst", "Success",
                                              "Score"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setShowGrid(False)
        self.table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        hh = self.table.horizontalHeader()
        for c in range(8):
            align = Qt.AlignmentFlag.AlignLeft if c == 1 else Qt.AlignmentFlag.AlignRight
            self.table.horizontalHeaderItem(c).setTextAlignment(align | Qt.AlignmentFlag.AlignVCenter)
        hh.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        for c in (0, 2, 3, 4, 5, 6, 7):
            hh.setSectionResizeMode(c, QHeaderView.ResizeMode.ResizeToContents)
        self.table.cellClicked.connect(self._row_clicked)
        self.table.setCursor(Qt.CursorShape.PointingHandCursor)
        card.add(self.table)
        card.add(label("Click a provider for full details. Score combines speed (50%), reliability (30%) and "
                       "consistency (20%).", "muted", wrap=True))
        self._fill_table()
        return card

    def _switch_view(self, vid: str) -> None:
        self.view_id = vid
        self._fill_table()
        self._fill_charts()

    def _fill_table(self) -> None:
        a = self.analysis
        entries = a.ranking(self.view_id)
        rec = a.recommendations.get(self.view_id)
        t = self.table
        t.setSortingEnabled(False)
        t.setRowCount(len(entries))
        right = Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        for r, e in enumerate(entries):
            ls = e.stats.latency
            name = e.name
            if rec and e is rec.winner:
                name = "🏆 " + name
            if e.is_current:
                name += "   (current)" if e.provider_id != "current" else ""
            cells = [
                SortItem(str(e.rank), e.rank),
                SortItem(name, e.name.lower()),
                SortItem(fmt.ms(ls.mean if ls else None), ls.mean if ls else 1e9),
                SortItem(fmt.ms(ls.median if ls else None), ls.median if ls else 1e9),
                SortItem(fmt.ms(ls.min if ls else None), ls.min if ls else 1e9),
                SortItem(fmt.ms(ls.max if ls else None), ls.max if ls else 1e9),
                SortItem(fmt.pct(e.stats.success_rate), -e.stats.success_rate),
                SortItem(f"{e.score.total:.0f}" if e.eligible else "—", -e.score.total if e.eligible else 1),
            ]
            tip = entry_tooltip(e)
            if not e.eligible and e.stats.main_error:
                tip += "<br><br>" + friendly_error(e.stats.main_error, e.name, float(a.run.config.get("timeout_s", 2)))
            for c, item in enumerate(cells):
                item.setData(Qt.ItemDataRole.UserRole, e.provider_id)
                item.setToolTip(tip)
                if c != 1:
                    item.setTextAlignment(right)
                if rec and e is rec.winner:
                    f = item.font()
                    f.setBold(True)
                    item.setFont(f)
                t.setItem(r, c, item)
        t.setSortingEnabled(True)
        t.resizeRowsToContents()
        h = t.horizontalHeader().height() + sum(t.rowHeight(i) for i in range(t.rowCount())) + 4
        t.setFixedHeight(h)

    def _row_clicked(self, row: int, _col: int) -> None:
        item = self.table.item(row, 0)
        if item is not None and self.analysis is not None:
            self.app.open_details(self.analysis, item.data(Qt.ItemDataRole.UserRole), self.view_id)

    # ------------------------------------------------------------------ charts
    def _charts_card(self, a: Analysis) -> Card:
        card = Card("Graphs")
        self.tabs = QTabBar()
        self.tabs.setDrawBase(False)
        self.tabs.setExpanding(False)
        card.add(self.tabs)
        self.bar_chart = BarChart()
        self.dist_chart = DistributionChart()
        self.time_chart = TimelineChart()
        self.chart_pages: list[QWidget] = []
        for chart, title, note in (
            (self.bar_chart, "Average latency", "Average DNS response time per provider (all successful lookups, "
                                                "cached and uncached). Shorter is faster; the recommended provider "
                                                "is highlighted."),
            (self.dist_chart, "Consistency", "How spread out each provider's response times were. Bar = middle 50% of "
                                             "lookups, line = 10th–90th percentile, | = median, dots = slow spikes. "
                                             "Narrow and spike-free means dependable."),
            (self.time_chart, "Timeline", "Every response over the course of the test, one row per provider on the "
                                          "same (log) scale. Sudden peaks show a server that occasionally becomes very "
                                          "slow; ✕ marks a lookup that got no answer."),
        ):
            page = QWidget()
            v = QVBoxLayout(page)
            v.setContentsMargins(0, 6, 0, 0)
            v.addWidget(label(note, "muted", wrap=True))
            v.addWidget(chart)
            self.tabs.addTab(title)
            self.chart_pages.append(page)
            card.add(page)
        self.tabs.currentChanged.connect(self._show_chart)
        self._show_chart(0)
        self._fill_charts()
        return card

    def _show_chart(self, index: int) -> None:
        for i, page in enumerate(self.chart_pages):
            page.setVisible(i == index)

    def _fill_charts(self) -> None:
        a = self.analysis
        view = next(v for v in VIEWS if v.id == self.view_id)
        entries = a.ranking(self.view_id)
        rec = a.recommendations.get(self.view_id)
        win = rec.winner.provider_id if rec else None
        bars = []
        for e in sorted(entries, key=lambda e: (e.stats.latency is None, e.stats.latency.mean if e.stats.latency else 0)):
            bars.append(BarRow(e.name, e.stats.latency.mean if e.stats.latency else None, e.provider_id == win,
                               entry_tooltip(e), note=e.reason or "no answers"))
        self.bar_chart.set_rows(bars)
        dist = []
        for e in sorted(entries, key=lambda e: (e.stats.latency is None, e.stats.latency.median if e.stats.latency else 0)):
            ls = e.stats.latency
            if ls:
                samples = a.samples_for(e.provider_id, view.family, view.protocol)
                thr = spike_threshold(ls.median)
                spikes = [s.latency_ms for s in samples if s.ok and s.latency_ms and s.latency_ms > thr]
                tip = (f"<b>{e.name}</b><br>10th–90th percentile: {fmt.ms(ls.p10)} – {fmt.ms(ls.p90)}<br>"
                       f"Middle 50%: {fmt.ms(ls.p25)} – {fmt.ms(ls.p75)}<br>Median: {fmt.ms(ls.median)}<br>"
                       f"Slow spikes: {ls.spikes}<br>Failed: {e.stats.failures}")
                dist.append(DistRow(e.name, ls.p10, ls.p25, ls.median, ls.p75, ls.p90, spikes, e.stats.failures,
                                    e.provider_id == win, tip))
            else:
                dist.append(DistRow(e.name, failures=e.stats.failures, tooltip=entry_tooltip(e)))
        self.dist_chart.set_rows(dist)
        series = []
        for e in entries:
            pts = []
            for s in a.samples_for(e.provider_id, view.family, view.protocol):
                t = a.run.target(s.target_id)
                where = t.address if t else ""
                if s.ok and s.latency_ms is not None:
                    tip = (f"<b>{e.name}</b> · {where}<br>{s.domain} ({s.kind.value})<br>{fmt.ms(s.latency_ms)} "
                           f"at {s.elapsed_s:.1f}s")
                else:
                    tip = (f"<b>{e.name}</b> · {where}<br>{s.domain}<br>No answer: "
                           f"{friendly_error(s.error_code, e.name, float(a.run.config.get('timeout_s', 2)))}")
                pts.append(TimelinePoint(s.elapsed_s, s.latency_ms if s.ok else None, tip))
            series.append(TimelineSeries(e.name, pts, e.stats.latency.median if e.stats.latency else None,
                                         e.provider_id == win))
        self.time_chart.set_series(series)

    # ------------------------------------------------------------------ router + windows
    def _router_card(self, a: Analysis) -> Card:
        card = Card("Use it on your router or this PC")
        row = QHBoxLayout()
        row.setSpacing(16)
        for title, text in (
            ("Router (recommended)", "Usually affects every device on your home network — phones, consoles, TVs. "
                                     "Enter the primary and secondary addresses in your router's Internet / WAN / DNS "
                                     "settings. This app never changes your router."),
            ("Windows (this PC only)", "“Apply to Windows” changes DNS for this computer only, after asking for "
                                       "administrator permission. Your previous settings are saved first and can be "
                                       "restored at any time."),
        ):
            box = QVBoxLayout()
            box.addWidget(label(title, "h3"))
            box.addWidget(label(text, "secondary", wrap=True))
            box.addStretch(1)
            row.addLayout(box, 1)
        card.add(row)
        btns = QHBoxLayout()
        btns.addWidget(button("Step-by-step router guide", None, lambda: self.app.go("help", "router")))
        if self.app.has_dns_backup():
            btns.addWidget(button("Restore previous DNS", None, self.app.restore_dns))
        btns.addStretch(1)
        card.add(btns)
        return card

    def _export_card(self, a: Analysis) -> Card:
        card = Card()
        row = QHBoxLayout()
        row.addWidget(label("Export these results", "h3"))
        row.addStretch(1)
        for fmt_name in ("CSV", "JSON", "TXT"):
            row.addWidget(button(fmt_name, None, lambda _=False, f=fmt_name.lower(): self.app.export(a, f)))
        row.addWidget(button("Raw samples (CSV)", None, lambda: self.app.export(a, "samples")))
        card.add(row)
        card.add(label("Exports are saved only where you choose. Nothing is uploaded.", "muted"))
        return card
