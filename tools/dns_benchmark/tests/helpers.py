from dnsbench.models import Outcome, QueryKind, Sample
from dnsbench.stats import group_stats


def samples(values, *, timeouts=0, errors=0, kind=QueryKind.CACHED, target="t"):
    out = [Sample(target, "example.com", kind, i, 1000.0 + i, float(i), Outcome.OK, float(v), "NOERROR")
           for i, v in enumerate(values)]
    out += [Sample(target, "example.com", kind, 0, 0.0, 0.0, Outcome.TIMEOUT, None, None, "timeout")
            for _ in range(timeouts)]
    out += [Sample(target, "example.com", kind, 0, 0.0, 0.0, Outcome.ERROR, None, "SERVFAIL", "servfail")
            for _ in range(errors)]
    return out


def stats_of(values, **kw):
    return group_stats(samples(values, **kw))
