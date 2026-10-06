"""Dashboard: your current DNS, network information and the big TEST MY DNS button."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QGridLayout, QHBoxLayout, QVBoxLayout, QWidget

from ... import fmt
from ...engine import MODES
from ...providers import describe_server, provider_for_address
from ..widgets import Banner, Card, button, clear_layout, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow


class DashboardPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll, col = page_container()
        outer.addWidget(scroll)

        col.addWidget(label("Find the best DNS for your connection", "h1"))
        col.addWidget(label("Real DNS lookups from this computer, compared side by side. Nothing is changed unless you "
                            "ask.", "secondary", wrap=True))
        self.banners = QVBoxLayout()
        self.banners.setSpacing(8)
        col.addLayout(self.banners)

        row = QHBoxLayout()
        row.setSpacing(16)
        # Current DNS card
        self.current_card = Card()
        self.current_card.add(label("YOUR CURRENT DNS", "eyebrow"))
        self.cur_name = label("Detecting…", "big", wrap=True)
        self.current_card.add(self.cur_name)
        self.cur_servers = label("", "secondary", wrap=True, selectable=True)
        self.current_card.add(self.cur_servers)
        stats = QHBoxLayout()
        stats.setSpacing(32)
        self.cur_latency = self._mini_stat(stats, "Latency")
        self.cur_status = self._mini_stat(stats, "Status")
        stats.addStretch(1)
        self.current_card.add(stats)
        self.cur_upstream = label("", "muted", wrap=True)
        self.current_card.add(self.cur_upstream)
        self.current_card.body.addStretch(1)
        row.addWidget(self.current_card, 5)

        # Run card
        run = Card()
        run.add(label("RUN DNS BENCHMARK", "eyebrow"))
        run.add(label("Tests every major public DNS provider plus the DNS you use now, with real DNS queries.",
                      "secondary", wrap=True))
        self.cta = button("TEST MY DNS", "cta", lambda: self.app.start_benchmark("quick"))
        self.cta.setMinimumHeight(64)
        run.add(self.cta)
        run.add(label(MODES["quick"]["blurb"], "muted", wrap=True))
        alt = QHBoxLayout()
        self.full_btn = button("Full benchmark (≈3 min)", None, lambda: self.app.start_benchmark("full"),
                               MODES["full"]["blurb"])
        self.gaming_btn = button("Gaming DNS", None, lambda: self.app.start_benchmark("gaming"),
                                 MODES["gaming"]["blurb"] + " DNS affects connection set-up, not in-game ping.")
        alt.addWidget(self.full_btn)
        alt.addWidget(self.gaming_btn)
        alt.addStretch(1)
        run.add(alt)
        run.body.addStretch(1)
        row.addWidget(run, 4)
        col.addLayout(row)

        # Last result
        self.last_card = Card()
        self.last_layout = QHBoxLayout()
        self.last_card.add(self.last_layout)
        col.addWidget(self.last_card)

        # Network info
        net = Card("Your network")
        self.net_grid = QGridLayout()
        self.net_grid.setHorizontalSpacing(24)
        self.net_grid.setVerticalSpacing(8)
        net.add(self.net_grid)
        pub = QHBoxLayout()
        self.public_ip = label("Public IP: hidden", "secondary", selectable=True)
        pub.addWidget(self.public_ip)
        self.public_btn = button("Show", "link", self.app.lookup_public_ip,
                                 "Asks OpenDNS's resolver (myip.opendns.com) — a single DNS query. Off until you click.")
        pub.addWidget(self.public_btn)
        pub.addStretch(1)
        net.add(pub)
        col.addWidget(net)

        note = Card()
        note.add(label("Why test instead of just picking a famous DNS?", "h3"))
        note.add(label("The “best” DNS server is not the same for everyone. Speed depends on your ISP, where you are, "
                       "routing and peering, congestion, server load, caching, IPv4/IPv6 and even your router. This app "
                       "recommends a provider from measurements made on this computer and this connection — not from "
                       "global rankings.", "secondary", wrap=True))
        col.addWidget(note)
        col.addStretch(1)
        self.set_last(None)

    def _mini_stat(self, layout: QHBoxLayout, title: str):
        box = QVBoxLayout()
        box.setSpacing(0)
        box.addWidget(label(title, "muted"))
        value = label("…", "h2")
        box.addWidget(value)
        layout.addLayout(box)
        return value

    # ------------------------------------------------------------------ updates
    def set_busy(self, busy: bool) -> None:
        for b in (self.cta, self.full_btn, self.gaming_btn):
            b.setEnabled(not busy)

    def set_banners(self, items: list[tuple[str, str]]) -> None:
        clear_layout(self.banners)
        for level, text in items:
            self.banners.addWidget(Banner(level, text, closable=level == "info"))

    def set_network(self, network, probe: dict | None) -> None:
        if network is None:
            self.cur_name.setText("Detecting…")
            return
        servers = network.dns_servers
        if not servers:
            self.cur_name.setText("No DNS servers detected")
            self.cur_servers.setText(network.error or "Windows didn't report any DNS servers for the active connection.")
        else:
            known = [provider_for_address(self.app.builtins, s) for s in servers]
            names = sorted({p.display_name for p in known if p})
            if names and all(known):
                title = " + ".join(names)
            else:
                first_unknown = next(s for s, p in zip(servers, known) if p is None)
                title = f"Provided by {describe_server(first_unknown)}"
            self.cur_name.setText(title)
            self.cur_servers.setText("Servers: " + ", ".join(servers))
        if probe is None:
            self.cur_latency.setText("measuring…")
            self.cur_status.setText("…")
            self.cur_upstream.setText("")
        else:
            med = probe.get("median_ms")
            self.cur_latency.setText(fmt.ms(med) if med is not None else "—")
            if med is None:
                self.cur_status.setText("No answer")
                self.cur_status.setObjectName("bad")
            else:
                self.cur_status.setText("Connected")
                self.cur_status.setObjectName("good")
            self.cur_status.style().unpolish(self.cur_status)
            self.cur_status.style().polish(self.cur_status)
            up = probe.get("upstream_name") or probe.get("upstream_ip")
            self.cur_upstream.setText(
                f"Lookups are actually performed by {up}." if up else
                "Latency is the median of a few lookups of popular sites through your current DNS.")

        clear_layout(self.net_grid)
        a = network.active
        rows = [
            ("Connection", (a.connection_type if a else "Unknown") + (f" · {a.link_speed}" if a and a.link_speed else "")),
            ("Network adapter", (a.name + (f" ({a.description})" if a.description else "")) if a else "Not detected"),
            ("IPv4", "Yes" + (f" — {a.ipv4[0]}" if a and a.ipv4 else "") if network.has_ipv4 else "Not detected"),
            ("IPv6", "Has an IPv6 address (connectivity is checked during the test)" if network.has_global_ipv6
             else "No IPv6 address — IPv6 DNS servers will be skipped, not marked as failed"),
            ("Default gateway (router)", (a.gateway_v4 or a.gateway_v6 or "—") if a else "—"),
            ("VPN", f"{network.vpn.name} appears to be active" if network.vpn else "None detected"),
        ]
        for i, (k, v) in enumerate(rows):
            self.net_grid.addWidget(label(k, "muted"), i, 0, Qt.AlignmentFlag.AlignTop)
            self.net_grid.addWidget(label(v, wrap=True, selectable=True), i, 1)
        self.net_grid.setColumnStretch(1, 1)

    def set_public_ip(self, text: str) -> None:
        self.public_ip.setText(f"Public IP: {text}")
        self.public_btn.hide()

    def set_last(self, entry) -> None:
        clear_layout(self.last_layout)
        if entry is None:
            self.last_card.hide()
            return
        self.last_card.show()
        box = QVBoxLayout()
        box.addWidget(label("LAST TEST", "eyebrow"))
        winner = entry.winner_name or "No clear winner"
        demo = " (demo)" if entry.demo else ""
        box.addWidget(label(f"{fmt.when(entry.started_at)} — {winner}{demo}", "h3"))
        bits = []
        if entry.median_ms is not None:
            bits.append(f"{fmt.ms(entry.median_ms)} median")
        if entry.success_rate is not None:
            bits.append(f"{fmt.pct(entry.success_rate)} reliability")
        box.addWidget(label(" · ".join(bits), "secondary"))
        self.last_layout.addLayout(box, 1)
        self.last_layout.addWidget(button("View results", None, lambda: self.app.open_history_run(entry.run_id)),
                                   0, Qt.AlignmentFlag.AlignVCenter)
