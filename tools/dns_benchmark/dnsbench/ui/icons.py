"""Small line icons painted with QPainter (no image files, crisp at any DPI, follow the theme)."""

from __future__ import annotations

import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPainterPath, QPen, QPixmap


def _paint(name: str, p: QPainter, s: float) -> None:
    c = s / 2
    if name == "home":
        path = QPainterPath()
        path.moveTo(s * .15, s * .48); path.lineTo(c, s * .15); path.lineTo(s * .85, s * .48)
        p.drawPath(path)
        p.drawRect(QRectF(s * .25, s * .45, s * .5, s * .4))
    elif name == "gauge":
        p.drawArc(QRectF(s * .12, s * .2, s * .76, s * .76), -30 * 16, 240 * 16)
        p.drawLine(QPointF(c, s * .58), QPointF(s * .7, s * .36))
    elif name == "trophy":
        path = QPainterPath()
        path.moveTo(s * .3, s * .18); path.lineTo(s * .7, s * .18); path.lineTo(s * .66, s * .5)
        path.quadTo(c, s * .66, s * .34, s * .5); path.closeSubpath()
        p.drawPath(path)
        p.drawArc(QRectF(s * .12, s * .22, s * .2, s * .2), 90 * 16, 180 * 16)
        p.drawArc(QRectF(s * .68, s * .22, s * .2, s * .2), 90 * 16, -180 * 16)
        p.drawLine(QPointF(c, s * .6), QPointF(c, s * .78))
        p.drawLine(QPointF(s * .34, s * .82), QPointF(s * .66, s * .82))
    elif name == "clock":
        p.drawEllipse(QRectF(s * .15, s * .15, s * .7, s * .7))
        p.drawLine(QPointF(c, c), QPointF(c, s * .3))
        p.drawLine(QPointF(c, c), QPointF(s * .66, s * .6))
    elif name == "gear":
        p.drawEllipse(QRectF(s * .36, s * .36, s * .28, s * .28))
        for i in range(8):
            a = i * math.pi / 4
            p.drawLine(QPointF(c + math.cos(a) * s * .24, c + math.sin(a) * s * .24),
                       QPointF(c + math.cos(a) * s * .36, c + math.sin(a) * s * .36))
        p.drawEllipse(QRectF(s * .24, s * .24, s * .52, s * .52))
    elif name == "info":
        p.drawEllipse(QRectF(s * .15, s * .15, s * .7, s * .7))
        p.drawLine(QPointF(c, s * .45), QPointF(c, s * .68))
        p.drawPoint(QPointF(c, s * .33))
    elif name == "warning":
        path = QPainterPath()
        path.moveTo(c, s * .14); path.lineTo(s * .88, s * .82); path.lineTo(s * .12, s * .82); path.closeSubpath()
        p.drawPath(path)
        p.drawLine(QPointF(c, s * .4), QPointF(c, s * .6))
        p.drawPoint(QPointF(c, s * .7))
    elif name == "error":
        p.drawEllipse(QRectF(s * .15, s * .15, s * .7, s * .7))
        p.drawLine(QPointF(s * .37, s * .37), QPointF(s * .63, s * .63))
        p.drawLine(QPointF(s * .63, s * .37), QPointF(s * .37, s * .63))
    elif name == "check":
        p.drawEllipse(QRectF(s * .15, s * .15, s * .7, s * .7))
        path = QPainterPath()
        path.moveTo(s * .34, s * .5); path.lineTo(s * .46, s * .62); path.lineTo(s * .67, s * .4)
        p.drawPath(path)


def icon_pixmap(name: str, color: str, size: int = 20, dpr: float = 2.0) -> QPixmap:
    pm = QPixmap(int(size * dpr), int(size * dpr))
    pm.fill(Qt.GlobalColor.transparent)
    pm.setDevicePixelRatio(dpr)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setPen(QPen(QColor(color), max(1.6, size / 11), Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap,
                  Qt.PenJoinStyle.RoundJoin))
    _paint(name, p, size)
    p.end()
    return pm


def icon(name: str, color: str, size: int = 20) -> QIcon:
    return QIcon(icon_pixmap(name, color, size))


def app_icon_pixmap(size: int = 256) -> QPixmap:
    """The app icon: a rounded blue tile with a white speed gauge."""
    pm = QPixmap(size, size)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QColor("#2a78d6"))
    r = size * 0.22
    p.drawRoundedRect(QRectF(size * .04, size * .04, size * .92, size * .92), r, r)
    pen = QPen(QColor("#ffffff"), size * 0.085, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
    p.setPen(pen)
    p.setBrush(Qt.BrushStyle.NoBrush)
    p.drawArc(QRectF(size * .2, size * .26, size * .6, size * .6), -30 * 16, 240 * 16)
    p.drawLine(QPointF(size * .5, size * .56), QPointF(size * .68, size * .38))
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QColor("#ffffff"))
    p.drawEllipse(QPointF(size * .5, size * .56), size * .065, size * .065)
    p.end()
    return pm


def app_icon() -> QIcon:
    ic = QIcon()
    for s in (16, 24, 32, 48, 64, 128, 256):
        ic.addPixmap(app_icon_pixmap(s))
    return ic
