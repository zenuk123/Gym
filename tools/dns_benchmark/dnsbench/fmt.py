"""Formatting helpers shared by the UI, CLI and exports."""

from __future__ import annotations

import time


def ms(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    if value >= 100:
        return f"{value:.0f} ms"
    return f"{value:.{digits}f} ms"


def num(value: float | None, digits: int = 1) -> str:
    return "" if value is None else f"{value:.{digits}f}"


def pct(rate: float | None) -> str:
    if rate is None:
        return "—"
    if rate >= 0.9995:
        return "100%"
    return f"{rate * 100:.1f}%"


def when(ts: float, with_time: bool = True) -> str:
    lt = time.localtime(ts)
    day = time.strftime("%d %b %Y", lt).lstrip("0")
    return f"{day}, {time.strftime('%H:%M', lt)}" if with_time else day


def duration(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    if seconds < 60:
        return f"{seconds} s"
    if seconds < 3600:
        return f"{seconds // 60} min {seconds % 60:02d} s"
    return f"{seconds // 3600} h {seconds % 3600 // 60:02d} min"
