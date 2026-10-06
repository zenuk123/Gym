"""Benchmark engine: plans, paces and runs the queries. Network-agnostic — it only talks to a Transport, so it is
fully testable with the fake transport.

Design (why the numbers are fair):

* **Rounds.** Every server gets exactly one query per round, and in each round all servers are asked about the
  *same* domain (or, for uncached rounds, a fresh random name in the same zone). Every server is therefore
  compared on identical work.
* **Random order.** The order of servers is shuffled every round and the order of domains / cached-vs-uncached
  rounds is shuffled per run, so no server is systematically first (warm path) or last (congested).
* **Spread over time.** Rounds are paced (e.g. one every 1.5 s), so each server is sampled across the whole
  test window and a temporary hiccup on your line hits all servers equally rather than one unlucky server.
* **Gentle.** At most ``concurrency`` queries in flight, a global queries-per-second cap, never two queries in
  flight to the same server, and a server that never answers is dropped after a few consecutive failures.
"""

from __future__ import annotations

import asyncio
import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from . import domains as domain_lists
from .models import Outcome, QueryKind, Sample, Target
from .transport import Transport


@dataclass
class BenchmarkConfig:
    mode: str = "quick"
    rounds: int = 16
    round_interval_s: float = 1.5
    timeout_s: float = 2.0
    uncached_ratio: float = 0.25
    concurrency: int = 4
    max_qps: float = 40.0
    domains: list[str] = field(default_factory=lambda: list(domain_lists.POPULAR))
    uncached_zones: list[str] = field(default_factory=lambda: list(domain_lists.UNCACHED_ZONES))
    early_abort_failures: int = 5
    warmup: bool = True
    seed: int | None = None

    def to_dict(self) -> dict:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: dict) -> BenchmarkConfig:
        c = cls()
        for k, v in d.items():
            if hasattr(c, k):
                setattr(c, k, v)
        return c


MODES: dict[str, dict] = {
    "quick": {"label": "Quick test", "rounds": 16, "round_interval_s": 1.5, "uncached_ratio": 0.25,
              "blurb": "About 30–60 seconds. Good for quickly finding a likely winner."},
    "full": {"label": "Full benchmark", "rounds": 60, "round_interval_s": 2.5, "uncached_ratio": 0.3,
             "blurb": "About 3 minutes. Many more queries per server for statistically solid results."},
    "gaming": {"label": "Gaming DNS", "rounds": 20, "round_interval_s": 1.5, "uncached_ratio": 0.2,
               "blurb": "Uses game platform, launcher and voice-chat domains."},
}


def config_for_mode(mode: str, *, domains: list[str] | None = None, gaming_domains: list[str] | None = None,
                    uncached_zones: list[str] | None = None, timeout_s: float | None = None,
                    test_uncached: bool = True, seed: int | None = None) -> BenchmarkConfig:
    spec = MODES.get(mode, MODES["quick"])
    cfg = BenchmarkConfig(mode=mode if mode in MODES else "quick", rounds=spec["rounds"],
                          round_interval_s=spec["round_interval_s"], uncached_ratio=spec["uncached_ratio"], seed=seed)
    if mode == "gaming":
        cfg.domains = list(gaming_domains or domain_lists.GAMING)
    elif domains:
        cfg.domains = list(domains)
    if uncached_zones:
        cfg.uncached_zones = list(uncached_zones)
    if not test_uncached:
        cfg.uncached_ratio = 0.0
    if timeout_s:
        cfg.timeout_s = float(timeout_s)
    return cfg


@dataclass(frozen=True)
class PlannedQuery:
    round: int
    target: Target
    domain: str
    kind: QueryKind


def _cycle(items: list[str], rng: random.Random):
    pool: list[str] = []
    while True:
        if not pool:
            pool = list(items)
            rng.shuffle(pool)
        yield pool.pop()


def build_plan(targets: list[Target], cfg: BenchmarkConfig, rng: random.Random) -> list[list[PlannedQuery]]:
    """Return ``cfg.rounds`` rounds; each round asks every target once, in a shuffled order."""
    if not targets or cfg.rounds <= 0:
        return []
    if not cfg.domains:
        raise ValueError("The domain list is empty — add at least one test domain in Settings.")
    zones = cfg.uncached_zones if cfg.uncached_ratio > 0 else []
    n_uncached = round(cfg.rounds * cfg.uncached_ratio) if zones else 0
    kinds = [QueryKind.UNCACHED] * n_uncached + [QueryKind.CACHED] * (cfg.rounds - n_uncached)
    rng.shuffle(kinds)
    domain_iter = _cycle(cfg.domains, rng)
    zone_iter = _cycle(zones, rng) if zones else None
    plan: list[list[PlannedQuery]] = []
    for r, kind in enumerate(kinds):
        order = list(targets)
        rng.shuffle(order)
        if kind is QueryKind.CACHED:
            d = next(domain_iter)
            plan.append([PlannedQuery(r, t, d, kind) for t in order])
        else:
            zone = next(zone_iter)  # type: ignore[arg-type]
            plan.append([PlannedQuery(r, t, domain_lists.uncached_name(zone, rng), kind) for t in order])
    return plan


class CancelToken:
    """Thread-safe cancellation flag (the UI thread sets it, the benchmark thread polls it)."""

    def __init__(self) -> None:
        self._ev = threading.Event()

    def cancel(self) -> None:
        self._ev.set()

    @property
    def cancelled(self) -> bool:
        return self._ev.is_set()


class RateLimiter:
    """Spaces query *starts* at least ``1 / max_qps`` seconds apart."""

    def __init__(self, max_qps: float, monotonic: Callable[[], float] = time.monotonic) -> None:
        self.interval = 1.0 / max_qps if max_qps > 0 else 0.0
        self._next = 0.0
        self._lock = asyncio.Lock()
        self._mono = monotonic

    async def acquire(self) -> None:
        if self.interval <= 0:
            return
        async with self._lock:
            now = self._mono()
            wait = self._next - now
            self._next = max(now, self._next) + self.interval
        if wait > 0:
            await asyncio.sleep(wait)


@dataclass
class Progress:
    completed: int
    total: int
    round: int
    rounds: int
    elapsed_s: float
    eta_s: float
    current: Target | None = None
    sample: Sample | None = None
    phase: str = "testing"  # warmup / testing / done


@dataclass
class EngineResult:
    samples: list[Sample]
    skipped: dict[str, str]  # target id → reason (e.g. stopped after repeated failures)
    cancelled: bool
    started_at: float
    finished_at: float
    warmup: dict[str, str]   # target id → outcome of the unmeasured warm-up query


ProgressCallback = Callable[[Progress], None]


class BenchmarkEngine:
    def __init__(self, transport: Transport, *, wall_clock: Callable[[], float] = time.time,
                 monotonic: Callable[[], float] = time.perf_counter) -> None:
        self.transport = transport
        self._wall = wall_clock
        self._mono = monotonic

    async def run(self, targets: list[Target], cfg: BenchmarkConfig, progress: ProgressCallback | None = None,
                  cancel: CancelToken | None = None) -> EngineResult:
        cancel = cancel or CancelToken()
        rng = random.Random(cfg.seed)
        plan = build_plan(targets, cfg, rng)
        total = sum(len(r) for r in plan)
        samples: list[Sample] = []
        skipped: dict[str, str] = {}
        warm: dict[str, str] = {}
        consecutive_fail: dict[str, int] = {}
        ever_ok: set[str] = set()
        limiter = RateLimiter(cfg.max_qps, self._mono)
        sem = asyncio.Semaphore(max(1, cfg.concurrency))
        started_wall = self._wall()
        t0 = self._mono()
        completed = 0
        round_durations: list[float] = []

        def emit(rnd: int, target: Target | None, sample: Sample | None, phase: str = "testing") -> None:
            if progress is None:
                return
            per_round = max(cfg.round_interval_s, (sum(round_durations) / len(round_durations)) if round_durations else 0)
            rounds_left = (total - completed) / max(1, len(targets))
            eta = rounds_left * per_round
            progress(Progress(completed, total, rnd + 1 if phase == "testing" else 0, len(plan),
                              self._mono() - t0, eta, target, sample, phase))

        def note(target: Target, ok: bool) -> None:
            if ok:
                ever_ok.add(target.id)
                consecutive_fail[target.id] = 0
                return
            consecutive_fail[target.id] = consecutive_fail.get(target.id, 0) + 1
            if (target.id not in ever_ok and cfg.early_abort_failures > 0
                    and consecutive_fail[target.id] >= cfg.early_abort_failures):
                skipped.setdefault(target.id, "Stopped testing after repeated failures with no successful answer")

        async def ask(target: Target, domain: str) -> tuple[float, float, object]:
            async with sem:
                await limiter.acquire()
                started = self._wall()
                elapsed = self._mono() - t0
                res = await self.transport.query(target, domain, "A", cfg.timeout_s)
                return started, elapsed, res

        async def run_tasks(coros: list) -> bool:
            """Run coroutines; return False if cancelled part-way."""
            tasks = [asyncio.ensure_future(c) for c in coros]
            pending = set(tasks)
            while pending:
                if cancel.cancelled:
                    for t in pending:
                        t.cancel()
                    await asyncio.gather(*pending, return_exceptions=True)
                    return False
                _, pending = await asyncio.wait(pending, timeout=0.1)
            for t in tasks:
                if t.exception() is not None:
                    raise t.exception()  # programming error in a callback — surface it
            return True

        async def sleep_until(deadline: float) -> bool:
            while (left := deadline - self._mono()) > 0:
                if cancel.cancelled:
                    return False
                await asyncio.sleep(min(0.1, left))
            return not cancel.cancelled

        try:
            # Warm-up: one unmeasured query per server. Opens NAT/firewall state, primes ARP/neighbour caches
            # and tells us early which servers don't answer at all.
            if cfg.warmup and targets and not cancel.cancelled:
                emit(0, None, None, "warmup")
                warm_domain = cfg.domains[0] if cfg.domains else "example.com"

                async def warm_one(t: Target) -> None:
                    _, _, res = await ask(t, warm_domain)
                    warm[t.id] = res.outcome.value  # type: ignore[attr-defined]
                    if res.outcome is not Outcome.OK:  # type: ignore[attr-defined]
                        note(t, False)
                    else:
                        note(t, True)

                if not await run_tasks([warm_one(t) for t in targets]):
                    return EngineResult(samples, skipped, True, started_wall, self._wall(), warm)

            for rnd, queries in enumerate(plan):
                if cancel.cancelled:
                    break
                round_start = self._mono()

                async def one(pq: PlannedQuery, rnd: int = rnd) -> None:
                    nonlocal completed
                    if pq.target.id in skipped:
                        completed += 1
                        emit(rnd, pq.target, None)
                        return
                    started, elapsed, res = await ask(pq.target, pq.domain)
                    s = Sample(pq.target.id, pq.domain, pq.kind, rnd, started, elapsed,
                               res.outcome, res.latency_ms, res.rcode, res.error_code, res.detail, res.via_tcp)  # type: ignore[attr-defined]
                    samples.append(s)
                    note(pq.target, s.ok)
                    completed += 1
                    emit(rnd, pq.target, s)

                if not await run_tasks([one(pq) for pq in queries]):
                    break
                round_durations.append(self._mono() - round_start)
                if rnd < len(plan) - 1 and not await sleep_until(round_start + cfg.round_interval_s):
                    break
        finally:
            await self.transport.close()

        cancelled = cancel.cancelled and completed < total
        if progress:
            progress(Progress(completed, total, len(plan), len(plan), self._mono() - t0, 0.0, None, None, "done"))
        return EngineResult(samples, skipped, cancelled, started_wall, self._wall(), warm)
