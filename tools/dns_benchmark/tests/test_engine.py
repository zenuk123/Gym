import asyncio
import random
from collections import Counter

import pytest

from dnsbench.engine import (BenchmarkConfig, BenchmarkEngine, CancelToken, RateLimiter, build_plan,
                             config_for_mode)
from dnsbench.fake import FakeTransport, LatencyProfile
from dnsbench.models import Family, Outcome, QueryKind, Target

TARGETS = [Target(f"p{i}", f"10.0.0.{i}", Family.V4) for i in range(1, 6)]


def cfg(**kw):
    base = dict(rounds=12, round_interval_s=0, max_qps=0, warmup=False, seed=1,
                domains=["a.com", "b.com", "c.com"], uncached_zones=["z1.com", "z2.com"], uncached_ratio=0.25)
    base.update(kw)
    return BenchmarkConfig(**base)


def test_plan_asks_every_target_once_per_round_with_shared_domain():
    plan = build_plan(TARGETS, cfg(), random.Random(1))
    assert len(plan) == 12
    for rnd in plan:
        assert sorted(q.target.id for q in rnd) == sorted(t.id for t in TARGETS)
        if rnd[0].kind is QueryKind.CACHED:
            assert len({q.domain for q in rnd}) == 1  # fair: same domain for every server
    kinds = Counter(r[0].kind for r in plan)
    assert kinds[QueryKind.UNCACHED] == 3 and kinds[QueryKind.CACHED] == 9


def test_uncached_names_are_unique_random_subdomains_of_the_zones():
    plan = build_plan(TARGETS, cfg(), random.Random(1))
    names = [q.domain for r in plan for q in r if q.kind is QueryKind.UNCACHED]
    assert len(names) == len(set(names)) == 15
    assert all(n.startswith("dnsb") and n.split(".", 1)[1] in ("z1.com", "z2.com") for n in names)


def test_plan_order_is_randomised_but_reproducible():
    plan = build_plan(TARGETS, cfg(), random.Random(1))
    orders = {tuple(q.target.id for q in r) for r in plan}
    assert len(orders) > 3  # shuffled per round
    again = build_plan(TARGETS, cfg(), random.Random(1))
    assert [[q.target.id for q in r] for r in plan] == [[q.target.id for q in r] for r in again]


def test_plan_uses_every_domain_before_repeating():
    plan = build_plan(TARGETS, cfg(uncached_ratio=0, rounds=6), random.Random(3))
    ds = [r[0].domain for r in plan]
    assert sorted(ds[:3]) == ["a.com", "b.com", "c.com"] and sorted(ds[3:]) == ["a.com", "b.com", "c.com"]


def test_plan_rejects_empty_domain_list():
    with pytest.raises(ValueError):
        build_plan(TARGETS, cfg(domains=[]), random.Random(1))


def test_modes():
    assert config_for_mode("quick").rounds < config_for_mode("full").rounds
    assert "steampowered.com" in config_for_mode("gaming").domains
    assert config_for_mode("quick", test_uncached=False).uncached_ratio == 0
    assert config_for_mode("nonsense").mode == "quick"


def run_engine(transport, c, progress=None, cancel=None, targets=TARGETS):
    return asyncio.run(BenchmarkEngine(transport).run(targets, c, progress, cancel))


def test_engine_records_every_query_with_timestamps():
    events = []
    res = run_engine(FakeTransport({}, LatencyProfile(20)), cfg(), progress=events.append)
    assert len(res.samples) == 60 and not res.cancelled
    assert all(s.outcome is Outcome.OK and s.latency_ms > 0 for s in res.samples)
    assert all(s.started_at >= res.started_at for s in res.samples)
    elapsed = [s.elapsed_s for s in sorted(res.samples, key=lambda s: s.started_at)]
    assert elapsed == sorted(elapsed)
    assert events[-1].phase == "done" and events[-2].completed == 60


def test_unreachable_server_is_dropped_early():
    t = FakeTransport({"10.0.0.1": LatencyProfile(10, unreachable=True)}, LatencyProfile(15))
    res = run_engine(t, cfg(early_abort_failures=3))
    dead = [s for s in res.samples if s.target_id == TARGETS[0].id]
    assert len(dead) == 3 and TARGETS[0].id in res.skipped
    assert all(s.outcome is Outcome.TIMEOUT for s in dead)


def test_cancel_stops_quickly_and_keeps_partial_results():
    token = CancelToken()

    def progress(p):
        if p.completed >= 7:
            token.cancel()

    res = run_engine(FakeTransport({}, LatencyProfile(5)), cfg(rounds=100), progress, token)
    assert res.cancelled and 7 <= len(res.samples) < 20


def test_never_two_queries_in_flight_to_one_server_and_concurrency_capped():
    class Tracking(FakeTransport):
        def __init__(self):
            super().__init__({}, LatencyProfile(15), realtime=True, time_scale=0.2)
            self.inflight: Counter = Counter()
            self.max_total = 0
            self.max_per_server = 0

        async def query(self, target, qname, rdtype="A", timeout=2.0, rdclass="IN"):
            self.inflight[target.id] += 1
            self.max_total = max(self.max_total, sum(self.inflight.values()))
            self.max_per_server = max(self.max_per_server, self.inflight[target.id])
            try:
                return await super().query(target, qname, rdtype, timeout, rdclass)
            finally:
                self.inflight[target.id] -= 1

    t = Tracking()
    run_engine(t, cfg(concurrency=2, rounds=5))
    assert t.max_total == 2 and t.max_per_server == 1


def test_rate_limiter_spaces_query_starts():
    import time

    async def go():
        lim = RateLimiter(100)  # slots 10 ms apart
        times = []
        for _ in range(6):
            await lim.acquire()
            times.append(time.perf_counter())
        return times

    times = asyncio.run(go())
    # Never ahead of schedule: query n starts at least n intervals after the first (robust to coarse OS timers).
    for n, t in enumerate(times):
        assert t - times[0] >= n * 0.010 - 1e-6


def test_rounds_are_paced_over_time():
    import time

    start = time.perf_counter()
    run_engine(FakeTransport({}, LatencyProfile(1)), cfg(rounds=4, round_interval_s=0.15))
    assert time.perf_counter() - start >= 0.45  # 3 gaps × 0.15 s


def test_warmup_query_is_not_measured():
    t = FakeTransport({}, LatencyProfile(5))
    res = run_engine(t, cfg(warmup=True, rounds=2))
    assert len(t.queries) == 15 and len(res.samples) == 10 and len(res.warmup) == 5
