"""Scoring + the fake-results test mode: the right provider must win for the right reason."""

import asyncio

import pytest

from dnsbench.engine import BenchmarkConfig, BenchmarkEngine
from dnsbench.fake import FakeTransport, LatencyProfile
from dnsbench.models import Family
from dnsbench.providers import Provider
from dnsbench.results import BenchmarkRun, analyse
from dnsbench.scoring import (Ranked, Weights, consistency_score, effectively_tied, latency_score, rank, recommend,
                              reliability_score, score, significant_change)
from tests.helpers import stats_of


def entry(pid, values, current=False, **kw):
    return Ranked(f"{pid}|ipv4|udp", pid, pid.title(), stats_of(values, **kw), score=None, is_current=current)


def test_latency_score_scale():
    assert latency_score(3) == 100 and latency_score(5) == 100
    assert latency_score(1000) == 0 and latency_score(5000) == 0
    assert latency_score(10) > latency_score(20) > latency_score(50) > latency_score(200)


def test_reliability_score_punishes_failures_hard():
    assert reliability_score(1.0) == 100
    assert reliability_score(0.99) == pytest.approx(90)
    assert reliability_score(0.95) == pytest.approx(50)
    assert reliability_score(0.85) == 0


def test_consistency_prefers_steady_responses():
    steady = stats_of([12, 13, 14, 13, 15, 14] * 5).latency
    spiky = stats_of([10, 11, 12, 90, 14, 120] * 5).latency
    assert consistency_score(steady) > 80
    assert consistency_score(spiky) < consistency_score(steady) - 40


def test_weights_normalise_and_parse():
    w = Weights(2, 1, 1).normalised()
    assert (w.latency, w.reliability, w.consistency) == (0.5, 0.25, 0.25)
    assert Weights.from_dict({"latency": "0.6", "bogus": 1, "reliability": -3}).reliability == 0
    assert Weights.from_dict(None) == Weights()


def test_spiky_provider_does_not_win_on_a_competitive_average():
    steady = entry("steady", [12, 13, 14, 13, 15, 14] * 5)
    spiky = entry("spiky", [10, 11, 12, 90, 14, 120] * 5)
    ranked = rank([spiky, steady])
    assert ranked[0].provider_id == "steady"
    assert ranked[0].score.consistency > ranked[1].score.consistency


def test_fast_but_unreliable_provider_is_not_recommended():
    fast_flaky = entry("flaky", [5] * 90, timeouts=10)      # 90% success
    reliable = entry("solid", [25] * 100)
    ranked = rank([fast_flaky, reliable])
    assert ranked[0].provider_id == "solid"
    assert not ranked[1].eligible and "90%" in ranked[1].reason


def test_unreachable_and_too_few_answers_are_ineligible():
    ranked = rank([entry("dead", [], timeouts=5), entry("few", [5, 5], timeouts=0), entry("ok", [30] * 20)])
    assert [e.provider_id for e in ranked] == ["ok", "few", "dead"]
    reasons = {e.provider_id: e.reason for e in ranked}
    assert reasons["dead"] == "No successful answers" and "Too few" in reasons["few"]


def test_recommendation_explains_lowest_median_and_reliability():
    ranked = rank([entry("cloudflare", [14] * 30), entry("google", [18] * 30), entry("isp", [31] * 30, current=True)])
    rec = recommend(ranked)
    assert rec.winner.provider_id == "cloudflare"
    assert "lowest median DNS response time (14.0 ms)" in rec.headline
    assert "100% success rate" in rec.headline
    assert rec.vs_current.startswith("17.0 ms faster")
    assert not rec.switching_optional


def test_recommendation_explains_why_lower_median_lost():
    ranked = rank([entry("steady", [13, 14, 13, 14, 15] * 6), entry("spiky", [12, 12, 12, 12, 250] * 6)])
    rec = recommend(ranked)
    assert rec.winner.provider_id == "steady"
    assert "best overall balance" in rec.headline
    assert any("Spiky had a slightly lower median" in d and "less consistent" in d for d in rec.details)


def test_ties_and_current_dns_switching_optional():
    a, b = entry("a", [20.0] * 30), entry("b", [20.3] * 30, current=True)
    ranked = rank([a, b])
    assert effectively_tied(ranked[0], ranked[1])
    rec = recommend(ranked)
    assert rec.tied_with and rec.switching_optional
    assert "almost identically" in " ".join(rec.details)


def test_current_dns_already_best():
    rec = recommend(rank([entry("isp", [8] * 30, current=True), entry("google", [20] * 30)]))
    assert rec.winner.is_current and rec.switching_optional and "already using" in rec.vs_current


def test_no_recommendation_when_nothing_works():
    assert recommend(rank([entry("dead", [], timeouts=5)])) is None


def test_significant_change_detection():
    ranked = rank([entry("google", [12] * 30), entry("cloudflare", [20] * 30)])
    assert "faster than Cloudflare" in significant_change("cloudflare", ranked)
    assert significant_change("google", ranked) is None
    close = rank([entry("google", [19.5] * 30), entry("cloudflare", [20] * 30)])
    assert significant_change("cloudflare", close) is None  # within noise: don't nag


def test_score_without_successes_is_zero():
    s = score(stats_of([], timeouts=3))
    assert s.total == 0 and s.typical_ms is None


# ---------------------------------------------------------------- test mode: fake DNS results end to end

def _run_fake(profiles, seed, rounds=30):
    providers = [Provider(pid, pid.title(), [f"10.0.{i}.1", f"10.0.{i}.2"]) for i, pid in enumerate(profiles)]
    addr_profiles = {}
    for p in providers:
        for a in p.ipv4:
            addr_profiles[a] = profiles[p.id]
    targets = [t for p in providers for t in p.targets({Family.V4})]
    cfg = BenchmarkConfig(rounds=rounds, round_interval_s=0, max_qps=0, seed=seed, warmup=False)
    res = asyncio.run(BenchmarkEngine(FakeTransport(addr_profiles, seed=seed)).run(targets, cfg))
    run = BenchmarkRun(res.started_at, res.finished_at, "quick", cfg.to_dict(), providers, targets, res.samples)
    return analyse(run)


@pytest.mark.parametrize("seed", range(5))
def test_fake_results_identify_the_best_provider(seed):
    profiles = {
        "steady": LatencyProfile(14, jitter_ms=1),
        "spiky": LatencyProfile(11, jitter_ms=1, spike_prob=0.15, spike_ms=150),
        "flaky": LatencyProfile(9, jitter_ms=1, timeout_prob=0.1),
        "slow": LatencyProfile(45, jitter_ms=3),
    }
    a = _run_fake(profiles, seed)
    assert a.recommendation.winner.provider_id == "steady"
    order = [e.provider_id for e in a.ranking()]
    assert order.index("slow") > order.index("steady")


@pytest.mark.parametrize("seed", range(3))
def test_fake_results_clear_speed_winner(seed):
    a = _run_fake({"fast": LatencyProfile(8), "medium": LatencyProfile(20), "far": LatencyProfile(60)}, seed)
    assert [e.provider_id for e in a.ranking()] == ["fast", "medium", "far"]
