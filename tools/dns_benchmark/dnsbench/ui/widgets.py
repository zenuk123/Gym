"""Reusable UI pieces."""

from __future__ import annotations

import traceback
from collections.abc import Callable

from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, QTimer, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QFrame, QGridLayout, QHBoxLayout, QLabel, QLayout, QPushButton, QScrollArea,
                               QSizePolicy, QVBoxLayout, QWidget)

from .icons import icon_pixmap
from .theme import tokens


def label(text: str = "", role: str | None = None, wrap: bool = False, selectable: bool = False) -> QLabel:
    lb = QLabel(text)
    if role:
        lb.setObjectName(role)
    lb.setWordWrap(wrap)
    if selectable:
        lb.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    return lb


def button(text: str, role: str | None = None, on_click: Callable | None = None, tooltip: str = "") -> QPushButton:
    b = QPushButton(text)
    if role:
        b.setObjectName(role)
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    if on_click:
        b.clicked.connect(on_click)
    if tooltip:
        b.setToolTip(tooltip)
    return b


def clear_layout(layout: QLayout) -> None:
    while layout.count():
        item = layout.takeAt(0)
        w = item.widget()
        if w is not None:
            w.setParent(None)
            w.deleteLater()
        elif item.layout() is not None:
            clear_layout(item.layout())


class Card(QFrame):
    def __init__(self, title: str | None = None, hero: bool = False, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("heroCard" if hero else "card")
        self.body = QVBoxLayout(self)
        self.body.setContentsMargins(22, 18, 22, 20)
        self.body.setSpacing(10)
        if title:
            self.body.addWidget(label(title, "h2"))

    def add(self, w: QWidget | QLayout, stretch: int = 0) -> None:
        if isinstance(w, QLayout):
            self.body.addLayout(w, stretch)
        else:
            self.body.addWidget(w, stretch)


class Banner(QFrame):
    """Message strip with an icon. level: info / warning / error / good."""

    def __init__(self, level: str, text: str, parent: QWidget | None = None, closable: bool = False) -> None:
        super().__init__(parent)
        t = tokens()
        self.setObjectName({"error": "banner_error", "warning": "banner_warning"}.get(level, "banner_info"))
        lay = QHBoxLayout(self)
        lay.setContentsMargins(14, 10, 14, 10)
        lay.setSpacing(10)
        color = {"error": t.critical, "warning": "#b07800" if not t.dark else t.warning, "good": t.good}.get(level, t.accent)
        glyph = {"error": "error", "warning": "warning", "good": "check"}.get(level, "info")
        ic = QLabel()
        ic.setPixmap(icon_pixmap(glyph, color, 20))
        ic.setAlignment(Qt.AlignmentFlag.AlignTop)
        lay.addWidget(ic, 0, Qt.AlignmentFlag.AlignTop)
        self.text = label(text, wrap=True)
        self.text.setTextFormat(Qt.TextFormat.RichText)
        self.text.setOpenExternalLinks(True)
        lay.addWidget(self.text, 1)
        if closable:
            x = button("Dismiss", "link", self.hide)
            lay.addWidget(x, 0, Qt.AlignmentFlag.AlignTop)


class AddressBox(QFrame):
    """A DNS address with its role, selectable and copyable."""

    def __init__(self, role: str, address: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("addressBox")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(16, 10, 16, 12)
        lay.setSpacing(2)
        lay.addWidget(label(role.upper(), "eyebrow"))
        lay.addWidget(label(address, "mono", selectable=True))
        self.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)


class StatTile(QWidget):
    def __init__(self, title: str, value: str, note: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(1)
        lay.addWidget(label(title, "muted"))
        lay.addWidget(label(value, "big"))
        if note:
            lay.addWidget(label(note, "muted", wrap=True))


def stat_grid(items: list[tuple[str, str, str]], columns: int = 4) -> QGridLayout:
    g = QGridLayout()
    g.setHorizontalSpacing(28)
    g.setVerticalSpacing(14)
    for i, (title, value, note) in enumerate(items):
        g.addWidget(StatTile(title, value, note), i // columns, i % columns, Qt.AlignmentFlag.AlignTop)
    return g


class Details(QWidget):
    """Collapsible "Technical details" section."""

    def __init__(self, title: str, content: QWidget, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self._title = title
        self.toggle = button(f"▸ {title}", "link", self._flip)
        lay.addWidget(self.toggle)
        self.content = content
        content.setVisible(False)
        lay.addWidget(content)

    def _flip(self) -> None:
        vis = not self.content.isVisible()
        self.content.setVisible(vis)
        self.toggle.setText(f"{'▾' if vis else '▸'} {self._title}")


def scrollable(inner: QWidget) -> QScrollArea:
    sa = QScrollArea()
    sa.setWidgetResizable(True)
    sa.setFrameShape(QFrame.Shape.NoFrame)
    sa.setWidget(inner)
    return sa


def page_container() -> tuple[QScrollArea, QVBoxLayout]:
    """A scrollable page with a centred, width-limited column."""
    inner = QWidget()
    inner.setObjectName("page")
    outer = QHBoxLayout(inner)
    outer.setContentsMargins(28, 24, 28, 28)
    col = QWidget()
    col.setMaximumWidth(1100)
    v = QVBoxLayout(col)
    v.setContentsMargins(0, 0, 0, 0)
    v.setSpacing(16)
    outer.addWidget(col)
    return scrollable(inner), v


def copy_to_clipboard(text: str) -> None:
    QGuiApplication.clipboard().setText(text)


class Toast(QLabel):
    """A short-lived confirmation message at the bottom of a window."""

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.setObjectName("toast")
        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)

    def show_message(self, text: str, ms: int = 2200) -> None:
        self.setText(text)
        self.adjustSize()
        p = self.parentWidget()
        self.move((p.width() - self.width()) // 2, p.height() - self.height() - 28)
        self.raise_()
        self.show()
        self._timer.start(ms)


class _Signals(QObject):
    done = Signal(object)
    failed = Signal(str, str)


class _Job(QRunnable):
    def __init__(self, fn: Callable, signals: _Signals) -> None:
        super().__init__()
        self.fn = fn
        self.signals = signals

    def run(self) -> None:
        try:
            result = self.fn()
        except Exception as exc:  # noqa: BLE001
            self.signals.failed.emit(str(exc), traceback.format_exc())
            return
        self.signals.done.emit(result)


_live: set[_Signals] = set()


def run_in_background(fn: Callable, on_done: Callable[[object], None] | None = None,
                      on_error: Callable[[str, str], None] | None = None) -> None:
    """Run ``fn`` on a worker thread; callbacks run on the UI thread."""
    sig = _Signals()
    _live.add(sig)

    def finish(*_: object) -> None:
        _live.discard(sig)

    if on_done:
        sig.done.connect(on_done)
    if on_error:
        sig.failed.connect(on_error)
    sig.done.connect(finish)
    sig.failed.connect(finish)
    QThreadPool.globalInstance().start(_Job(fn, sig))
