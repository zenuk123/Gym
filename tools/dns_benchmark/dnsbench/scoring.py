"""Scoring engine: turns statistics into a 0–100 score, a ranking and a plain-English recommendation.

Score = weighted mix (default 50 / 30 / 20) of three sub-scores, each 0–100:

* **Speed** — from the *typical response time*: 0.7 × median + 0.3 × average (median resists one-off
  blips, the average still feels sustained slowness), blended across cached and uncached lookups. Mapped on a
  log scale: ≤ 5 ms = 100, 1000 ms = 0 (so 10 → 20 ms costs as much as 50 → 100 ms — matching how people
  perceive delay).
* **Reliability** — 100 − 10 points per 1 % of failed or timed-out queries (90 % success = 0). A DNS
  failure costs seconds, so it is punished hard.
* **Consistency** — how far the slow tail (90th percentile) sits above the median, on a log scale (0 ms = 100,
  200 ms = 0), minus 2 points per 1 % of *slow spikes* (≥ 3× median and ≥ 50 ms over it).

The winner must also have enough successful answers and, if any server managed ≥ 98 % success, at least 95 %
itself — so a fast-but-flaky server can never be recommended over a dependable one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .stats import GroupStats, LatencyStats

LAT_BEST_MS = 5.0
LAT_WORST_MS = 1000.0
SPREAD_WORST_MS = 200.0
MIN_SUCCESSFUL = 5
RELIABLE_BAR = 0.98
MIN_SUCCESS_IF_OTHERS_RELIABLE = 0.95


@dataclass
class Weights:
    latency: float = 0.5
    reliability: float = 0.3
    consistency: float = 0.2
    uncached_share: float = 0.3  # how much cache-miss speed counts inside "speed"

    def normalised(self) -> Weights:
        total = self.latency + self.reliability + self.consistency
        if total <= 0:
            return Weights()
        return Weights(self.latency / total, self.reliability / total, self.consistency / total,
                       min(max(self.uncached_share, 0.0), 1.0))

    def to_dict(self) -> dict:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: dict | None) -> Weights:
        if not d:
            return cls()
        w = cls()
        for k in ("latency", "reliability", "consistency", "uncached_share"):
            if k in d:
                try:
                    setattr(w, k, max(0.0, float(d[k])))
                except (TypeError, ValueError):
                    pass
        return w


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _typical(ls: LatencyStats) -> float:
    return 0.7 * ls.median + 0.3 * ls.mean


def typical_ms(stats: GroupStats, uncached_share: float = 0.3) -> float | None:
    """Typical response time used for scoring (see module docstring)."""
    if stats.cached and stats.uncached:
        return (1 - uncached_share) * _typical(stats.cached) + uncached_share * _typical(stats.uncached)
    ls = stats.cached or stats.uncached or stats.latency
    return _typical(ls) if ls else None


def latency_score(ms: float) -> float:
    if ms <= LAT_BEST_MS:
        return 100.0
    return _clamp(100.0 * (1 - math.log(ms / LAT_BEST_MS) / math.log(LAT_WORST_MS / LAT_BEST_MS)))


def reliability_score(success_rate: float) -> float:
    return _clamp(100.0 * (1 - 10.0 * (1 - success_rate)))


def consistency_score(ls: LatencyStats | None) -> float:
    if ls is None:
        return 0.0
    spread = max(0.0, ls.p90 - ls.median)
    base = 100.0 * (1 - math.log1p(spread / 5.0) / math.log1p(SPREAD_WORST_MS / 5.0))
    return _clamp(base - 200.0 * ls.spike_rate)


@dataclass
class Score:
    total: float
    latency: float
    reliability: float
    consistency: float
    typical_ms: float | None

    def to_dict(self) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def score(stats: GroupStats, weights: Weights | None = None) -> Score:
    w = (weights or Weights()).normalised()
    t = typical_ms(stats, w.uncached_share)
    if t is None or stats.ok == 0:
        return Score(0.0, 0.0, 0.0, 0.0, None)
    ls, rs, cs = latency_score(t), reliability_score(stats.success_rate), consistency_score(stats.latency)
    return Score(w.latency * ls + w.reliability * rs + w.consistency * cs, ls, rs, cs, t)


@dataclass
class Ranked:
    key: str            # group key, e.g. "cloudflare|ipv4|udp"
    provider_id: str
    name: str
    stats: GroupStats
    score: Score
    eligible: bool = True
    reason: str | None = None  # why not eligible
    is_current: bool = False
    rank: int = 0


def rank(entries: list[Ranked], weights: Weights | None = None) -> list[Ranked]:
    """Score, apply eligibility rules and sort best-first. Mutates and returns the entries."""
    for e in entries:
        e.score = score(e.stats, weights)
        e.eligible, e.reason = True, None
        if e.stats.total == 0:
            e.eligible, e.reason = False, "Not tested"
        elif e.stats.unreachable:
            e.eligible, e.reason = False, "No successful answers"
        elif e.stats.ok < MIN_SUCCESSFUL:
            e.eligible, e.reason = False, "Too few successful answers to judge"
    reliable_exists = any(e.eligible and e.stats.success_rate >= RELIABLE_BAR for e in entries)
    if reliable_exists:
        for e in entries:
            if e.eligible and e.stats.success_rate < MIN_SUCCESS_IF_OTHERS_RELIABLE:
                e.eligible, e.reason = False, f"Only {e.stats.success_rate:.0%} of queries succeeded"
    entries.sort(key=lambda e: (not e.eligible, -round(e.score.total, 6),
                                e.score.typical_ms if e.score.typical_ms is not None else math.inf))
    for i, e in enumerate(entries, 1):
        e.rank = i
    return entries


def _fmt_ms(ms: float) -> str:
    return f"{ms:.1f} ms" if ms < 100 else f"{ms:.0f} ms"


def _pct(rate: float) -> str:
    return "100%" if rate >= 0.9995 else f"{rate * 100:.1f}%"


def effectively_tied(a: Ranked, b: Ranked) -> bool:
    """Differences this small are within normal run-to-run noise."""
    ta, tb = a.score.typical_ms, b.score.typical_ms
    if ta is None or tb is None:
        return False
    return (abs(ta - tb) < max(1.0, 0.05 * min(ta, tb))
            and abs(a.stats.success_rate - b.stats.success_rate) < 0.01
            and abs(a.score.total - b.score.total) < 2.0)


@dataclass
class Recommendation:
    winner: Ranked
    runner_up: Ranked | None
    current: Ranked | None
    headline: str
    details: list[str]
    tied_with: list[Ranked]
    switching_optional: bool  # the current DNS is (nearly) as good
    vs_current: str | None


def recommend(ranked: list[Ranked]) -> Recommendation | None:
    eligible = [e for e in ranked if e.eligible]
    if not eligible:
        return None
    winner = eligible[0]
    runner = eligible[1] if len(eligible) > 1 else None
    current = next((e for e in ranked if e.is_current and e.stats.total), None)
    w_med = winner.stats.latency.median if winner.stats.latency else math.inf

    lowest_median = min(eligible, key=lambda e: e.stats.latency.median if e.stats.latency else math.inf)
    best_consistency = max(eligible[:5], key=lambda e: e.score.consistency)

    reasons: list[str] = []
    details: list[str] = []
    if lowest_median is winner:
        reasons.append(f"it had the lowest median DNS response time ({_fmt_ms(w_med)})")
    else:
        lm = lowest_median.stats.latency.median if lowest_median.stats.latency else math.inf
        reasons.append(f"it gave the best overall balance of speed and reliability ({_fmt_ms(w_med)} median)")
        why = []
        if lowest_median.stats.success_rate < winner.stats.success_rate - 0.001:
            why.append(f"answered fewer queries ({_pct(lowest_median.stats.success_rate)})")
        if lowest_median.score.consistency < winner.score.consistency - 1:
            spikes = lowest_median.stats.latency.spikes if lowest_median.stats.latency else 0
            why.append(f"was less consistent ({spikes} slow spike{'s' if spikes != 1 else ''})" if spikes
                       else "was less consistent")
        if lowest_median.score.latency < winner.score.latency - 0.5 and not why:
            why.append("was slower on average or on uncached lookups")
        tail = " and ".join(why) if why else "scored lower overall"
        details.append(f"{lowest_median.name} had a slightly lower median ({_fmt_ms(lm)}) but {tail}.")
    if winner.stats.success_rate >= 0.9995:
        reasons.append("maintained a 100% success rate during testing")
    else:
        reasons.append(f"answered {_pct(winner.stats.success_rate)} of queries successfully")
    if best_consistency is winner and winner.stats.latency and winner.stats.latency.spikes == 0:
        reasons[-1] += ", with no slow spikes"
    headline = f"{winner.name} is recommended because {reasons[0]} and {reasons[1]}."

    tied = [e for e in eligible[1:4] if effectively_tied(winner, e)]
    if tied:
        names = [winner.name] + [e.name for e in tied]
        joined = ", ".join(names[:-1]) + " and " + names[-1]
        details.append(f"{joined} performed almost identically — the difference is within normal "
                       f"variation, so any of them is a great choice.")

    vs_current = None
    switching_optional = False
    if current is not None:
        if current is winner:
            switching_optional = True
            vs_current = "This is the DNS you are already using — no change needed."
        elif current.eligible and current.score.typical_ms and winner.score.typical_ms:
            diff = current.score.typical_ms - winner.score.typical_ms
            if diff > 0:
                pct = diff / current.score.typical_ms * 100
                vs_current = f"{_fmt_ms(diff)} faster ({pct:.0f}%) than your current DNS."
            else:
                vs_current = "About as fast as your current DNS, but more reliable or consistent."
            if effectively_tied(winner, current) or (diff < max(2.0, 0.1 * current.score.typical_ms)
                                                     and current.stats.success_rate >= 0.99):
                switching_optional = True
                vs_current += " Your current DNS is nearly as good, so switching is optional."
        elif not current.eligible:
            vs_current = f"Your current DNS had problems during testing ({current.reason or 'unreliable'})."

    return Recommendation(winner, runner, current, headline, details, tied, switching_optional, vs_current)


def significant_change(previous_winner_id: str | None, ranked: list[Ranked]) -> str | None:
    """For scheduled checks: a message if a *different* provider is now clearly better, else None."""
    rec = recommend(ranked)
    if rec is None or previous_winner_id is None or rec.winner.provider_id == previous_winner_id:
        return None
    prev = next((e for e in ranked if e.provider_id == previous_winner_id), None)
    if prev is None or prev.score.typical_ms is None:
        return f"{rec.winner.name} is now the best DNS for your connection."
    new_t = rec.winner.score.typical_ms or 0.0
    gain = prev.score.typical_ms - new_t
    if prev.stats.success_rate < MIN_SUCCESS_IF_OTHERS_RELIABLE:
        return (f"{prev.name} was unreliable in the latest check ({_pct(prev.stats.success_rate)} success). "
                f"{rec.winner.name} is now recommended.")
    if gain >= max(3.0, 0.10 * prev.score.typical_ms):
        return (f"{rec.winner.name} is now {_fmt_ms(gain)} faster than {prev.name}, "
                f"your previous best DNS.")
    return None
