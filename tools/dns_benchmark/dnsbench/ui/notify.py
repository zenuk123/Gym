"""Windows notification for scheduled checks (system-tray balloon/toast; no extra dependencies)."""

from __future__ import annotations

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication, QSystemTrayIcon

from .icons import app_icon


def show_notification(title: str, message: str, seconds: int = 10) -> None:
    app = QApplication.instance() or QApplication([])
    if not QSystemTrayIcon.isSystemTrayAvailable():
        return
    tray = QSystemTrayIcon(app_icon())
    tray.setToolTip("DNS Benchmark")
    tray.show()
    tray.showMessage(title, message + "\nOpen DNS Benchmark to see the details.",
                     QSystemTrayIcon.MessageIcon.Information, seconds * 1000)
    QTimer.singleShot(seconds * 1000 + 500, app.quit)
    app.exec()
    tray.hide()
