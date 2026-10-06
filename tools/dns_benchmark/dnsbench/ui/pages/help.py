"""Plain-English guides: method, scoring, router set-up, Windows vs router, gaming, privacy."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QTextBrowser, QVBoxLayout, QWidget

from ... import APP_NAME, __version__
from ..theme import tokens
from ..widgets import Card, label, page_container

if TYPE_CHECKING:
    from ..app import MainWindow

SECTIONS: list[tuple[str, str, str]] = [
    ("method", "How the test works", """
<p>The app sends <b>real DNS queries</b> — the same kind your browser triggers when you open a website — to each DNS
server, and times how long each answer takes. It does <b>not</b> use ping: ping measures a different service on the
server and can be fast while DNS is slow (or the other way round).</p>
<ul>
<li><b>Same work for everyone.</b> In each round, every server is asked about the same website, so no server gets an
easier question.</li>
<li><b>Random order.</b> The order of servers is shuffled every round, and the order of websites every run, so nobody
is always first or last.</li>
<li><b>Spread over time.</b> Rounds are spaced out (every 1.5–2.5 seconds), so a brief hiccup on your connection affects
all servers equally instead of ruining one server's result. Every query is time-stamped.</li>
<li><b>Cached and uncached.</b> Most lookups are popular sites, which a busy DNS server has already cached — that's
what you feel when browsing. Some lookups are unique random names (for example
<code>dnsbk3j9x0a2.wikipedia.org</code>) that nobody has asked for before, so the server must fetch the answer from the
internet — this measures cache misses. Both are shown separately in the details.</li>
<li><b>Warm-up.</b> Each server gets one unmeasured query first, so one-off connection set-up doesn't count.</li>
<li><b>Gentle.</b> At most four queries are in flight at once, never two to the same server, with a global rate limit.
A server that never answers is skipped after a few attempts.</li>
<li><b>Both addresses.</b> Primary and secondary addresses are both tested, because your router uses both.</li>
<li><b>IPv6</b> servers are tested separately, and only when IPv6 actually works on your connection.</li>
</ul>
<p><b>Quick test:</b> 16 rounds (32 queries per provider). <b>Full benchmark:</b> 60 rounds (120 per provider).</p>"""),
    ("scoring", "How the score works", """
<p>The winner is never chosen from a single fastest answer. Each provider gets a score out of 100:</p>
<ul>
<li><b>Speed (50%)</b> — the <i>typical</i> response time: mostly the median (the middle lookup), plus some of the
average so sustained slowness counts. Cached and uncached lookups are blended 70/30. Measured on a log scale, so going
from 10 to 20 ms costs as much as going from 50 to 100 ms.</li>
<li><b>Reliability (30%)</b> — the share of queries answered. Every 1% of failures or time-outs costs 10 points,
because a failed lookup can cost you seconds.</li>
<li><b>Consistency (20%)</b> — how far the slowest 10% sit above the typical time, minus a penalty for <i>slow
spikes</i> (lookups at least 3× the median and 50 ms slower).</li>
</ul>
<p>A provider can't be recommended if it answered fewer than 95% of queries while another answered 98% or more. If two
providers are within normal run-to-run variation, the app says so instead of pretending one is clearly better. You can
change the weights in Settings.</p>"""),
    ("router", "Set up your router", """
<p>Changing DNS on your router usually applies it to <b>every device</b> on your home network. Every router is different,
so these are general steps — this app never changes your router itself.</p>
<ol>
<li>Open your router's settings page in a web browser. The address is usually your <b>default gateway</b>, shown on the
Dashboard (often <code>192.168.0.1</code>, <code>192.168.1.1</code> or <code>192.168.1.254</code>).</li>
<li>Sign in. The admin password is often printed on a sticker on the router.</li>
<li>Look for <b>Internet</b>, <b>WAN</b>, <b>DNS</b>, <b>DHCP</b> or <b>LAN</b> settings. Some routers have two places:
<ul><li><i>WAN / Internet DNS</i> — the servers the router itself uses;</li>
<li><i>DHCP / LAN DNS</i> — the servers handed to your devices.</li></ul>
Setting either usually works; setting the DHCP/LAN one makes devices use the new servers directly.</li>
<li>Switch DNS from <i>automatic</i> to <i>manual</i>, and enter the <b>primary</b> and <b>secondary</b> addresses shown
on the Results page (use “Copy DNS”).</li>
<li>If there are separate <b>IPv6 DNS</b> fields and your connection has IPv6, enter the provider's IPv6 addresses
there too — otherwise devices may keep using your ISP's IPv6 DNS.</li>
<li>Save, then restart the router or reconnect your devices so they pick up the change.</li>
<li>Run the test again: the “Your current DNS” card should now show the new provider.</li>
</ol>
<p><b>Can't find a DNS setting?</b> Some ISP-supplied routers don't allow it. You can still set DNS on individual
devices (for example with “Apply to Windows” on this PC), or use your own router.</p>"""),
    ("windows", "Windows vs router", """
<p><b>Windows DNS</b> (“Apply to Windows”) affects <b>only this PC</b>. The app asks for administrator permission,
saves your current settings first, changes the DNS on your active network adapter, clears the DNS cache and checks
that Windows accepted the change. “Restore previous DNS” puts back exactly what you had — including “automatic” if
your router provided it.</p>
<p><b>Router DNS</b> usually affects <b>every device</b> on your network, but you have to change it yourself in the
router's settings (see “Set up your router”).</p>
<p>If you use a VPN, the VPN may override both.</p>"""),
    ("gaming", "Gaming and DNS", """
<p><b>DNS does not lower your in-game ping.</b> DNS turns a name like <code>steampowered.com</code> into an address.
Once your game is connected to a server, DNS is no longer involved in the gameplay connection.</p>
<p>DNS <i>can</i> affect: how quickly launchers and stores start up, logging in, finding matchmaking services, and which
download (CDN) server you are sent to. The Gaming test uses game platform, launcher and voice-chat domains to measure
exactly that — nothing more.</p>"""),
    ("privacy", "Privacy", """
<ul>
<li>Everything runs on this computer. No account, no adverts, no telemetry, nothing uploaded.</li>
<li>Results, history and settings are stored only on this PC (in <code>%APPDATA%\\DNS Benchmark</code>).</li>
<li>The test necessarily sends DNS queries to the providers being tested — that is the measurement. They see ordinary
lookups of popular websites and random test names, just like normal browsing.</li>
<li>Diagnostics send a few extra DNS queries: “who are you?” checks to Cloudflare, Quad9 and OpenDNS (to detect DNS
redirection), one to a reserved address that should never answer, one for a made-up name, and Google's
<code>o-o.myaddr.l.google.com</code> to see which resolver serves you.</li>
<li>The optional sign-in-page check fetches Windows' own test page (<code>www.msftconnecttest.com</code>), which Windows
already checks in the background. You can turn it off in Settings.</li>
<li>Your public IP is only looked up if you press “Show” (one DNS query to OpenDNS).</li>
</ul>"""),
]


class HelpPage(QWidget):
    def __init__(self, app: MainWindow) -> None:
        super().__init__()
        self.app = app
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self.scroll, col = page_container()
        outer.addWidget(self.scroll)
        col.addWidget(label("Learn", "h1"))
        col.addWidget(label("The best DNS server is not necessarily the same for everyone. It depends on your ISP, "
                            "location, routing, congestion, peering, server load, caching, IPv4/IPv6, VPN use and "
                            "router behaviour — which is why this app measures your connection instead of quoting "
                            "rankings.", "secondary", wrap=True))
        self.cards: dict[str, Card] = {}
        self.browsers: list[QTextBrowser] = []
        for key, title, html in SECTIONS:
            c = Card(title)
            tb = QTextBrowser()
            tb.setOpenExternalLinks(True)
            tb.setHtml(self._style(html))
            tb.document().setDocumentMargin(0)
            tb.setFixedHeight(10)
            tb.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            tb.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            self.browsers.append(tb)
            c.add(tb)
            col.addWidget(c)
            self.cards[key] = c
        col.addWidget(label(f"{APP_NAME} {__version__} · runs locally · no account · no telemetry", "muted"))
        col.addStretch(1)

    def _style(self, html: str) -> str:
        t = tokens()
        return (f"<style>body{{color:{t.text_2};}} b{{color:{t.text};}} li{{margin-bottom:4px;}} "
                f"code{{color:{t.text};}}</style>{html}")

    def resizeEvent(self, e) -> None:  # noqa: N802
        super().resizeEvent(e)
        self._fit()

    def showEvent(self, e) -> None:  # noqa: N802
        super().showEvent(e)
        self._fit()

    def _fit(self) -> None:
        for tb in self.browsers:
            tb.document().setTextWidth(max(200, tb.viewport().width()))
            tb.setFixedHeight(int(tb.document().size().height()) + 24)

    def restyle(self) -> None:
        for tb, (_, _, html) in zip(self.browsers, SECTIONS):
            tb.setHtml(self._style(html))
        self._fit()

    def show_section(self, key: str | None) -> None:
        if key and key in self.cards:
            self._fit()
            self.scroll.ensureWidgetVisible(self.cards[key], 0, 0)
            self.scroll.verticalScrollBar().setValue(self.cards[key].y())
