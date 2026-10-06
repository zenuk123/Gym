"""Test mode: a fake transport with configurable latency profiles.

Used by the automated tests (to prove the scoring picks the right winner) and by ``--demo`` (to explore the UI
without a network). Demo runs are always labelled as simulated in the UI, exports and history.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass

from .diagnostics import BOGUS_RESOLVER
from .errors import ErrorCode
from .models import Family, Outcome, QueryResult, Target
from .network import AdapterInfo, NetworkInfo


@dataclass
class LatencyProfile:
    base_ms: float
    jitter_ms: float = 1.0
    spike_prob: float = 0.0
    spike_ms: float = 120.0
    timeout_prob: float = 0.0
    error_prob: float = 0.0
    error_code: str = ErrorCode.SERVFAIL
    uncached_extra_ms: float = 25.0
    unreachable: bool = False


class FakeTransport:
    def __init__(self, profiles: dict[str, LatencyProfile], default: LatencyProfile | None = None,
                 seed: int | None = 0, realtime: bool = False, time_scale: float = 1.0) -> None:
        self.profiles = profiles
        self.default = default or LatencyProfile(30.0, 3.0)
        self.rng = random.Random(seed)
        self.realtime = realtime
        self.time_scale = time_scale
        self.queries: list[tuple[str, str]] = []

    def _profile(self, target: Target) -> LatencyProfile:
        return self.profiles.get(target.address) or self.profiles.get(target.provider_id) or self.default

    async def _wait(self, ms: float) -> None:
        if self.realtime:
            await asyncio.sleep(ms / 1000.0 * self.time_scale)
        else:
            await asyncio.sleep(0)

    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult:
        self.queries.append((target.address, qname))
        special = self._special(target, qname, rdtype)
        if special is not None:
            await self._wait(5)
            return special
        p = self._profile(target)
        r = self.rng.random()
        if p.unreachable or r < p.timeout_prob:
            await self._wait(timeout * 1000)
            return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, f"No reply within {timeout:g}s (simulated)")
        ms = max(0.3, self.rng.gauss(p.base_ms, p.jitter_ms))
        if qname.startswith("dnsb"):
            ms += p.uncached_extra_ms * (0.5 + self.rng.random())
        if self.rng.random() < p.spike_prob:
            ms += p.spike_ms * (0.5 + self.rng.random())
        if ms / 1000.0 >= timeout:
            await self._wait(timeout * 1000)
            return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, "No reply (simulated)")
        await self._wait(ms)
        if self.rng.random() < p.error_prob:
            return QueryResult(Outcome.ERROR, ms, "SERVFAIL", p.error_code, "Simulated server failure")
        rcode = "NXDOMAIN" if qname.startswith("dnsb") else "NOERROR"
        return QueryResult(Outcome.OK, ms, rcode, answers=[] if rcode == "NXDOMAIN" else ["192.0.2.80"])

    def _special(self, target: Target, qname: str, rdtype: str) -> QueryResult | None:
        """Answers for the diagnostic probes, as an honest, non-intercepted network would give them."""
        if target.address == BOGUS_RESOLVER:
            return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, "No reply (simulated)")
        if qname == "id.server":
            ans = {"1.1.1.1": '"LHR"', "9.9.9.9": '"res100.lhr.rrdns.pch.net"'}.get(target.address)
            return QueryResult(Outcome.OK, 5, "NOERROR", answers=[ans] if ans else [])
        if qname == "debug.opendns.com":
            return QueryResult(Outcome.OK, 5, "NOERROR", answers=['"server m12.lon"'])
        if qname == "o-o.myaddr.l.google.com":
            return QueryResult(Outcome.OK, 5, "NOERROR", answers=['"203.0.113.53"'])
        if rdtype == "PTR":
            return QueryResult(Outcome.OK, 5, "NOERROR", answers=["resolver1.example-isp.net."])
        if qname.endswith("-nonexistent.com"):
            return QueryResult(Outcome.OK, 5, "NXDOMAIN")
        if qname == "myip.opendns.com":
            return QueryResult(Outcome.OK, 5, "NOERROR", answers=["203.0.113.7"])
        return None

    async def close(self) -> None:
        return None


def demo_profiles(seed: int | None = None) -> dict[str, LatencyProfile]:
    """Plausible but *simulated* profiles. Re-randomised every demo run so no provider is a fixed winner."""
    rng = random.Random(seed)
    ids = ["cloudflare", "google", "quad9", "adguard", "opendns", "controld", "dnssb", "dns4eu", "cleanbrowsing",
           "current"]
    out = {}
    for pid in ids:
        base = rng.uniform(9, 45)
        out[pid] = LatencyProfile(base, jitter_ms=rng.uniform(0.5, 4), spike_prob=rng.choice([0, 0, 0.02, 0.08]),
                                  spike_ms=rng.uniform(60, 200), timeout_prob=rng.choice([0, 0, 0, 0.01, 0.04]),
                                  uncached_extra_ms=rng.uniform(10, 60))
    return out


def demo_network() -> NetworkInfo:
    a = AdapterInfo(index=12, name="Wi-Fi", description="Simulated wireless adapter", connection_type="Wi-Fi",
                    link_speed="866.7 Mbps", ipv4=["192.168.1.23"], ipv6=[], gateway_v4="192.168.1.1",
                    dns_v4=["192.168.1.1"], route_metric=35, ipv4_connectivity="Internet",
                    ipv6_connectivity="NoTraffic")
    return NetworkInfo("demo", [a], a)


def demo_family_ok(family: Family) -> bool:
    return family is Family.V4
