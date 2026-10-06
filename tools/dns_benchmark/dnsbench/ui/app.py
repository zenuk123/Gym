"""Main window and app-level actions (start/cancel benchmark, copy, apply/restore, export, navigation)."""

from __future__ import annotations

import sys
import time

from PySide6.QtCore import QSize, Qt
from PySide6.QtWidgets import (QApplication, QButtonGroup, QCheckBox, QFileDialog, QFrame, QHBoxLayout, QMainWindow,
                               QMessageBox, QStackedWidget, QVBoxLayout, QWidget)

from .. import APP_NAME, __version__
from ..benchmark import request_from_settings
from ..export import samples_csv, write_export
from ..fake import FakeTransport, demo_network, demo_profiles
from ..network import detect_network
from ..providers import Provider, load_builtin_providers
from ..results import Analysis, analyse
from ..scoring import Weights
from ..storage import HistoryStore, SettingsStore
from ..transport import RealTransport
from ..windows_dns import dns_manager_available
from . import theme
from .icons import app_icon, app_icon_pixmap, icon
from .pages.benchmark import BenchmarkPage
from .pages.dashboard import DashboardPage
from .pages.details import ProviderDetailsDialog
from .pages.help import HelpPage
from .pages.history import HistoryPage
from .pages.results import ResultsPage
from .pages.settings import SettingsPage
from .widgets import Toast, button, label, run_in_background
from .worker import BenchmarkWorker, probe_current_dns

NAV = [("dashboard", "Dashboard", "home"), ("results", "Results", "trophy"), ("history", "History", "clock"),
       ("settings", "Settings", "gear"), ("help", "Learn", "info")]


class MainWindow(QMainWindow):
    def __init__(self, demo: bool = False) -> None:
        super().__init__()
        self.demo = demo
        self.settings_store = SettingsStore()
        self.settings = self.settings_store.load()
        self.history = HistoryStore()
        self.builtins: list[Provider] = load_builtin_providers()
        self.network = None
        self.analysis: Analysis | None = None
        self.worker: BenchmarkWorker | None = None
        self._dns_manager = None
        if dns_manager_available():
            from ..windows_dns import default_manager

            self._dns_manager = default_manager()

        self.setWindowTitle(APP_NAME + (" — DEMO" if demo else ""))
        self.setWindowIcon(app_icon())
        self.resize(1200, 860)
        self.setMinimumSize(QSize(900, 620))

        root = QWidget()
        h = QHBoxLayout(root)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)
        self.sidebar = self._build_sidebar()
        h.addWidget(self.sidebar)
        self.stack = QStackedWidget()
        h.addWidget(self.stack, 1)
        self.setCentralWidget(root)

        self.pages = {
            "dashboard": DashboardPage(self), "benchmark": BenchmarkPage(self), "results": ResultsPage(self),
            "history": HistoryPage(self), "settings": SettingsPage(self), "help": HelpPage(self),
        }
        for p in self.pages.values():
            self.stack.addWidget(p)
        self.toast_widget = Toast(self)
        self.refresh_last()
        self.history_page.reload()
        self.go("dashboard")
        self.refresh_network()
        self._show_pending_notice()

    # ------------------------------------------------------------------ properties
    @property
    def dashboard(self) -> DashboardPage:
        return self.pages["dashboard"]  # type: ignore[return-value]

    @property
    def results_page(self) -> ResultsPage:
        return self.pages["results"]  # type: ignore[return-value]

    @property
    def history_page(self) -> HistoryPage:
        return self.pages["history"]  # type: ignore[return-value]

    @property
    def settings_page(self) -> SettingsPage:
        return self.pages["settings"]  # type: ignore[return-value]

    # ------------------------------------------------------------------ layout
    def _build_sidebar(self) -> QFrame:
        side = QFrame()
        side.setObjectName("sidebar")
        side.setFixedWidth(224)
        v = QVBoxLayout(side)
        v.setContentsMargins(14, 18, 14, 16)
        v.setSpacing(4)
        brand = QHBoxLayout()
        logo = label()
        pm = app_icon_pixmap(64)
        pm.setDevicePixelRatio(2)
        logo.setPixmap(pm)
        brand.addWidget(logo)
        names = QVBoxLayout()
        names.setSpacing(0)
        names.addWidget(label(APP_NAME, "brand"))
        names.addWidget(label("Local · private · no account", "brandSub"))
        brand.addLayout(names, 1)
        v.addLayout(brand)
        v.addSpacing(18)
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons = {}
        for key, text, glyph in NAV:
            b = button(text, "navButton", lambda _=False, k=key: self.go(k))
            b.setCheckable(True)
            b.setIconSize(QSize(18, 18))
            b.setProperty("glyph", glyph)
            self.nav_group.addButton(b)
            self.nav_buttons[key] = b
            v.addWidget(b)
        v.addStretch(1)
        if self.demo:
            v.addWidget(label("DEMO MODE\nresults are simulated", "tagAccent"))
        v.addWidget(label(f"Version {__version__}", "brandSub"))
        self._paint_nav_icons()
        return side

    def _paint_nav_icons(self) -> None:
        t = theme.tokens()
        for b in self.nav_buttons.values():
            b.setIcon(icon(b.property("glyph"), t.text_2, 18))

    def go(self, key: str, section: str | None = None) -> None:
        if key == "results" and self.worker is not None and self.worker.isRunning():
            key = "benchmark"
        page = self.pages[key]
        self.stack.setCurrentWidget(page)
        nav_key = "dashboard" if key == "benchmark" else key
        if nav_key in self.nav_buttons:
            self.nav_buttons[nav_key].setChecked(True)
        if key == "history":
            self.history_page.reload()
        if key == "settings":
            self.settings_page.refresh_windows()
        if key == "help":
            self.pages["help"].show_section(section)  # type: ignore[attr-defined]

    def toast(self, text: str) -> None:
        self.toast_widget.show_message(text)

    def apply_theme(self) -> None:
        theme.apply_theme(QApplication.instance(), self.settings.theme)
        self._paint_nav_icons()
        self.pages["help"].restyle()  # type: ignore[attr-defined]
        if self.analysis is not None:
            self.results_page.show_analysis(self.analysis)
        self._refresh_dashboard_banners()
        self.update()

    def save_settings(self) -> None:
        try:
            self.settings_store.save(self.settings)
        except OSError as exc:
            QMessageBox.warning(self, "Couldn't save settings", f"Your settings couldn't be saved: {exc}")

    # ------------------------------------------------------------------ network / dashboard
    def refresh_network(self) -> None:
        if self.demo:
            self.network = demo_network()
            self.dashboard.set_network(self.network, None)
            run_in_background(lambda: probe_current_dns(self.network, FakeTransport(demo_profiles(1))),
                              lambda probe: self.dashboard.set_network(self.network, probe))
            self._refresh_dashboard_banners()
            return

        def work():
            net = detect_network()
            return net, None

        def detected(res) -> None:
            self.network, _ = res
            self.dashboard.set_network(self.network, None)
            self._refresh_dashboard_banners()
            run_in_background(lambda: probe_current_dns(self.network, RealTransport()),
                              lambda probe: self.dashboard.set_network(self.network, probe),
                              lambda msg, _tb: self.dashboard.set_network(self.network, {"median_ms": None}))

        run_in_background(work, detected, lambda msg, tb: self.dashboard.set_banners(
            [("warning", f"Couldn't read your network settings: {msg}")]))

    def _refresh_dashboard_banners(self) -> None:
        items = []
        if self.settings.pending_notice:
            items.append(("info", f"<b>Automatic check:</b> {self.settings.pending_notice}"))
        if self.network is not None:
            if self.network.error:
                items.append(("warning", self.network.error))
            if self.network.vpn:
                items.append(("warning", self.vpn_warning(self.network.vpn.name)))
            if not self.network.dns_servers and not self.network.error:
                items.append(("warning", "No active network adapter with DNS servers was found. Check that you're "
                                         "connected to a network."))
        self.dashboard.set_banners(items)

    def _show_pending_notice(self) -> None:
        if self.settings.pending_notice:
            self._refresh_dashboard_banners()
            self.settings.pending_notice = None  # shown once
            self.save_settings()

    def vpn_warning(self, name: str | None = None) -> str:
        who = f" ({name})" if name else ""
        return (f"A VPN appears to be active{who}. Your VPN may override or intercept DNS requests, meaning these "
                f"results may not represent your normal home-router DNS performance.")

    def lookup_public_ip(self) -> None:
        from ..diagnostics import public_ip

        transport = FakeTransport({}) if self.demo else RealTransport()

        def work():
            import asyncio

            return asyncio.run(public_ip(transport))

        self.dashboard.set_public_ip("looking up…")
        run_in_background(work, lambda ip: self.dashboard.set_public_ip(ip or "couldn't be determined"),
                          lambda *_: self.dashboard.set_public_ip("couldn't be determined"))

    def refresh_last(self) -> None:
        entries = self.history.list()
        self.dashboard.set_last(entries[0] if entries else None)

    def provider_name(self, pid: str) -> str:
        if pid == "current":
            return "Current DNS"
        p = next((p for p in self.settings.all_providers(self.builtins) if p.id == pid), None)
        return p.display_name if p else pid

    # ------------------------------------------------------------------ benchmark
    def start_benchmark(self, mode: str) -> None:
        if self.worker is not None and self.worker.isRunning():
            self.go("benchmark")
            return
        request = request_from_settings(self.settings, mode, builtins=self.builtins)
        if not request.providers:
            QMessageBox.information(self, "No providers selected", "Turn on at least one DNS provider in Settings.")
            return
        transport = FakeTransport(demo_profiles(), realtime=True, seed=None) if self.demo else RealTransport()
        self.worker = BenchmarkWorker(request, self.network, transport, self.demo)
        bp: BenchmarkPage = self.pages["benchmark"]  # type: ignore[assignment]
        self.worker.progress.connect(bp.on_progress)
        self.worker.preflight.connect(bp.on_preflight)
        self.worker.finished_run.connect(self._benchmark_done)
        self.worker.aborted.connect(self._benchmark_aborted)
        self.worker.crashed.connect(self._benchmark_crashed)
        bp.begin(mode, self.demo)
        self.dashboard.set_busy(True)
        self.go("benchmark")
        self.worker.start()

    def cancel_benchmark(self) -> None:
        if self.worker is not None:
            self.worker.cancel()

    def _finish_worker(self) -> None:
        self.pages["benchmark"].end()  # type: ignore[attr-defined]
        self.dashboard.set_busy(False)
        if self.worker is not None:
            self.worker.wait(2000)
        self.worker = None

    def _benchmark_done(self, run) -> None:
        if self.worker is not None and self.worker.network is not None:
            self.network = self.worker.network
        self._finish_worker()
        if not run.samples:
            self.toast("Benchmark cancelled.")
            self.go("dashboard")
            return
        analysis = analyse(run, Weights.from_dict(self.settings.weights))
        saved = False
        if not run.cancelled and self.settings.save_history:
            try:
                self.history.save(analysis)
                saved = True
            except OSError as exc:
                QMessageBox.warning(self, "Couldn't save to history", str(exc))
        rec = analysis.recommendation
        if rec and not run.cancelled and not run.demo:
            self.settings.last_winner = {"provider_id": rec.winner.provider_id, "name": rec.winner.name,
                                         "typical_ms": rec.winner.score.typical_ms, "run_id": run.id, "at": time.time()}
            self.save_settings()
        self.analysis = analysis
        self.results_page.show_analysis(analysis, saved)
        self.refresh_last()
        self.go("results")

    def _benchmark_aborted(self, message: str) -> None:
        self._finish_worker()
        self.go("dashboard")
        if message != "Benchmark cancelled.":
            QMessageBox.warning(self, "Can't run the benchmark", message)

    def _benchmark_crashed(self, message: str, tb: str) -> None:
        self._finish_worker()
        self.go("dashboard")
        box = QMessageBox(QMessageBox.Icon.Critical, "Something went wrong",
                          "The benchmark stopped unexpectedly. Please try again.", parent=self)
        box.setDetailedText(f"{message}\n\n{tb}")
        box.exec()

    def weights_changed(self) -> None:
        if self.analysis is not None:
            self.analysis = analyse(self.analysis.run, Weights.from_dict(self.settings.weights))
            self.results_page.show_analysis(self.analysis)

    def open_history_run(self, run_id: str) -> None:
        try:
            run = self.history.load(run_id)
        except (FileNotFoundError, ValueError) as exc:
            QMessageBox.warning(self, "Can't open result", str(exc))
            return
        self.analysis = analyse(run, Weights.from_dict(self.settings.weights))
        self.results_page.show_analysis(self.analysis)
        self.go("results")

    def open_details(self, a: Analysis, provider_id: str, view_id: str | None = None) -> None:
        ProviderDetailsDialog(self, a, provider_id, view_id).exec()

    # ------------------------------------------------------------------ copy / export
    def dns_lines(self, p: Provider, a: Analysis | None) -> list[str]:
        lines = [f"{p.name} DNS"]
        if p.ipv4:
            lines.append(f"Primary DNS: {p.ipv4[0]}")
        if len(p.ipv4) > 1:
            lines.append(f"Secondary DNS: {p.ipv4[1]}")
        if p.ipv6:
            lines.append(f"IPv6 primary DNS: {p.ipv6[0]}")
            if len(p.ipv6) > 1:
                lines.append(f"IPv6 secondary DNS: {p.ipv6[1]}")
        return lines

    def copy_dns(self, p: Provider, a: Analysis | None = None) -> None:
        from .widgets import copy_to_clipboard

        copy_to_clipboard("\n".join(self.dns_lines(p, a)))
        self.toast("DNS addresses copied to the clipboard")

    def export(self, a: Analysis, kind: str) -> None:
        stamp = time.strftime("%Y-%m-%d_%H%M", time.localtime(a.run.started_at))
        ext = "csv" if kind == "samples" else kind
        name = f"dns-benchmark-{stamp}{'-samples' if kind == 'samples' else ''}.{ext}"
        filters = {"csv": "CSV (*.csv)", "json": "JSON (*.json)", "txt": "Text (*.txt)"}
        path, _ = QFileDialog.getSaveFileName(self, "Export results", name, filters[ext])
        if not path:
            return
        if not path.lower().endswith("." + ext):
            path += "." + ext
        try:
            if kind == "samples":
                with open(path, "w", encoding="utf-8-sig", newline="") as f:
                    f.write(samples_csv(a))
            else:
                write_export(a, path)
        except (OSError, ValueError) as exc:
            QMessageBox.warning(self, "Export failed", f"Couldn't save the file: {exc}")
            return
        self.toast(f"Saved {path}")

    # ------------------------------------------------------------------ Windows DNS
    def can_change_dns(self) -> bool:
        return self._dns_manager is not None and not self.demo

    def has_dns_backup(self) -> bool:
        return self._dns_manager is not None and self._dns_manager.has_backup()

    def dns_backups(self) -> dict:
        return self._dns_manager.backups() if self._dns_manager is not None else {}

    def _target_adapter(self):
        net = self.network
        if net is None:
            return None
        if net.active is not None and not net.active.is_vpn:
            return net.active
        physical = [a for a in net.adapters if not a.is_vpn and (a.gateway_v4 or a.gateway_v6)]
        return physical[0] if physical else net.active

    def apply_to_windows(self, p: Provider, a: Analysis | None = None) -> None:
        if not self.can_change_dns():
            QMessageBox.information(self, APP_NAME, "Changing DNS settings is only available on Windows "
                                                    "(and not in demo mode).")
            return
        adapter = self._target_adapter()
        if adapter is None:
            QMessageBox.warning(self, APP_NAME, "No active network adapter was found, so DNS can't be changed.")
            return
        ipv6_ok = a is not None and a.run.ipv6_status == "available" and bool(p.ipv6)
        current = ", ".join(adapter.dns_servers) or "automatic"
        lines = [f"<b>Change this PC's DNS to {p.name}?</b>", "",
                 f"Network adapter: <b>{adapter.name}</b>",
                 f"Current DNS: {current}",
                 f"New primary: <b>{p.ipv4[0] if p.ipv4 else '—'}</b>"]
        if len(p.ipv4) > 1:
            lines.append(f"New secondary: <b>{p.ipv4[1]}</b>")
        lines += ["", "Windows will ask for administrator permission. Your current settings are saved first, and you "
                      "can restore them at any time from Settings or the Results page.",
                  "This only affects this computer — your router is not changed."]
        box = QMessageBox(QMessageBox.Icon.Question, "Apply to Windows", "<br>".join(lines),
                          QMessageBox.StandardButton.Cancel, self)
        apply_btn = box.addButton("Change DNS", QMessageBox.ButtonRole.AcceptRole)
        box.setTextFormat(Qt.TextFormat.RichText)
        v6 = None
        if ipv6_ok:
            v6 = QCheckBox(f"Also set IPv6 DNS ({', '.join(p.ipv6[:2])}) — recommended, otherwise Windows may keep "
                           f"using your ISP's IPv6 DNS")
            v6.setChecked(True)
            box.setCheckBox(v6)
        box.exec()
        if box.clickedButton() is not apply_btn:
            return
        ipv4 = p.ipv4[:2]
        ipv6 = p.ipv6[:2] if v6 is not None and v6.isChecked() else []
        self.toast("Waiting for administrator permission…")
        mgr = self._dns_manager
        run_in_background(lambda: mgr.apply(adapter.index, ipv4, ipv6), self._apply_done,
                          lambda msg, tb: self._change_failed(msg, tb))

    def _apply_done(self, res) -> None:
        if res.ok:
            after = res.after
            text = ["Windows DNS changed successfully.", ""]
            if after and after.ipv4_static:
                text.append(f"Primary: {after.ipv4_static[0]}")
                if len(after.ipv4_static) > 1:
                    text.append(f"Secondary: {after.ipv4_static[1]}")
            if after and after.ipv6_static:
                text.append(f"IPv6: {', '.join(after.ipv6_static)}")
            text += ["", "Your previous settings were saved — use “Restore previous DNS” to undo."]
            QMessageBox.information(self, "DNS changed", "\n".join(text))
        elif res.cancelled:
            self.toast(res.message)
        else:
            box = QMessageBox(QMessageBox.Icon.Warning, "DNS not changed", res.message, parent=self)
            if res.details:
                box.setDetailedText(res.details)
            box.exec()
        self._after_dns_change()

    def restore_dns(self) -> None:
        if self._dns_manager is None:
            return
        backups = self.dns_backups()
        if not backups:
            QMessageBox.information(self, APP_NAME, "There are no saved DNS settings to restore.")
            return
        desc = "\n".join(b.describe() for b in backups.values())
        if QMessageBox.question(self, "Restore previous DNS",
                                f"Put back the DNS settings you had before?\n\n{desc}\n\n"
                                f"Windows will ask for administrator permission.") != QMessageBox.StandardButton.Yes:
            return
        mgr = self._dns_manager
        run_in_background(mgr.restore, self._restore_done, lambda msg, tb: self._change_failed(msg, tb))

    def _restore_done(self, res) -> None:
        if res.ok:
            QMessageBox.information(self, "DNS restored", res.message)
        elif res.cancelled:
            self.toast(res.message)
        else:
            box = QMessageBox(QMessageBox.Icon.Warning, "Restore incomplete", res.message, parent=self)
            if res.details:
                box.setDetailedText(res.details)
            box.exec()
        self._after_dns_change()

    def _change_failed(self, message: str, tb: str) -> None:
        box = QMessageBox(QMessageBox.Icon.Critical, "Something went wrong",
                          "The DNS settings couldn't be changed. Nothing else was modified.", parent=self)
        box.setDetailedText(f"{message}\n\n{tb}")
        box.exec()
        self._after_dns_change()

    def _after_dns_change(self) -> None:
        self.settings_page.refresh_windows()
        if self.analysis is not None:
            self.results_page.show_analysis(self.analysis)
        self.refresh_network()

    # ------------------------------------------------------------------ schedule
    def set_schedule(self, key: str) -> tuple[bool, str]:
        from ..scheduler import apply_schedule

        ok, msg = apply_schedule(key)
        if ok:
            self.settings.schedule = key
            self.save_settings()
        return ok, msg

    def closeEvent(self, e) -> None:  # noqa: N802
        if self.worker is not None and self.worker.isRunning():
            self.worker.cancel()
            self.worker.wait(4000)
        super().closeEvent(e)


def run_gui(demo: bool = False) -> int:
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("DNSBenchmark.App")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(__version__)
    app.setWindowIcon(app_icon())
    settings = SettingsStore().load()
    theme.apply_theme(app, settings.theme)
    w = MainWindow(demo=demo)
    w.show()
    return app.exec()
