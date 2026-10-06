"""Shared data types. Plain dataclasses so they serialise cleanly to JSON (history/export)."""

from __future__ import annotations

import ipaddress
from dataclasses import asdict, dataclass, field
from enum import Enum


class Family(str, Enum):
    V4 = "ipv4"
    V6 = "ipv6"

    @property
    def label(self) -> str:
        return "IPv4" if self is Family.V4 else "IPv6"


class Protocol(str, Enum):
    """How a query travels. ``UDP`` = classic DNS (UDP, retried over TCP when truncated) — what routers use."""

    UDP = "udp"
    TCP = "tcp"
    DOT = "dot"  # DNS over TLS (port 853)

    @property
    def label(self) -> str:
        return {"udp": "Standard DNS (UDP/TCP)", "tcp": "DNS over TCP", "dot": "DNS over TLS"}[self.value]


class QueryKind(str, Enum):
    CACHED = "cached"      # popular domain, almost certainly in the resolver's cache
    UNCACHED = "uncached"  # unique random name: the resolver must ask the authoritative servers


class Outcome(str, Enum):
    OK = "ok"
    TIMEOUT = "timeout"
    ERROR = "error"


def family_of(address: str) -> Family:
    host = address.split("%", 1)[0]
    return Family.V6 if ipaddress.ip_address(host).version == 6 else Family.V4


def is_valid_ip(address: str) -> bool:
    try:
        ipaddress.ip_address(address.split("%", 1)[0])
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class Target:
    """One server address tested with one protocol."""

    provider_id: str
    address: str
    family: Family
    role: str = "primary"  # primary / secondary / server 3 …
    protocol: Protocol = Protocol.UDP
    tls_hostname: str | None = None

    @property
    def id(self) -> str:
        return f"{self.provider_id}|{self.address}|{self.protocol.value}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["family"] = self.family.value
        d["protocol"] = self.protocol.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Target:
        return cls(
            provider_id=d["provider_id"],
            address=d["address"],
            family=Family(d["family"]),
            role=d.get("role", "primary"),
            protocol=Protocol(d.get("protocol", "udp")),
            tls_hostname=d.get("tls_hostname"),
        )


@dataclass
class QueryResult:
    """What a transport returns for a single query."""

    outcome: Outcome
    latency_ms: float | None = None
    rcode: str | None = None
    error_code: str | None = None  # see errors.ErrorCode
    detail: str | None = None      # technical detail, shown under "Technical details"
    via_tcp: bool = False
    answers: list[str] = field(default_factory=list)


@dataclass
class Sample:
    """One measured query, with timestamps."""

    target_id: str
    domain: str
    kind: QueryKind
    round: int
    started_at: float      # wall clock (epoch seconds)
    elapsed_s: float       # seconds since the benchmark started
    outcome: Outcome
    latency_ms: float | None = None
    rcode: str | None = None
    error_code: str | None = None
    detail: str | None = None
    via_tcp: bool = False

    @property
    def ok(self) -> bool:
        return self.outcome is Outcome.OK

    def to_dict(self) -> dict:
        d = asdict(self)
        d["kind"] = self.kind.value
        d["outcome"] = self.outcome.value
        if d["latency_ms"] is not None:
            d["latency_ms"] = round(d["latency_ms"], 3)
        d["started_at"] = round(d["started_at"], 3)
        d["elapsed_s"] = round(d["elapsed_s"], 3)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Sample:
        return cls(
            target_id=d["target_id"],
            domain=d["domain"],
            kind=QueryKind(d["kind"]),
            round=int(d["round"]),
            started_at=float(d["started_at"]),
            elapsed_s=float(d["elapsed_s"]),
            outcome=Outcome(d["outcome"]),
            latency_ms=d.get("latency_ms"),
            rcode=d.get("rcode"),
            error_code=d.get("error_code"),
            detail=d.get("detail"),
            via_tcp=bool(d.get("via_tcp", False)),
        )
