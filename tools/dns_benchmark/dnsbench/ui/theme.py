"""Design tokens (light + dark) and the Qt stylesheet built from them. Charts read the same tokens."""

from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPalette
from PySide6.QtWidgets import QApplication


@dataclass(frozen=True)
class Tokens:
    dark: bool
    page: str
    surface: str
    surface_2: str       # hover / inset
    border: str
    text: str
    text_2: str
    muted: str
    grid: str
    baseline: str
    accent: str
    accent_hover: str
    accent_soft: str
    on_accent: str
    series_1: str        # categorical slot 1 (blue)
    series_2: str        # categorical slot 2 (orange)
    series_soft: str     # de-emphasised step of series 1 (non-highlighted bars)
    good: str
    good_text: str
    warning: str
    serious: str
    critical: str
    info_bg: str
    warn_bg: str
    error_bg: str


LIGHT = Tokens(
    dark=False, page="#f4f4f1", surface="#fcfcfb", surface_2="#efeeea", border="#dcdbd5", text="#0b0b0b",
    text_2="#52514e", muted="#77756f", grid="#e1e0d9", baseline="#c3c2b7", accent="#2a78d6", accent_hover="#256abf",
    accent_soft="#e3eefb", on_accent="#ffffff", series_1="#2a78d6", series_2="#eb6834", series_soft="#9ec5f4",
    good="#0ca30c", good_text="#006300", warning="#fab219", serious="#ec835a", critical="#d03b3b",
    info_bg="#e8f0fb", warn_bg="#fdf3dc", error_bg="#fbe5e4",
)

DARK = Tokens(
    dark=True, page="#0d0d0d", surface="#1a1a19", surface_2="#252524", border="#30302e", text="#ffffff",
    text_2="#c3c2b7", muted="#94928b", grid="#2c2c2a", baseline="#383835", accent="#3987e5", accent_hover="#5598e7",
    accent_soft="#17263a", on_accent="#ffffff", series_1="#3987e5", series_2="#d95926", series_soft="#1c5cab",
    good="#0ca30c", good_text="#0ca30c", warning="#fab219", serious="#ec835a", critical="#d03b3b",
    info_bg="#14243a", warn_bg="#3a2e10", error_bg="#3d1717",
)

_current: Tokens = DARK


def tokens() -> Tokens:
    return _current


def qc(hex_color: str, alpha: float | None = None) -> QColor:
    c = QColor(hex_color)
    if alpha is not None:
        c.setAlphaF(alpha)
    return c


def system_prefers_dark() -> bool:
    try:
        return QGuiApplication.styleHints().colorScheme() == Qt.ColorScheme.Dark
    except AttributeError:  # Qt < 6.5
        return QGuiApplication.palette().color(QPalette.ColorRole.Window).lightness() < 128


def ui_font(size: float = 10.0, weight: QFont.Weight = QFont.Weight.Normal) -> QFont:
    f = QFont()
    f.setFamilies(["Segoe UI Variable Text", "Segoe UI", "Inter", "Helvetica Neue", "Arial", "sans-serif"])
    f.setPointSizeF(size)
    f.setWeight(weight)
    return f


def stylesheet(t: Tokens) -> str:
    return f"""
    QWidget {{ color: {t.text}; font-size: 10pt; }}
    QMainWindow, #page, QScrollArea, QScrollArea > QWidget > QWidget, QStackedWidget {{ background: {t.page}; }}
    QDialog {{ background: {t.page}; }}
    #sidebar {{ background: {t.surface}; border-right: 1px solid {t.border}; }}
    #brand {{ font-size: 13pt; font-weight: 600; }}
    #brandSub {{ color: {t.muted}; font-size: 8.5pt; }}
    #navButton {{ text-align: left; padding: 10px 14px; border: none; border-radius: 8px; color: {t.text_2};
                  font-size: 10.5pt; background: transparent; }}
    #navButton:hover {{ background: {t.surface_2}; color: {t.text}; }}
    #navButton:checked {{ background: {t.accent_soft}; color: {t.text}; font-weight: 600; }}
    #card {{ background: {t.surface}; border: 1px solid {t.border}; border-radius: 12px; }}
    #heroCard {{ background: {t.surface}; border: 2px solid {t.accent}; border-radius: 14px; }}
    #h1 {{ font-size: 20pt; font-weight: 600; }}
    #h2 {{ font-size: 13pt; font-weight: 600; }}
    #h3 {{ font-size: 10.5pt; font-weight: 600; }}
    #eyebrow {{ color: {t.muted}; font-size: 8.5pt; font-weight: 600; letter-spacing: 1px; }}
    #hero {{ font-size: 28pt; font-weight: 600; }}
    #big {{ font-size: 16pt; font-weight: 600; }}
    #muted {{ color: {t.muted}; }}
    #secondary {{ color: {t.text_2}; }}
    #good {{ color: {t.good_text}; font-weight: 600; }}
    #bad {{ color: {t.critical}; font-weight: 600; }}
    #mono {{ font-family: "Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace; font-size: 13pt; font-weight: 600; }}
    #addressBox {{ background: {t.surface_2}; border-radius: 10px; }}
    #tag {{ background: {t.surface_2}; color: {t.text_2}; border-radius: 9px; padding: 2px 8px; font-size: 8.5pt; }}
    #tagAccent {{ background: {t.accent_soft}; color: {t.text}; border-radius: 9px; padding: 2px 8px; font-size: 8.5pt;
                  font-weight: 600; }}
    QPushButton {{ background: {t.surface}; border: 1px solid {t.border}; border-radius: 8px; padding: 8px 16px;
                   min-height: 20px; }}
    QPushButton:hover {{ background: {t.surface_2}; }}
    QPushButton:pressed {{ background: {t.border}; }}
    QPushButton:disabled {{ color: {t.muted}; background: {t.surface_2}; }}
    QPushButton#primary {{ background: {t.accent}; color: {t.on_accent}; border: none; font-weight: 600; }}
    QPushButton#primary:hover {{ background: {t.accent_hover}; }}
    QPushButton#primary:disabled {{ background: {t.surface_2}; color: {t.muted}; }}
    QPushButton#cta {{ background: {t.accent}; color: {t.on_accent}; border: none; border-radius: 12px; font-size: 15pt;
                       font-weight: 700; padding: 16px 28px; letter-spacing: 1px; }}
    QPushButton#cta:hover {{ background: {t.accent_hover}; }}
    QPushButton#link {{ background: transparent; border: none; color: {t.accent}; padding: 2px 0; text-align: left; }}
    QPushButton#link:hover {{ text-decoration: underline; }}
    QPushButton#segment {{ border-radius: 0; padding: 6px 14px; }}
    QPushButton#segment:checked {{ background: {t.accent}; color: {t.on_accent}; border-color: {t.accent}; }}
    QProgressBar {{ background: {t.surface_2}; border: none; border-radius: 5px; height: 10px; text-align: center;
                    color: transparent; }}
    QProgressBar::chunk {{ background: {t.accent}; border-radius: 5px; }}
    QTableWidget, QTableView {{ background: {t.surface}; border: none; gridline-color: {t.grid};
                                selection-background-color: {t.accent_soft}; selection-color: {t.text};
                                alternate-background-color: {t.surface}; }}
    QTableWidget::item {{ padding: 4px 8px; border-bottom: 1px solid {t.grid}; }}
    QHeaderView::section {{ background: {t.surface}; color: {t.muted}; border: none; border-bottom: 1px solid {t.baseline};
                            padding: 6px 8px; font-weight: 600; font-size: 9pt; }}
    QTabWidget::pane {{ border: none; background: {t.surface}; }}
    QTabWidget > QStackedWidget > QWidget {{ background: {t.surface}; }}
    QTabBar::tab {{ background: transparent; color: {t.text_2}; padding: 8px 14px; border-bottom: 2px solid transparent; }}
    QTabBar::tab:selected {{ color: {t.text}; border-bottom: 2px solid {t.accent}; font-weight: 600; }}
    QTabBar::tab:hover {{ color: {t.text}; }}
    QLineEdit, QPlainTextEdit, QTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {{
        background: {t.surface}; border: 1px solid {t.border}; border-radius: 6px; padding: 6px 8px;
        selection-background-color: {t.accent}; }}
    QComboBox QAbstractItemView {{ background: {t.surface}; border: 1px solid {t.border}; selection-background-color: {t.accent_soft}; }}
    QTextBrowser {{ background: transparent; border: none; }}
    QCheckBox, QRadioButton {{ spacing: 8px; }}
    QSlider::groove:horizontal {{ height: 4px; background: {t.surface_2}; border-radius: 2px; }}
    QSlider::sub-page:horizontal {{ background: {t.accent}; border-radius: 2px; }}
    QSlider::handle:horizontal {{ background: {t.accent}; width: 16px; margin: -6px 0; border-radius: 8px; }}
    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {t.border}; border-radius: 4px; min-height: 30px; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
    QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 2px; }}
    QScrollBar::handle:horizontal {{ background: {t.border}; border-radius: 4px; min-width: 30px; }}
    QToolTip {{ background: {t.surface}; color: {t.text}; border: 1px solid {t.border}; padding: 6px; border-radius: 6px; }}
    QMessageBox QLabel {{ min-width: 360px; }}
    #banner_info {{ background: {t.info_bg}; border-radius: 10px; }}
    #banner_warning {{ background: {t.warn_bg}; border-radius: 10px; }}
    #banner_error {{ background: {t.error_bg}; border-radius: 10px; }}
    #toast {{ background: {t.text}; color: {t.page}; border-radius: 8px; padding: 8px 14px; }}
    """


def apply_theme(app: QApplication, preference: str = "system") -> Tokens:
    global _current
    dark = system_prefers_dark() if preference == "system" else preference == "dark"
    _current = DARK if dark else LIGHT
    app.setFont(ui_font(10))
    pal = app.palette()
    t = _current
    for role, col in ((QPalette.ColorRole.Window, t.page), (QPalette.ColorRole.Base, t.surface),
                      (QPalette.ColorRole.Text, t.text), (QPalette.ColorRole.WindowText, t.text),
                      (QPalette.ColorRole.Button, t.surface), (QPalette.ColorRole.ButtonText, t.text),
                      (QPalette.ColorRole.Highlight, t.accent), (QPalette.ColorRole.HighlightedText, t.on_accent),
                      (QPalette.ColorRole.ToolTipBase, t.surface), (QPalette.ColorRole.ToolTipText, t.text),
                      (QPalette.ColorRole.PlaceholderText, t.muted), (QPalette.ColorRole.Link, t.accent)):
        pal.setColor(role, QColor(col))
    app.setPalette(pal)
    app.setStyleSheet(stylesheet(t))
    return t
