"""Pre-flight checks run before every benchmark.

* IPv4 / IPv6: is there a route, and do well-known DNS servers actually answer over it? IPv6 servers are only
  benchmarked when IPv6 works, so a missing IPv6 connection never makes a provider look broken.
* Internet / firewall: if your current DNS works but no public DNS server answers, something (router, ISP,
  firewall) blocks outbound DNS.
* Captive portal (optional): fetches Windows' own connectivity-test page (www.msftconnecttest.com — the same
  URL Windows checks in the background). If it doesn't return the expected text, a hotel/café login page is
  probably intercepting traffic.
* DNS interception: asks Cloudflare, Quad9 and OpenDNS "who are you?" questions only their real servers
  answer correctly, and sends one query to 192.0.2.1 (a reserved address with no DNS server). If those come
  back wrong — or the reserved address answers — something between you and the internet is redirecting DNS,
  so "Cloudflare" results may really be your router's or ISP's resolver.
* NXDOMAIN redirection: looks up a made-up name; if your current DNS returns an address instead of "doesn't
  exist", your ISP rewrites failed lookups (often to an advert/search page).
* Upstream resolver: asks Google's ``o-o.myaddr.l.google.com`` which resolver actually performed the lookup
  — handy when Windows only shows your router's address.
"""

from __future__ import annotations

import asyncio
import ipaddress
import random
import re
import socket
import urllib.request
from dataclasses import asdict, dataclass, field

import dns.reversename

from .domains import random_label
from .models import Family, Outcome, Protocol, Target, family_of
from .transport import Transport

ANCHORS_V4 = ["1.1.1.1", "8.8.8.8", "9.9.9.9"]
ANCHORS_V6 = ["2606:4700:4700::1111", "2001:4860:4860::8888", "2620:fe::fe"]
BOGUS_RESOLVER = "192.0.2.1"  # TEST-NET-1 (RFC 5737): never a real DNS server
NCSI_URL = "http://www.msftconnecttest.com/connecttest.txt"
NCSI_TEXT = "Microsoft Connect Test"


@dataclass
class IdentityCheck:
    provider: str
    server: str
    result: str  # pass / fail / inconclusive
    detail: str


@dataclass
class Preflight:
    ipv4: str = "unknown"   # available / no_route / not_working
    ipv6: str = "unknown"   # available / no_route / not_working / disabled
    internet: bool = False
    current_dns_working: bool | None = None
    public_dns_blocked: bool = False
    captive_portal: bool | None = None
    interception_suspected: bool = False
    bogus_resolver_answered: bool = False
    identity_checks: list[IdentityCheck] = field(default_factory=list)
    nxdomain_redirect: bool | None = None
    upstream_resolver: str | None = None
    upstream_name: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Preflight:
        p = cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__ and k != "identity_checks"})
        p.identity_checks = [IdentityCheck(**c) for c in d.get("identity_checks", [])]
        return p

    def technical_lines(self) -> list[str]:
        """The evidence behind the notes, for "Technical details" and the TXT report."""
        names = {"cloudflare": "Cloudflare", "quad9": "Quad9", "opendns": "OpenDNS"}
        out = [f"IPv4: {self.ipv4} · IPv6: {self.ipv6} · current DNS answering: {self.current_dns_working}"]
        for c in self.identity_checks:
            out.append(f"Identity check {names.get(c.provider, c.provider)} ({c.server}): {c.result} — {c.detail}")
        out.append(f"Reserved address {BOGUS_RESOLVER} answered: {'yes' if self.bogus_resolver_answered else 'no'}")
        if self.nxdomain_redirect is not None:
            out.append(f"Made-up name returned an address (NXDOMAIN redirection): "
                       f"{'yes' if self.nxdomain_redirect else 'no'}")
        if self.captive_portal is not None:
            out.append(f"Sign-in page detected: {'yes' if self.captive_portal else 'no'}")
        if self.upstream_resolver:
            out.append(f"Upstream resolver: {self.upstream_resolver}"
                       + (f" ({self.upstream_name})" if self.upstream_name else ""))
        return out

    def warnings(self) -> list[tuple[str, str]]:
        """(level, plain-English message) pairs for the UI. level: error / warning / info."""
        out: list[tuple[str, str]] = []
        if not self.internet:
            out.append(("error", "No internet connection was detected — no DNS server answered. Check that you're "
                                 "connected and try again."))
        elif self.public_dns_blocked:
            out.append(("warning", "Your current DNS works, but public DNS servers can't be reached. Your router, "
                                   "ISP or a firewall may be blocking outbound DNS (port 53) — changing DNS may not "
                                   "work on this network."))
        if self.captive_portal:
            out.append(("warning", "This network seems to need a sign-in (a hotel, café or guest Wi-Fi login page). "
                                   "Sign in through your browser, then test again."))
        if self.interception_suspected:
            out.append(("warning", "DNS redirection detected: queries addressed to public DNS servers seem to be "
                                   "answered by something else (often your router or ISP). Results for public "
                                   "providers may really reflect that other resolver, and changing DNS may have no "
                                   "effect until the redirection is turned off."))
        if self.nxdomain_redirect:
            out.append(("info", "Your current DNS returns an address for websites that don't exist (NXDOMAIN "
                                "redirection). This is usually an ISP search/advert feature."))
        if self.ipv6 in ("no_route", "not_working"):
            out.append(("info", "IPv6 testing is unavailable on this connection, so only IPv4 DNS servers were "
                                "tested. This is normal for many home connections and is not a fault of any provider."))
        return out


def has_route(address: str) -> bool:
    fam = socket.AF_INET6 if ":" in address else socket.AF_INET
    try:
        with socket.socket(fam, socket.SOCK_DGRAM) as s:
            s.connect((address, 53))  # UDP connect: route lookup only, nothing is sent
        return True
    except OSError:
        return False


def _t(address: str, provider: str = "diag") -> Target:
    return Target(provider, address, family_of(address), "diag", Protocol.UDP)


async def _any_answers(transport: Transport, servers: list[str], timeout: float) -> bool:
    results = await asyncio.gather(*(transport.query(_t(s), "example.com", "A", timeout) for s in servers))
    return any(r.outcome is Outcome.OK for r in results)


async def check_family(transport: Transport, family: Family, timeout: float = 2.0) -> str:
    anchors = ANCHORS_V4 if family is Family.V4 else ANCHORS_V6
    if not any(has_route(a) for a in anchors):
        return "no_route"
    return "available" if await _any_answers(transport, anchors, timeout) else "not_working"


_TXT = re.compile(r'"([^"]*)"')


def _txt_strings(answers: list[str]) -> list[str]:
    out: list[str] = []
    for a in answers:
        out.extend(_TXT.findall(a) or [a])
    return out


def judge_identity(provider: str, rcode: str | None, outcome: Outcome, answers: list[str]) -> tuple[str, str]:
    """Pure: decide whether an identity answer really came from ``provider``."""
    if outcome is Outcome.TIMEOUT:
        return "inconclusive", "No reply"
    if outcome is not Outcome.OK:
        return "fail", f"Answered {rcode or 'with an error'} instead of identifying itself"
    txt = _txt_strings(answers)
    joined = " | ".join(txt) or "(empty answer)"
    if provider == "cloudflare":
        ok = any(re.fullmatch(r"[A-Z]{3}", t.strip()) for t in txt)
    elif provider == "quad9":
        ok = any(("pch.net" in t or "quad9" in t.lower()) for t in txt)
    elif provider == "opendns":
        ok = any(t.startswith("server ") for t in txt)
    else:
        ok = bool(txt)
    return ("pass" if ok else "fail"), joined


IDENTITY_PROBES = [
    ("cloudflare", "1.1.1.1", "id.server", "TXT", "CH"),
    ("quad9", "9.9.9.9", "id.server", "TXT", "CH"),
    ("opendns", "208.67.222.222", "debug.opendns.com", "TXT", "IN"),
]


async def check_interception(transport: Transport, timeout: float = 2.0) -> tuple[bool, bool, list[IdentityCheck]]:
    async def probe(provider: str, server: str, name: str, rdtype: str, rdclass: str) -> IdentityCheck:
        r = await transport.query(_t(server), name, rdtype, timeout, rdclass)
        result, detail = judge_identity(provider, r.rcode, r.outcome, r.answers)
        return IdentityCheck(provider, server, result, detail)

    checks_task = asyncio.gather(*(probe(*p) for p in IDENTITY_PROBES))
    bogus_task = transport.query(_t(BOGUS_RESOLVER), "example.com", "A", min(timeout, 1.5))
    checks, bogus = await asyncio.gather(checks_task, bogus_task)
    bogus_answered = bogus.outcome is Outcome.OK or bogus.rcode is not None
    fails = sum(1 for c in checks if c.result == "fail")
    return (bogus_answered or fails >= 2), bogus_answered, list(checks)


async def check_nxdomain_redirect(transport: Transport, server: str, timeout: float = 2.0) -> bool | None:
    name = f"{random_label(random.Random())}-nonexistent.com"
    r = await transport.query(_t(server), name, "A", timeout)
    if r.outcome is not Outcome.OK:
        return None
    return r.rcode == "NOERROR" and bool(r.answers)


async def upstream_resolver(transport: Transport, server: str, timeout: float = 2.0) -> tuple[str | None, str | None]:
    r = await transport.query(_t(server), "o-o.myaddr.l.google.com", "TXT", timeout)
    if r.outcome is not Outcome.OK:
        return None, None
    ip = None
    for t in _txt_strings(r.answers):
        try:
            ip = str(ipaddress.ip_address(t.strip()))
            break
        except ValueError:
            continue
    if ip is None:
        return None, None
    ptr = await transport.query(_t(server), dns.reversename.from_address(ip).to_text(), "PTR", timeout)
    name = ptr.answers[0].rstrip(".") if ptr.outcome is Outcome.OK and ptr.answers else None
    return ip, name


def captive_portal_check(timeout: float = 4.0) -> bool | None:
    """True = portal suspected, False = clean internet, None = couldn't tell."""
    try:
        req = urllib.request.Request(NCSI_URL, headers={"User-Agent": "Microsoft NCSI"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed http URL by design
            body = resp.read(256).decode("utf-8", "replace").strip()
        return body != NCSI_TEXT
    except Exception:  # noqa: BLE001
        return None


async def run_preflight(transport: Transport, current_dns: list[str], *, include_ipv6: bool = True,
                        connectivity_check: bool = True, timeout: float = 2.0) -> Preflight:
    pf = Preflight()
    current_v4 = [s for s in current_dns if family_of(s) is Family.V4]
    first_current = (current_v4 or current_dns or [None])[0]

    v4_task = check_family(transport, Family.V4, timeout)
    v6_task = check_family(transport, Family.V6, timeout) if include_ipv6 else asyncio.sleep(0, "disabled")
    current_task = (_any_answers(transport, current_dns, timeout) if current_dns else asyncio.sleep(0, None))
    portal_task = (asyncio.to_thread(captive_portal_check) if connectivity_check else asyncio.sleep(0, None))
    pf.ipv4, pf.ipv6, pf.current_dns_working, pf.captive_portal = await asyncio.gather(
        v4_task, v6_task, current_task, portal_task)

    pf.internet = pf.ipv4 == "available" or pf.ipv6 == "available" or bool(pf.current_dns_working)
    pf.public_dns_blocked = bool(pf.current_dns_working) and pf.ipv4 != "available" and pf.ipv6 != "available"
    if pf.internet:
        tasks = [check_interception(transport, timeout)]
        if first_current:
            tasks += [check_nxdomain_redirect(transport, first_current, timeout),
                      upstream_resolver(transport, first_current, timeout)]
        res = await asyncio.gather(*tasks)
        pf.interception_suspected, pf.bogus_resolver_answered, pf.identity_checks = res[0]
        if first_current:
            pf.nxdomain_redirect = res[1]
            pf.upstream_resolver, pf.upstream_name = res[2]
    return pf


async def public_ip(transport: Transport, timeout: float = 2.0) -> str | None:
    """Your public IPv4 address via OpenDNS's ``myip.opendns.com`` (a DNS query — no website involved).
    Only called when you press "Show public IP"."""
    r = await transport.query(_t("208.67.222.222"), "myip.opendns.com", "A", timeout)
    if r.outcome is Outcome.OK and r.answers:
        try:
            return str(ipaddress.ip_address(r.answers[0]))
        except ValueError:
            return None
    return None
