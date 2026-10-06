"""History of saved benchmark results, with a trend chart."""

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QHBoxLayout, QHeaderView, QMessageBox, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from ... import fmt
from ...engine import MODES
from ..charts import TrendChart, TrendPoint
from ..widgets import Card, button, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow


class HistoryPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        self.entries = []
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll, col = page_container()
        outer.addWidget(scroll)
        col.addWidget(label("History", "h1"))
        col.addWidget(label("Saved on this PC only. DNS performance changes over time, so it's worth re-testing now and "
                            "then.", "secondary", wrap=True))

        chart_card = Card("Best DNS over time")
        chart_card.add(label("Median lookup time of each test's recommended DNS, compared with the DNS you were using "
                             "at the time.", "muted", wrap=True))
        self.chart = TrendChart("Recommended DNS", "Your DNS at the time")
        chart_card.add(self.chart)
        col.addWidget(chart_card)

        table_card = Card()
        top = QHBoxLayout()
        top.addWidget(label("Saved results", "h2"), 1)
        self.open_btn = button("Open", "primary", self._open)
        self.del_btn = button("Delete", None, self._delete)
        top.addWidget(self.open_btn)
        top.addWidget(self.del_btn)
        top.addWidget(button("Export history (CSV)", None, self._export))
        top.addWidget(button("Clear all", None, self._clear))
        table_card.add(top)
        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels(["Date", "Test", "Winner", "Median", "Average", "Reliability", "Score"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setShowGrid(False)
        self.table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(lambda _i: self._open())
        self.table.itemSelectionChanged.connect(self._sel_changed)
        table_card.add(self.table)
        self.empty = label("No saved results yet. Results are saved automatically after each completed benchmark.",
                           "muted", wrap=True)
        table_card.add(self.empty)
        col.addWidget(table_card)
        col.addStretch(1)

    def reload(self) -> None:
        self.entries = self.app.history.list()
        t = self.table
        t.setRowCount(len(self.entries))
        right = Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        for r, e in enumerate(self.entries):
            mode = "Scheduled check" if e.mode == "scheduled" else MODES.get(e.mode, {}).get("label", e.mode)
            if e.demo:
                mode += " (demo)"
            vals = [fmt.when(e.started_at), mode, e.winner_name or "—", fmt.ms(e.median_ms), fmt.ms(e.avg_ms),
                    fmt.pct(e.success_rate), f"{e.score:.0f}" if e.score is not None else "—"]
            for c, v in enumerate(vals):
                it = QTableWidgetItem(v)
                it.setData(Qt.ItemDataRole.UserRole, e.run_id)
                if c >= 3:
                    it.setTextAlignment(right)
                t.setItem(r, c, it)
        t.resizeRowsToContents()
        rows_h = sum(t.rowHeight(i) for i in range(min(t.rowCount(), 12)))
        t.setFixedHeight(t.horizontalHeader().height() + rows_h + 6)
        self.empty.setVisible(not self.entries)
        self.table.setVisible(bool(self.entries))
        pts = []
        for e in sorted(self.entries, key=lambda e: e.started_at):
            if e.demo:
                continue
            tip = (f"<b>{fmt.when(e.started_at)}</b><br>Recommended: {e.winner_name or '—'} "
                   f"({fmt.ms(e.median_ms)})<br>Your DNS then: {e.current_name or '—'} ({fmt.ms(e.current_median_ms)})")
            pts.append(TrendPoint(fmt.when(e.started_at, with_time=False), e.median_ms, e.current_median_ms, tip))
        self.chart.set_points(pts)
        self._sel_changed()

    def _selected(self):
        rows = self.table.selectionModel().selectedRows() if self.table.selectionModel() else []
        if not rows:
            return None
        return self.table.item(rows[0].row(), 0).data(Qt.ItemDataRole.UserRole)

    def _sel_changed(self) -> None:
        has = self._selected() is not None
        self.open_btn.setEnabled(has)
        self.del_btn.setEnabled(has)

    def _open(self) -> None:
        rid = self._selected()
        if rid:
            self.app.open_history_run(rid)

    def _delete(self) -> None:
        rid = self._selected()
        if rid and QMessageBox.question(self, "Delete result", "Delete this saved result?") == \
                QMessageBox.StandardButton.Yes:
            self.app.history.delete(rid)
            self.reload()
            self.app.refresh_last()

    def _clear(self) -> None:
        if self.entries and QMessageBox.question(self, "Clear history", "Delete all saved results from this PC?") == \
                QMessageBox.StandardButton.Yes:
            self.app.history.clear()
            self.reload()
            self.app.refresh_last()

    def _export(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Export history", "dns-benchmark-history.csv", "CSV (*.csv)")
        if not path:
            return
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["Date", "Mode", "Demo", "Winner", "MedianMs", "AverageMs", "SuccessRate", "Score", "CurrentDNS",
                    "CurrentMedianMs"])
        for e in sorted(self.entries, key=lambda e: e.started_at):
            w.writerow([fmt.when(e.started_at), e.mode, "yes" if e.demo else "", e.winner_name or "",
                        fmt.num(e.median_ms), fmt.num(e.avg_ms),
                        "" if e.success_rate is None else f"{e.success_rate * 100:.1f}",
                        "" if e.score is None else f"{e.score:.0f}", e.current_name or "", fmt.num(e.current_median_ms)])
        try:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(buf.getvalue())
            self.app.toast(f"Saved {path}")
        except OSError as exc:
            QMessageBox.warning(self, "Export failed", f"Couldn't save the file: {exc}")
