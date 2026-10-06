"""Custom-painted charts (QPainter). Data-viz rules: one hue per series, 2px lines, hairline solid grids,
selective labels, hover tooltips, and a table view elsewhere on the page for every chart."""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QFont, QFontMetricsF, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QSizePolicy, QToolTip, QWidget

from .theme import qc, tokens, ui_font


def nice_step(span: float, target_ticks: int = 5) -> float:
    if span <= 0:
        return 1.0
    raw = span / target_ticks
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


def linear_ticks(vmax: float) -> tuple[float, list[float]]:
    step = nice_step(vmax)
    top = math.ceil(vmax / step) * step if vmax > 0 else step
    return top, [i * step for i in range(int(round(top / step)) + 1)]


LOG_STEPS = (1, 2, 5)


def log_bounds(lo: float, hi: float) -> tuple[float, float, list[float]]:
    lo, hi = max(lo, 0.1), max(hi, lo * 1.5, 0.2)
    candidates = [m * 10 ** e for e in range(-1, 5) for m in LOG_STEPS]
    lo_b = max([c for c in candidates if c <= lo] or [candidates[0]])
    hi_b = min([c for c in candidates if c >= hi] or [candidates[-1]])
    ticks = [c for c in candidates if lo_b <= c <= hi_b]
    return lo_b, hi_b, ticks


def fmt_seconds(v: float) -> str:
    if v >= 60:
        return f"{int(v // 60)}:{int(v % 60):02d}"
    return f"{v:g}s"


def fmt_tick(v: float) -> str:
    return f"{v:g}" if v < 1000 else f"{v / 1000:g}k"


class ChartBase(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMouseTracking(True)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self._hits: list[tuple[QRectF, str]] = []
        self.font_small = ui_font(8.5)
        self.font_label = ui_font(9.5)
        self.font_value = ui_font(9, QFont.Weight.DemiBold)
        self.empty_text = "No data yet"

    # hover -------------------------------------------------------------
    def hit_test(self, pos: QPointF) -> str | None:
        for rect, html in self._hits:
            if rect.contains(pos):
                return html
        return None

    def mouseMoveEvent(self, e) -> None:  # noqa: N802
        html = self.hit_test(e.position())
        if html:
            QToolTip.showText(e.globalPosition().toPoint(), html, self)
        else:
            QToolTip.hideText()

    def leaveEvent(self, e) -> None:  # noqa: N802
        QToolTip.hideText()

    # painting helpers -----------------------------------------------------
    def painter(self) -> QPainter:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setRenderHint(QPainter.RenderHint.TextAntialiasing)
        return p

    def hairline(self, p: QPainter, color: str, x1: float, y1: float, x2: float, y2: float, w: float = 1.0) -> None:
        p.setPen(QPen(qc(color), w))
        p.drawLine(QPointF(x1, y1), QPointF(x2, y2))

    def text(self, p: QPainter, rect: QRectF, s: str, color: str, font: QFont | None = None,
             align=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter) -> None:
        p.setFont(font or self.font_label)
        p.setPen(qc(color))
        p.drawText(rect, int(align), s)

    def draw_empty(self, p: QPainter) -> None:
        self.text(p, QRectF(self.rect()), self.empty_text, tokens().muted, align=Qt.AlignmentFlag.AlignCenter)

    def label_width(self, names: list[str], cap: float = 190) -> float:
        fm = QFontMetricsF(self.font_label)
        return min(cap, max([fm.horizontalAdvance(n) for n in names] or [60]) + 18)


def bar_path(x0: float, y: float, x1: float, h: float, r: float = 4.0) -> QPainterPath:
    """Bar from baseline x0 to x1: square at the baseline, 4px rounded data end."""
    path = QPainterPath()
    w = max(0.0, x1 - x0)
    r = min(r, w, h / 2)
    path.moveTo(x0, y)
    path.lineTo(x0 + w - r, y)
    path.quadTo(x0 + w, y, x0 + w, y + r)
    path.lineTo(x0 + w, y + h - r)
    path.quadTo(x0 + w, y + h, x0 + w - r, y + h)
    path.lineTo(x0, y + h)
    path.closeSubpath()
    return path


# ------------------------------------------------------------------ horizontal bar chart

@dataclass
class BarRow:
    name: str
    value: float | None
    highlight: bool = False
    tooltip: str = ""
    note: str = ""        # shown instead of a value when value is None


class BarChart(ChartBase):
    ROW = 32
    BAR = 14

    def __init__(self, unit: str = "ms", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.unit = unit
        self.rows: list[BarRow] = []
        self.setFixedHeight(80)

    def set_rows(self, rows: list[BarRow]) -> None:
        self.rows = rows
        self.setFixedHeight(max(80, len(rows) * self.ROW + 40))
        self.update()

    def paintEvent(self, _e) -> None:  # noqa: N802
        t = tokens()
        p = self.painter()
        self._hits = []
        if not self.rows:
            self.draw_empty(p)
            return
        left = self.label_width([r.name for r in self.rows])
        right = 78.0
        x0, x1 = left, self.width() - right
        top, bottom = 6.0, self.height() - 28.0
        vmax = max([r.value for r in self.rows if r.value is not None] or [1.0])
        vtop, ticks = linear_ticks(vmax * 1.04)

        def sx(v: float) -> float:
            return x0 + (x1 - x0) * v / vtop

        for tv in ticks:
            x = sx(tv)
            self.hairline(p, t.grid, x, top, x, bottom)
            self.text(p, QRectF(x - 30, bottom + 4, 60, 18), fmt_tick(tv), t.muted, self.font_small,
                      Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
        self.text(p, QRectF(x1 + 26, bottom + 4, right, 18), self.unit, t.muted, self.font_small,
                  Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        for i, r in enumerate(self.rows):
            y = top + i * self.ROW
            row_rect = QRectF(0, y, self.width(), self.ROW)
            self.text(p, QRectF(0, y, left - 12, self.ROW), r.name, t.text if r.highlight else t.text_2,
                      self.font_value if r.highlight else self.font_label,
                      Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            by = y + (self.ROW - self.BAR) / 2
            if r.value is None:
                self.text(p, QRectF(x0 + 6, y, x1 - x0, self.ROW), r.note or "no answers", t.muted, self.font_small)
            else:
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(qc(t.series_1 if r.highlight else t.series_soft))
                xe = max(sx(r.value), x0 + 2)
                p.drawPath(bar_path(x0, by, xe, self.BAR))
                self.text(p, QRectF(xe + 6, y, right + 40, self.ROW), f"{r.value:.1f} {self.unit}",
                          t.text if r.highlight else t.text_2, self.font_value)
            if r.tooltip:
                self._hits.append((row_rect, r.tooltip))
        self.hairline(p, t.baseline, x0, top - 2, x0, bottom)
        p.end()


# ------------------------------------------------------------------ distribution (box plot, log scale)

@dataclass
class DistRow:
    name: str
    p10: float | None = None
    p25: float | None = None
    median: float | None = None
    p75: float | None = None
    p90: float | None = None
    outliers: list[float] = field(default_factory=list)
    failures: int = 0
    highlight: bool = False
    tooltip: str = ""


class DistributionChart(ChartBase):
    ROW = 34

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.rows: list[DistRow] = []
        self.setFixedHeight(80)

    def set_rows(self, rows: list[DistRow]) -> None:
        self.rows = rows
        self.setFixedHeight(max(80, len(rows) * self.ROW + 42))
        self.update()

    def paintEvent(self, _e) -> None:  # noqa: N802
        t = tokens()
        p = self.painter()
        self._hits = []
        rows = [r for r in self.rows]
        vals = [v for r in rows for v in [r.p10, r.p90, *r.outliers] if v is not None]
        if not vals:
            self.draw_empty(p)
            return
        lo, hi, ticks = log_bounds(min(vals), max(vals))
        left = self.label_width([r.name for r in rows])
        right = 96.0
        x0, x1 = left, self.width() - right
        top, bottom = 6.0, self.height() - 30.0

        def sx(v: float) -> float:
            v = min(max(v, lo), hi)
            return x0 + (x1 - x0) * (math.log(v) - math.log(lo)) / (math.log(hi) - math.log(lo))

        for tv in ticks:
            x = sx(tv)
            self.hairline(p, t.grid, x, top, x, bottom)
            self.text(p, QRectF(x - 30, bottom + 4, 60, 18), fmt_tick(tv), t.muted, self.font_small,
                      Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
        self.text(p, QRectF(x1 + 30, bottom + 4, right, 18), "ms, log", t.muted, self.font_small,
                  Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        for i, r in enumerate(rows):
            y = top + i * self.ROW
            cy = y + self.ROW / 2
            self.text(p, QRectF(0, y, left - 12, self.ROW), r.name, t.text if r.highlight else t.text_2,
                      self.font_value if r.highlight else self.font_label,
                      Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            color = t.series_1
            if r.median is not None:
                # whisker 10th–90th percentile
                p.setPen(QPen(qc(color), 2, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
                p.drawLine(QPointF(sx(r.p10), cy), QPointF(sx(r.p90), cy))
                # box 25th–75th
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(qc(color, 0.35 if not t.dark else 0.45))
                bx0, bx1 = sx(r.p25), max(sx(r.p75), sx(r.p25) + 2)
                p.drawRoundedRect(QRectF(bx0, cy - 7, bx1 - bx0, 14), 3, 3)
                # median tick
                p.setPen(QPen(qc(t.text), 2.5, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
                mx = sx(r.median)
                p.drawLine(QPointF(mx, cy - 9), QPointF(mx, cy + 9))
                # slow spikes: dots with a surface ring
                for v in r.outliers:
                    p.setPen(QPen(qc(t.surface), 2))
                    p.setBrush(qc(color))
                    p.drawEllipse(QPointF(sx(v), cy), 4.5, 4.5)
            if r.failures:
                self.text(p, QRectF(x1 + 8, y, right, self.ROW), f"✕ {r.failures} failed", t.critical, self.font_small)
            elif r.median is not None:
                self.text(p, QRectF(x1 + 8, y, right, self.ROW), f"{r.median:.1f} ms", t.text_2, self.font_small)
            if r.median is None and not r.failures:
                self.text(p, QRectF(x0 + 6, y, x1 - x0, self.ROW), "no data", t.muted, self.font_small)
            if r.tooltip:
                self._hits.append((QRectF(0, y, self.width(), self.ROW), r.tooltip))
        p.end()


# ------------------------------------------------------------------ timeline (small multiples)

@dataclass
class TimelinePoint:
    t: float
    ms: float | None   # None = failed / timed out
    tooltip: str = ""


@dataclass
class TimelineSeries:
    name: str
    points: list[TimelinePoint]
    median: float | None = None
    highlight: bool = False


class TimelineChart(ChartBase):
    STRIP = 56

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.series: list[TimelineSeries] = []
        self._pts: list[tuple[float, float, str]] = []  # x, y, tooltip for hover
        self.setFixedHeight(80)

    def set_series(self, series: list[TimelineSeries]) -> None:
        self.series = series
        self.setFixedHeight(max(80, len(series) * self.STRIP + 44))
        self.update()

    def hit_test(self, pos: QPointF) -> str | None:
        best, best_d = None, 9.0
        for x, y, tip in self._pts:
            d = math.hypot(x - pos.x(), y - pos.y())
            if d < best_d:
                best, best_d = tip, d
        return best

    def paintEvent(self, _e) -> None:  # noqa: N802
        t = tokens()
        p = self.painter()
        self._pts = []
        ok = [pt.ms for s in self.series for pt in s.points if pt.ms is not None]
        if not ok:
            self.draw_empty(p)
            return
        lo, hi, _ = log_bounds(min(ok), max(ok))
        tmax = max([pt.t for s in self.series for pt in s.points] or [1.0]) or 1.0
        left = self.label_width([s.name for s in self.series])
        right = 104.0
        x0, x1 = left, self.width() - right
        top = 4.0
        bottom = top + len(self.series) * self.STRIP

        def sx(v: float) -> float:
            return x0 + (x1 - x0) * v / tmax

        step = nice_step(tmax, 6)
        tv = 0.0
        while tv <= tmax + 1e-9:
            x = sx(tv)
            self.hairline(p, t.grid, x, top, x, bottom)
            self.text(p, QRectF(x - 30, bottom + 4, 60, 18), fmt_seconds(tv), t.muted, self.font_small,
                      Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
            tv += step
        self.text(p, QRectF(x1 + 30, bottom + 4, right, 18), "into test", t.muted, self.font_small,
                  Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)

        for i, s in enumerate(self.series):
            y0 = top + i * self.STRIP
            pad = 7.0
            plot_top, plot_bot = y0 + pad + 6, y0 + self.STRIP - pad

            def sy(v: float) -> float:
                v = min(max(v, lo), hi)
                return plot_bot - (plot_bot - plot_top) * (math.log(v) - math.log(lo)) / (math.log(hi) - math.log(lo))

            self.hairline(p, t.grid, x0, plot_bot + pad / 2, x1, plot_bot + pad / 2)
            self.text(p, QRectF(0, y0, left - 12, self.STRIP), s.name, t.text if s.highlight else t.text_2,
                      self.font_value if s.highlight else self.font_label,
                      Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            pts = sorted(s.points, key=lambda q: q.t)
            path = QPainterPath()
            started = False
            for pt in pts:
                if pt.ms is None:
                    continue
                x, y = sx(pt.t), sy(pt.ms)
                if not started:
                    path.moveTo(x, y)
                    started = True
                else:
                    path.lineTo(x, y)
                self._pts.append((x, y, pt.tooltip))
            p.setPen(QPen(qc(t.series_1), 2, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawPath(path)
            for pt in pts:  # failures: ✕ along the top of the strip (status colour + glyph, never colour alone)
                if pt.ms is None:
                    x, y = sx(pt.t), plot_top - 3
                    p.setPen(QPen(qc(t.critical), 2, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
                    p.drawLine(QPointF(x - 3.5, y - 3.5), QPointF(x + 3.5, y + 3.5))
                    p.drawLine(QPointF(x + 3.5, y - 3.5), QPointF(x - 3.5, y + 3.5))
                    self._pts.append((x, y, pt.tooltip))
            if s.median is not None:
                self.text(p, QRectF(x1 + 8, y0, right, self.STRIP), f"{s.median:.1f} ms median", t.text_2,
                          self.font_small)
        p.end()


# ------------------------------------------------------------------ history trend (two series)

@dataclass
class TrendPoint:
    label: str
    a: float | None   # series A (recommended DNS)
    b: float | None   # series B (your current DNS)
    tooltip: str = ""


class TrendChart(ChartBase):
    def __init__(self, a_name: str, b_name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.a_name, self.b_name = a_name, b_name
        self.points: list[TrendPoint] = []
        self._xs: list[float] = []
        self._hover: int | None = None
        self.setFixedHeight(240)
        self.empty_text = "Run a few benchmarks to see how your best DNS changes over time."

    def set_points(self, pts: list[TrendPoint]) -> None:
        self.points = pts
        self.update()

    def sizeHint(self) -> QSize:  # noqa: N802
        return QSize(600, 240)

    def mouseMoveEvent(self, e) -> None:  # noqa: N802
        if not self._xs:
            return
        x = e.position().x()
        i = bisect.bisect_left(self._xs, x)
        cands = [j for j in (i - 1, i) if 0 <= j < len(self._xs)]
        j = min(cands, key=lambda k: abs(self._xs[k] - x))
        if self._hover != j:
            self._hover = j
            self.update()
        QToolTip.showText(e.globalPosition().toPoint(), self.points[j].tooltip, self)

    def leaveEvent(self, e) -> None:  # noqa: N802
        self._hover = None
        self.update()
        super().leaveEvent(e)

    def paintEvent(self, _e) -> None:  # noqa: N802
        t = tokens()
        p = self.painter()
        vals = [v for pt in self.points for v in (pt.a, pt.b) if v is not None]
        if not vals:
            self._xs = []
            self.draw_empty(p)
            return
        x0, x1 = 48.0, self.width() - 56.0
        top, bottom = 34.0, self.height() - 30.0
        vtop, ticks = linear_ticks(max(vals) * 1.1)
        n = len(self.points)

        def sx(i: int) -> float:
            return (x0 + x1) / 2 if n == 1 else x0 + (x1 - x0) * i / (n - 1)

        def sy(v: float) -> float:
            return bottom - (bottom - top) * v / vtop

        # legend (always present for two series)
        lx = x0
        for name, color in ((self.a_name, t.series_1), (self.b_name, t.series_2)):
            p.setPen(QPen(qc(color), 2.5, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
            p.drawLine(QPointF(lx, 14), QPointF(lx + 16, 14))
            self.text(p, QRectF(lx + 22, 4, 220, 20), name, t.text_2, self.font_small)
            lx += 30 + QFontMetricsF(self.font_small).horizontalAdvance(name) + 18
        for tv in ticks:
            y = sy(tv)
            self.hairline(p, t.grid if tv else t.baseline, x0, y, x1, y)
            self.text(p, QRectF(0, y - 9, x0 - 8, 18), fmt_tick(tv), t.muted, self.font_small,
                      Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.text(p, QRectF(0, top - 26, x0 + 40, 16), "ms", t.muted, self.font_small,
                  Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignBottom)
        # selective x labels: first, last, and a few between
        idx = sorted({0, n - 1, *range(0, n, max(1, n // 5))})
        for i in idx:
            rect = QRectF(sx(i) - 50, bottom + 6, 100, 18)
            rect.moveLeft(min(max(rect.left(), 0.0), self.width() - rect.width()))
            self.text(p, rect, self.points[i].label, t.muted, self.font_small,
                      Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
        self._xs = [sx(i) for i in range(n)]
        if self._hover is not None and self._hover < n:
            self.hairline(p, t.baseline, self._xs[self._hover], top, self._xs[self._hover], bottom)
        for attr, color in (("a", t.series_1), ("b", t.series_2)):
            path = QPainterPath()
            started = False
            for i, pt in enumerate(self.points):
                v = getattr(pt, attr)
                if v is None:
                    started = False
                    continue
                if started:
                    path.lineTo(sx(i), sy(v))
                else:
                    path.moveTo(sx(i), sy(v))
                    started = True
            p.setPen(QPen(qc(color), 2, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawPath(path)
            for i, pt in enumerate(self.points):
                v = getattr(pt, attr)
                if v is not None:
                    p.setPen(QPen(qc(t.surface), 2))
                    p.setBrush(qc(color))
                    p.drawEllipse(QPointF(sx(i), sy(v)), 4.5, 4.5)
        # label the latest value of the recommended series (selective direct label)
        last = next((i for i in range(n - 1, -1, -1) if self.points[i].a is not None), None)
        if last is not None:
            v = self.points[last].a
            self.text(p, QRectF(sx(last) + 8, sy(v) - 9, 60, 18), f"{v:.1f} ms", t.text, self.font_value)
        p.end()
