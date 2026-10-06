"""Benchmark screen: live progress while the test runs."""

from __future__ import annotations

import statistics
from typing import TYPE_CHECKING

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QHBoxLayout, QProgressBar, QVBoxLayout, QWidget

from ... import fmt
from ...diagnostics import Preflight
from ...engine import MODES, Progress
from ...models import Family, Protocol
from ..charts import BarChart, BarRow
from ..widgets import Banner, Card, button, clear_layout, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow


class BenchmarkPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll, col = page_container()
        outer.addWidget(scroll)

        self.title = label("Testing DNS servers…", "h1")
        col.addWidget(self.title)
        self.subtitle = label("", "secondary", wrap=True)
        col.addWidget(self.subtitle)

        card = Card()
        top = QHBoxLayout()
        self.phase = label("Checking your connection…", "h3")
        top.addWidget(self.phase, 1)
        self.cancel_btn = button("Cancel", None, self._cancel)
        top.addWidget(self.cancel_btn)
        card.add(top)
        self.bar = QProgressBar()
        self.bar.setRange(0, 1000)
        self.bar.setFixedHeight(10)
        card.add(self.bar)
        stats = QHBoxLayout()
        self.done_lbl = label("", "secondary")
        self.eta_lbl = label("", "secondary")
        self.current_lbl = label("", "muted")
        stats.addWidget(self.done_lbl)
        stats.addSpacing(20)
        stats.addWidget(self.eta_lbl)
        stats.addStretch(1)
        stats.addWidget(self.current_lbl)
        card.add(stats)
        col.addWidget(card)

        self.notes = QVBoxLayout()
        self.notes.setSpacing(8)
        col.addLayout(self.notes)

        live = Card("Median response time so far")
        live.add(label("Typical (median) DNS lookup time for each provider's IPv4 servers, updated as results come "
                       "in. Shorter is faster.", "muted", wrap=True))
        self.chart = BarChart()
        self.chart.empty_text = "Waiting for the first answers…"
        live.add(self.chart)
        col.addWidget(live)
        col.addStretch(1)

        self._lat: dict[str, list[float]] = {}
        self._fail: dict[str, int] = {}
        self._dirty = False
        self._timer = QTimer(self)
        self._timer.setInterval(250)
        self._timer.timeout.connect(self._refresh_chart)

    # ------------------------------------------------------------------ lifecycle
    def begin(self, mode: str, demo: bool) -> None:
        self.title.setText("Testing DNS servers…")
        spec = MODES.get(mode, MODES["quick"])
        sub = f"{spec['label']} — {spec['blurb']}"
        if mode == "gaming":
            sub += " DNS only affects how fast games and launchers *find* their servers — not your in-game ping."
        if demo:
            sub = "DEMO MODE — results are simulated. " + sub
        self.subtitle.setText(sub)
        self.phase.setText("Checking your connection…")
        self.bar.setValue(0)
        self.bar.setRange(0, 0)  # busy indicator during pre-flight
        self.done_lbl.setText("")
        self.eta_lbl.setText("")
        self.current_lbl.setText("")
        self.cancel_btn.setEnabled(True)
        self.cancel_btn.setText("Cancel")
        clear_layout(self.notes)
        self._lat.clear()
        self._fail.clear()
        self.chart.set_rows([])
        self._timer.start()

    def end(self) -> None:
        self._timer.stop()

    def _cancel(self) -> None:
        self.cancel_btn.setEnabled(False)
        self.cancel_btn.setText("Cancelling…")
        self.phase.setText("Stopping — finishing the queries already in flight…")
        self.app.cancel_benchmark()

    # ------------------------------------------------------------------ worker callbacks
    def on_preflight(self, pf: Preflight) -> None:
        clear_layout(self.notes)
        for level, text in pf.warnings():
            self.notes.addWidget(Banner(level, text))
        if self.app.network and self.app.network.vpn:
            self.notes.addWidget(Banner("warning", self.app.vpn_warning()))

    def on_progress(self, p: Progress) -> None:
        if p.phase == "warmup":
            self.phase.setText("Warming up — saying hello to every server once (not measured)…")
            return
        if p.phase == "done":
            self.phase.setText("Analysing results…")
            self.bar.setRange(0, 1000)
            self.bar.setValue(1000)
            return
        if self.bar.maximum() == 0:
            self.bar.setRange(0, 1000)
        self.bar.setValue(int(1000 * p.completed / max(1, p.total)))
        self.phase.setText(f"Round {p.round} of {p.rounds}")
        self.done_lbl.setText(f"{p.completed} of {p.total} tests")
        self.eta_lbl.setText(f"about {fmt.duration(p.eta_s)} left")
        if p.current is not None:
            name = self.app.provider_name(p.current.provider_id)
            proto = " (DoT)" if p.current.protocol is Protocol.DOT else ""
            self.current_lbl.setText(f"Testing {name}{proto} · {p.current.address}")
        s = p.sample
        if s is not None and p.current is not None and p.current.family is Family.V4 \
                and p.current.protocol is Protocol.UDP:
            pid = p.current.provider_id
            if s.ok and s.latency_ms is not None:
                self._lat.setdefault(pid, []).append(s.latency_ms)
            else:
                self._fail[pid] = self._fail.get(pid, 0) + 1
            self._dirty = True

    def _refresh_chart(self) -> None:
        if not self._dirty:
            return
        self._dirty = False
        rows = []
        for pid in set(self._lat) | set(self._fail):
            vals = self._lat.get(pid, [])
            med = statistics.median(vals) if vals else None
            fails = self._fail.get(pid, 0)
            n = len(vals) + fails
            rows.append(BarRow(self.app.provider_name(pid), med, tooltip=(
                f"<b>{self.app.provider_name(pid)}</b><br>Median so far: {fmt.ms(med)}<br>"
                f"{len(vals)} of {n} answered"), note=f"no answers yet ({fails} failed)"))
        rows.sort(key=lambda r: (r.value is None, r.value or 0))
        if rows and rows[0].value is not None:
            rows[0].highlight = True
        self.chart.set_rows(rows)
