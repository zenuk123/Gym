"""A finished benchmark run (what gets saved to history) and its analysis (recomputed on load, so changing the
scoring weights re-ranks old runs too)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from . import __version__
from .models import Family, Protocol, Sample, Target
from .providers import Provider
from .scoring import Ranked, Recommendation, Weights, rank, recommend
from .stats import GroupStats, group_stats


@dataclass
class BenchmarkRun:
    started_at: float
    finished_at: float
    mode: str
    config: dict
    providers: list[Provider]
    targets: list[Target]
    samples: list[Sample]
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    cancelled: bool = False
    demo: bool = False
    ipv4_status: str = "available"
    ipv6_status: str = "unknown"
    network: dict = field(default_factory=dict)
    diagnostics: dict = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)
    app_version: str = __version__

    def provider(self, pid: str) -> Provider | None:
        return next((p for p in self.providers if p.id == pid), None)

    def target(self, tid: str) -> Target | None:
        return next((t for t in self.targets if t.id == tid), None)

    @property
    def duration_s(self) -> float:
        return max(0.0, self.finished_at - self.started_at)

    def to_dict(self) -> dict:
        return {
            "format": "dns-benchmark-run", "format_version": 1, "id": self.id, "app_version": self.app_version,
            "started_at": self.started_at, "finished_at": self.finished_at, "mode": self.mode,
            "cancelled": self.cancelled, "demo": self.demo, "config": self.config,
            "ipv4_status": self.ipv4_status, "ipv6_status": self.ipv6_status,
            "network": self.network, "diagnostics": self.diagnostics, "skipped": self.skipped,
            "providers": [p.to_dict() for p in self.providers],
            "targets": [t.to_dict() for t in self.targets],
            "samples": [s.to_dict() for s in self.samples],
        }

    @classmethod
    def from_dict(cls, d: dict) -> BenchmarkRun:
        if d.get("format") != "dns-benchmark-run":
            raise ValueError("Not a DNS Benchmark result file.")
        return cls(
            id=d["id"], app_version=d.get("app_version", "?"), started_at=float(d["started_at"]),
            finished_at=float(d["finished_at"]), mode=d.get("mode", "quick"), cancelled=bool(d.get("cancelled")),
            demo=bool(d.get("demo")), config=d.get("config", {}), ipv4_status=d.get("ipv4_status", "available"),
            ipv6_status=d.get("ipv6_status", "unknown"), network=d.get("network", {}),
            diagnostics=d.get("diagnostics", {}), skipped=d.get("skipped", {}),
            providers=[Provider.from_dict(p) for p in d.get("providers", [])],
            targets=[Target.from_dict(t) for t in d.get("targets", [])],
            samples=[Sample.from_dict(s) for s in d.get("samples", [])],
        )


@dataclass(frozen=True)
class View:
    id: str
    label: str
    family: Family
    protocol: Protocol


VIEWS = [
    View("ipv4", "IPv4", Family.V4, Protocol.UDP),
    View("ipv6", "IPv6", Family.V6, Protocol.UDP),
    View("dot", "Encrypted (DoT)", Family.V4, Protocol.DOT),
]


def group_key(provider_id: str, family: Family, protocol: Protocol) -> str:
    return f"{provider_id}|{family.value}|{protocol.value}"


@dataclass
class Analysis:
    run: BenchmarkRun
    weights: Weights
    views: dict[str, list[Ranked]]          # view id → ranking
    target_stats: dict[str, GroupStats]     # per server address
    recommendations: dict[str, Recommendation | None]
    primary_view: str

    @property
    def recommendation(self) -> Recommendation | None:
        return self.recommendations.get(self.primary_view)

    def ranking(self, view: str | None = None) -> list[Ranked]:
        return self.views.get(view or self.primary_view, [])

    def samples_for(self, provider_id: str, family: Family | None = None,
                    protocol: Protocol | None = None) -> list[Sample]:
        ids = {t.id for t in self.run.targets if t.provider_id == provider_id
               and (family is None or t.family is family) and (protocol is None or t.protocol is protocol)}
        return [s for s in self.run.samples if s.target_id in ids]

    def targets_for(self, provider_id: str) -> list[Target]:
        return [t for t in self.run.targets if t.provider_id == provider_id]


def analyse(run: BenchmarkRun, weights: Weights | None = None) -> Analysis:
    weights = weights or Weights()
    by_target: dict[str, list[Sample]] = {}
    for s in run.samples:
        by_target.setdefault(s.target_id, []).append(s)
    target_stats = {t.id: group_stats(by_target.get(t.id, [])) for t in run.targets}

    views: dict[str, list[Ranked]] = {}
    recs: dict[str, Recommendation | None] = {}
    for v in VIEWS:
        groups: dict[str, list[Sample]] = {}
        for t in run.targets:
            if t.family is v.family and t.protocol is v.protocol:
                groups.setdefault(t.provider_id, []).extend(by_target.get(t.id, []))
        entries: list[Ranked] = []
        for pid, samples in groups.items():
            if not samples:
                continue
            p = run.provider(pid)
            if p is None:
                continue
            gs = group_stats(samples)
            entries.append(Ranked(group_key(pid, v.family, v.protocol), pid, p.display_name, gs,
                                  score=None, is_current=p.is_current))  # type: ignore[arg-type]
        if entries:
            views[v.id] = rank(entries, weights)
            recs[v.id] = recommend(views[v.id])
    primary = "ipv4" if "ipv4" in views else ("ipv6" if "ipv6" in views else "ipv4")
    return Analysis(run, weights, views, target_stats, recs, primary)
