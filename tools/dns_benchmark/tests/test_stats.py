import math
import statistics

import pytest

from dnsbench.models import QueryKind
from dnsbench.stats import group_stats, latency_stats, percentile, spike_threshold
from tests.helpers import samples


def test_percentile_matches_linear_interpolation():
    v = [1.0, 2.0, 3.0, 4.0]
    assert percentile(v, 0) == 1.0 and percentile(v, 100) == 4.0
    assert percentile(v, 50) == 2.5
    assert percentile(v, 90) == pytest.approx(3.7)
    assert percentile([7.0], 90) == 7.0
    with pytest.raises(ValueError):
        percentile([], 50)


def test_latency_stats_basic_values():
    vals = [12, 13, 14, 13, 15, 14]
    ls = latency_stats(vals)
    assert ls.count == 6 and ls.min == 12 and ls.max == 15
    assert ls.mean == pytest.approx(statistics.mean(vals))
    assert ls.median == pytest.approx(statistics.median(vals))
    assert ls.stdev == pytest.approx(statistics.stdev(vals))
    assert ls.spikes == 0
    assert latency_stats([]) is None


def test_spikes_are_counted_relative_to_the_median():
    # Provider B from the brief: a competitive median with occasional huge delays
    ls = latency_stats([10, 11, 12, 90, 14, 120])
    assert ls.median == 13
    assert spike_threshold(13) == 63
    assert ls.spikes == 2


def test_group_stats_counts_and_rates():
    s = samples([10, 20, 30], timeouts=1, errors=1)
    g = group_stats(s)
    assert (g.total, g.ok, g.timeouts, g.errors, g.failures) == (5, 3, 1, 1, 2)
    assert g.success_rate == pytest.approx(0.6)
    assert g.timeout_rate == pytest.approx(0.2)
    assert g.latency.median == 20
    assert g.error_codes == {"timeout": 1, "servfail": 1}
    assert not g.unreachable


def test_cached_and_uncached_are_separated():
    s = samples([5, 6, 7]) + samples([40, 50], kind=QueryKind.UNCACHED)
    g = group_stats(s)
    assert g.cached.median == 6 and g.uncached.median == 45 and g.latency.count == 5


def test_unreachable_when_nothing_succeeded():
    g = group_stats(samples([], timeouts=4))
    assert g.unreachable and g.latency is None and g.success_rate == 0 and g.main_error == "timeout"
    assert math.isclose(group_stats([]).success_rate, 0)
