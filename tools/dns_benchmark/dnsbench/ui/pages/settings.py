"""Settings: what to test, how to score it, automatic checks and appearance. Saved automatically."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QDoubleSpinBox, QGridLayout, QHBoxLayout,
                               QLineEdit, QMessageBox, QPlainTextEdit, QRadioButton, QSlider, QVBoxLayout, QWidget)

from ... import domains as domain_lists
from ...providers import ProviderError, make_custom_provider
from ...scoring import Weights
from ..widgets import Card, button, clear_layout, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow


class SettingsPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        s = app.settings
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll, col = page_container()
        outer.addWidget(scroll)
        col.addWidget(label("Settings", "h1"))
        col.addWidget(label("Changes are saved automatically and stay on this PC.", "secondary"))

        # --- benchmark
        bench = Card("Benchmark")
        grid = QGridLayout()
        grid.setHorizontalSpacing(16)
        grid.addWidget(label("Default test", "secondary"), 0, 0)
        self.mode = QComboBox()
        for key, text in (("quick", "Quick test (≈30–60 s)"), ("full", "Full benchmark (≈3 min)"),
                          ("gaming", "Gaming DNS")):
            self.mode.addItem(text, key)
        self.mode.setCurrentIndex(max(0, self.mode.findData(s.default_mode)))
        self.mode.currentIndexChanged.connect(self._save)
        grid.addWidget(self.mode, 0, 1)
        grid.addWidget(label("Timeout per query", "secondary"), 1, 0)
        self.timeout = QDoubleSpinBox()
        self.timeout.setRange(0.5, 10.0)
        self.timeout.setSingleStep(0.5)
        self.timeout.setSuffix(" s")
        self.timeout.setValue(s.timeout_s)
        self.timeout.valueChanged.connect(self._save)
        grid.addWidget(self.timeout, 1, 1)
        grid.setColumnStretch(2, 1)
        bench.add(grid)
        self.ipv6 = self._check(bench, "Test IPv6 DNS servers when IPv6 works on this connection", s.include_ipv6)
        self.uncached = self._check(bench, "Include uncached lookups (unique random names, measures cache misses)",
                                    s.test_uncached)
        self.dot = self._check(bench, "Also test DNS-over-TLS (advanced — shown separately, for reference only)",
                               s.include_dot)
        self.ncsi = self._check(bench, "Check for hotel/café sign-in pages before testing (uses Windows' own "
                                       "connectivity test page, www.msftconnecttest.com)", s.connectivity_check)
        self.save_hist = self._check(bench, "Save results to history on this PC", s.save_history)
        col.addWidget(bench)

        # --- providers
        prov = Card("DNS providers to test")
        prov.add(label("Your current DNS is always included automatically.", "muted"))
        self.prov_grid = QGridLayout()
        self.prov_grid.setHorizontalSpacing(24)
        prov.add(self.prov_grid)
        add = QHBoxLayout()
        self.c_name = QLineEdit()
        self.c_name.setPlaceholderText("Name (e.g. My Pi-hole)")
        self.c_p = QLineEdit()
        self.c_p.setPlaceholderText("Primary address")
        self.c_s = QLineEdit()
        self.c_s.setPlaceholderText("Secondary (optional)")
        for w in (self.c_name, self.c_p, self.c_s):
            add.addWidget(w)
        add.addWidget(button("Add provider", None, self._add_custom))
        prov.add(label("Add your own DNS server", "h3"))
        prov.add(add)
        col.addWidget(prov)
        self._fill_providers()

        # --- domains
        dom = Card("Test domains")
        dom.add(label("One per line. Popular domains are used for the normal tests; gaming domains for the Gaming test.",
                      "muted", wrap=True))
        row = QHBoxLayout()
        self.dom_edit = QPlainTextEdit("\n".join(s.domains or domain_lists.POPULAR))
        self.game_edit = QPlainTextEdit("\n".join(s.gaming_domains or domain_lists.GAMING))
        for title, w in (("Popular", self.dom_edit), ("Gaming", self.game_edit)):
            box = QVBoxLayout()
            box.addWidget(label(title, "h3"))
            w.setFixedHeight(200)
            box.addWidget(w)
            row.addLayout(box)
        dom.add(row)
        drow = QHBoxLayout()
        drow.addWidget(button("Save domain lists", "primary", self._save_domains))
        drow.addWidget(button("Reset to defaults", None, self._reset_domains))
        self.dom_msg = label("", "muted", wrap=True)
        drow.addWidget(self.dom_msg, 1)
        dom.add(drow)
        col.addWidget(dom)

        # --- scoring
        sc = Card("Scoring")
        sc.add(label("How much each factor counts towards a provider's score. Changing this re-ranks saved results "
                     "too.", "muted", wrap=True))
        w = Weights.from_dict(s.weights).normalised()
        self.sliders: dict[str, tuple[QSlider, object]] = {}
        sg = QGridLayout()
        for i, (key, title) in enumerate((("latency", "Speed"), ("reliability", "Reliability"),
                                          ("consistency", "Consistency"))):
            sl = QSlider(Qt.Orientation.Horizontal)
            sl.setRange(0, 100)
            sl.setValue(int(round(getattr(w, key) * 100)))
            val = label("", "secondary")
            sl.valueChanged.connect(self._weights_changed)
            sg.addWidget(label(title), i, 0)
            sg.addWidget(sl, i, 1)
            sg.addWidget(val, i, 2)
            self.sliders[key] = (sl, val)
        sg.setColumnStretch(1, 1)
        sc.add(sg)
        reset = QHBoxLayout()
        reset.addWidget(button("Reset to 50 / 30 / 20", None, self._reset_weights))
        reset.addStretch(1)
        sc.add(reset)
        self._weights_changed(save=False)
        col.addWidget(sc)

        # --- schedule
        sch = Card("Best DNS right now — automatic checks")
        sch.add(label("Run a quick benchmark in the background now and then, and get a notification only if a "
                      "different DNS becomes clearly faster. Uses Windows Task Scheduler; nothing runs constantly.",
                      "muted", wrap=True))
        srow = QHBoxLayout()
        self.sched_group = QButtonGroup(self)
        for key, text in (("disabled", "Disabled"), ("daily", "Daily"), ("weekly", "Weekly"), ("monthly", "Monthly")):
            rb = QRadioButton(text)
            rb.setProperty("key", key)
            rb.setChecked(s.schedule == key)
            self.sched_group.addButton(rb)
            srow.addWidget(rb)
        srow.addStretch(1)
        self.sched_group.buttonClicked.connect(self._schedule_changed)
        sch.add(srow)
        self.sched_msg = label("", "muted", wrap=True)
        sch.add(self.sched_msg)
        col.addWidget(sch)

        # --- appearance
        ap = Card("Appearance")
        arow = QHBoxLayout()
        self.theme = QComboBox()
        for key, text in (("system", "Match Windows"), ("dark", "Dark"), ("light", "Light")):
            self.theme.addItem(text, key)
        self.theme.setCurrentIndex(max(0, self.theme.findData(s.theme)))
        self.theme.currentIndexChanged.connect(self._theme_changed)
        arow.addWidget(label("Theme", "secondary"))
        arow.addWidget(self.theme)
        arow.addStretch(1)
        ap.add(arow)
        col.addWidget(ap)

        # --- windows dns
        self.win_card = Card("Windows DNS")
        self.win_body = QVBoxLayout()
        self.win_card.add(self.win_body)
        col.addWidget(self.win_card)
        self.refresh_windows()
        col.addStretch(1)

    # ------------------------------------------------------------------ helpers
    def _check(self, card: Card, text: str, value: bool) -> QCheckBox:
        cb = QCheckBox(text)
        cb.setChecked(value)
        cb.toggled.connect(self._save)
        card.add(cb)
        return cb

    def _save(self, *_: object) -> None:
        s = self.app.settings
        s.default_mode = self.mode.currentData()
        s.timeout_s = float(self.timeout.value())
        s.include_ipv6 = self.ipv6.isChecked()
        s.test_uncached = self.uncached.isChecked()
        s.include_dot = self.dot.isChecked()
        s.connectivity_check = self.ncsi.isChecked()
        s.save_history = self.save_hist.isChecked()
        self.app.save_settings()

    def _fill_providers(self) -> None:
        clear_layout(self.prov_grid)
        s = self.app.settings
        providers = s.all_providers(self.app.builtins)
        for i, p in enumerate(providers):
            cell = QHBoxLayout()
            cb = QCheckBox(p.name)
            cb.setChecked(s.is_enabled(p))
            tip = f"{', '.join(p.ipv4 + p.ipv6)}\n{p.description}"
            cb.setToolTip(tip)
            cb.toggled.connect(lambda on, pid=p.id: self._toggle_provider(pid, on))
            cell.addWidget(cb)
            for f in p.features[:2]:
                cell.addWidget(label(f.replace("-", " "), "tag"))
            if p.custom:
                cell.addWidget(button("Remove", "link", lambda _=False, pid=p.id: self._remove_custom(pid)))
            cell.addStretch(1)
            holder = QWidget()
            holder.setLayout(cell)
            self.prov_grid.addWidget(holder, i // 2, i % 2)

    def _toggle_provider(self, pid: str, on: bool) -> None:
        self.app.settings.provider_enabled[pid] = on
        self.app.save_settings()

    def _add_custom(self) -> None:
        s = self.app.settings
        try:
            p = make_custom_provider(self.c_name.text() or "Custom DNS", self.c_p.text(), self.c_s.text(),
                                     {x.id for x in s.all_providers(self.app.builtins)})
        except ProviderError as exc:
            QMessageBox.warning(self, "Can't add provider", str(exc))
            return
        s.custom_providers.append(p.to_dict())
        s.provider_enabled[p.id] = True
        self.app.save_settings()
        for w in (self.c_name, self.c_p, self.c_s):
            w.clear()
        self._fill_providers()
        self.app.toast(f"Added {p.name}")

    def _remove_custom(self, pid: str) -> None:
        s = self.app.settings
        s.custom_providers = [d for d in s.custom_providers if d.get("id") != pid]
        s.provider_enabled.pop(pid, None)
        self.app.save_settings()
        self._fill_providers()

    def _save_domains(self) -> None:
        pop, bad1 = domain_lists.parse_domain_list(self.dom_edit.toPlainText())
        game, bad2 = domain_lists.parse_domain_list(self.game_edit.toPlainText())
        if not pop or not game:
            self.dom_msg.setText("Each list needs at least one valid domain.")
            return
        s = self.app.settings
        s.domains = None if pop == domain_lists.POPULAR else pop
        s.gaming_domains = None if game == domain_lists.GAMING else game
        self.app.save_settings()
        bad = bad1 + bad2
        self.dom_msg.setText(f"Saved. Ignored invalid entries: {', '.join(bad[:6])}" if bad else
                             f"Saved {len(pop)} popular and {len(game)} gaming domains.")

    def _reset_domains(self) -> None:
        self.dom_edit.setPlainText("\n".join(domain_lists.POPULAR))
        self.game_edit.setPlainText("\n".join(domain_lists.GAMING))
        self._save_domains()

    def _weights_changed(self, *_: object, save: bool = True) -> None:
        raw = {k: sl.value() for k, (sl, _) in self.sliders.items()}
        total = sum(raw.values()) or 1
        for k, (_sl, val) in self.sliders.items():
            val.setText(f"{raw[k] / total * 100:.0f}%")
        if save:
            self.app.settings.weights = {k: v / total for k, v in raw.items()}
            self.app.save_settings()
            self.app.weights_changed()

    def _reset_weights(self) -> None:
        for k, v in (("latency", 50), ("reliability", 30), ("consistency", 20)):
            self.sliders[k][0].blockSignals(True)
            self.sliders[k][0].setValue(v)
            self.sliders[k][0].blockSignals(False)
        self._weights_changed()

    def _schedule_changed(self, rb) -> None:
        key = rb.property("key")
        ok, msg = self.app.set_schedule(key)
        self.sched_msg.setText(msg)
        if not ok:
            for b in self.sched_group.buttons():
                b.setChecked(b.property("key") == self.app.settings.schedule)

    def _theme_changed(self) -> None:
        self.app.settings.theme = self.theme.currentData()
        self.app.save_settings()
        self.app.apply_theme()

    def refresh_windows(self) -> None:
        clear_layout(self.win_body)
        if not self.app.can_change_dns():
            self.win_body.addWidget(label("Changing DNS settings is only available on Windows.", "muted"))
            return
        backups = self.app.dns_backups()
        if backups:
            for b in backups.values():
                self.win_body.addWidget(label(f"Saved original settings — {b.describe()}", "secondary", wrap=True))
            self.win_body.addWidget(button("Restore previous DNS", "primary", self.app.restore_dns))
        else:
            self.win_body.addWidget(label("This app hasn't changed your Windows DNS settings. If you use “Apply to "
                                          "Windows”, your original settings are saved here so you can restore them.",
                                          "muted", wrap=True))
