"""Statistics engine (pure functions, no I/O)."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

from .models import Outcome, QueryKind, Sample


def percentile(sorted_values: list[float], p: float) -> float:
    """Linear-interpolated percentile (same as numpy's default). ``sorted_values`` must be sorted, non-empty."""
    if not sorted_values:
        raise ValueError("percentile of empty list")
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * p / 100.0
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_values[lo]
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def spike_threshold(median_ms: float) -> float:
    """A response counts as a *slow spike* when it is both 3× the median and at least 50 ms over it."""
    return max(3.0 * median_ms, median_ms + 50.0)


@dataclass
class LatencyStats:
    count: int
    mean: float
    median: float
    min: float
    max: float
    stdev: float
    p10: float
    p25: float
    p75: float
    p90: float
    spikes: int  # responses above spike_threshold(median)

    @property
    def iqr(self) -> float:
        return self.p75 - self.p25

    @property
    def spike_rate(self) -> float:
        return self.spikes / self.count if self.count else 0.0

    def to_dict(self) -> dict:
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def latency_stats(values: list[float]) -> LatencyStats | None:
    if not values:
        return None
    v = sorted(values)
    n = len(v)
    mean = sum(v) / n
    stdev = math.sqrt(sum((x - mean) ** 2 for x in v) / (n - 1)) if n > 1 else 0.0
    median = percentile(v, 50)
    thr = spike_threshold(median)
    return LatencyStats(
        count=n, mean=mean, median=median, min=v[0], max=v[-1], stdev=stdev,
        p10=percentile(v, 10), p25=percentile(v, 25), p75=percentile(v, 75), p90=percentile(v, 90),
        spikes=sum(1 for x in v if x > thr),
    )


@dataclass
class GroupStats:
    """Aggregated results for one group of samples (a server, or a provider's servers in one family)."""

    total: int = 0
    ok: int = 0
    timeouts: int = 0
    errors: int = 0
    tcp_fallbacks: int = 0
    latency: LatencyStats | None = None
    cached: LatencyStats | None = None
    uncached: LatencyStats | None = None
    error_codes: dict[str, int] = field(default_factory=dict)

    @property
    def success_rate(self) -> float:
        return self.ok / self.total if self.total else 0.0

    @property
    def timeout_rate(self) -> float:
        return self.timeouts / self.total if self.total else 0.0

    @property
    def error_rate(self) -> float:
        return self.errors / self.total if self.total else 0.0

    @property
    def failures(self) -> int:
        return self.timeouts + self.errors

    @property
    def unreachable(self) -> bool:
        return self.total > 0 and self.ok == 0

    @property
    def main_error(self) -> str | None:
        if not self.error_codes:
            return None
        return max(self.error_codes, key=lambda k: self.error_codes[k])

    def to_dict(self) -> dict:
        return {
            "total": self.total, "ok": self.ok, "timeouts": self.timeouts, "errors": self.errors,
            "tcp_fallbacks": self.tcp_fallbacks, "success_rate": round(self.success_rate, 4),
            "latency": self.latency.to_dict() if self.latency else None,
            "cached": self.cached.to_dict() if self.cached else None,
            "uncached": self.uncached.to_dict() if self.uncached else None,
            "error_codes": dict(self.error_codes),
        }


def group_stats(samples: list[Sample]) -> GroupStats:
    g = GroupStats(total=len(samples))
    all_ms: list[float] = []
    cached: list[float] = []
    uncached: list[float] = []
    codes: Counter[str] = Counter()
    for s in samples:
        if s.outcome is Outcome.OK and s.latency_ms is not None:
            g.ok += 1
            all_ms.append(s.latency_ms)
            (cached if s.kind is QueryKind.CACHED else uncached).append(s.latency_ms)
            if s.via_tcp:
                g.tcp_fallbacks += 1
        elif s.outcome is Outcome.TIMEOUT:
            g.timeouts += 1
            codes[s.error_code or "timeout"] += 1
        else:
            g.errors += 1
            codes[s.error_code or "other"] += 1
    g.latency = latency_stats(all_ms)
    g.cached = latency_stats(cached)
    g.uncached = latency_stats(uncached)
    g.error_codes = dict(codes)
    return g
