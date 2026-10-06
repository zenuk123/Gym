import csv
import io
import json

import pytest

from dnsbench.export import SUMMARY_COLUMNS, samples_csv, to_csv, to_json, to_txt, write_export
from dnsbench.fake import FakeTransport, LatencyProfile, demo_network
from dnsbench.results import BenchmarkRun, analyse
from dnsbench.scheduler import TASK_NAME, create_args, delete_args
from dnsbench.storage import HistoryStore, Settings, SettingsStore, atomic_write, read_json


@pytest.fixture
def analysis(monkeypatch):
    import asyncio

    from dnsbench import diagnostics
    from dnsbench.benchmark import BenchmarkRequest, run_benchmark
    from dnsbench.engine import BenchmarkConfig
    from dnsbench.providers import load_builtin_providers

    monkeypatch.setattr(diagnostics, "has_route", lambda a: ":" not in a)
    providers = [p for p in load_builtin_providers() if p.id in ("cloudflare", "google", "quad9")]
    t = FakeTransport({"cloudflare": LatencyProfile(12), "google": LatencyProfile(18),
                       "quad9": LatencyProfile(25, timeout_prob=0.05), "current": LatencyProfile(30)}, seed=4)
    req = BenchmarkRequest(BenchmarkConfig(rounds=10, round_interval_s=0, max_qps=0, seed=2), providers,
                           connectivity_check=False)
    run = asyncio.run(run_benchmark(req, demo_network(), t, demo=True))
    return analyse(run)


def test_benchmark_run_uses_detected_current_dns(analysis):
    ids = [p.id for p in analysis.run.providers]
    assert "current" in ids and analysis.run.ipv6_status == "no_route"
    assert {t.family.value for t in analysis.run.targets} == {"ipv4"}
    assert analysis.recommendation.winner.provider_id == "cloudflare"


def test_csv_export(analysis):
    rows = list(csv.DictReader(io.StringIO(to_csv(analysis))))
    assert list(rows[0].keys()) == SUMMARY_COLUMNS
    assert SUMMARY_COLUMNS[:7] == ["Provider", "Average", "Median", "Min", "Max", "SuccessRate", "Score"]
    cf = next(r for r in rows if r["Provider"] == "Cloudflare")
    e = next(e for e in analysis.ranking() if e.provider_id == "cloudflare")
    assert float(cf["Median"]) == pytest.approx(e.stats.latency.median, abs=0.05)
    assert cf["Primary"] == "1.1.1.1" and cf["Secondary"] == "1.0.0.1" and cf["Rank"] == "1"
    raw = list(csv.reader(io.StringIO(samples_csv(analysis))))
    assert len(raw) == 1 + len(analysis.run.samples)


def test_json_export_round_trips(analysis):
    doc = json.loads(to_json(analysis))
    assert doc["analysis"]["recommendation"]["provider_id"] == "cloudflare"
    again = BenchmarkRun.from_dict(doc)
    assert len(again.samples) == len(analysis.run.samples)
    assert analyse(again).recommendation.winner.provider_id == "cloudflare"
    with pytest.raises(ValueError):
        BenchmarkRun.from_dict({"format": "something-else"})


def test_txt_export(analysis):
    txt = to_txt(analysis)
    assert "RECOMMENDED DNS" in txt and "Primary:   1.1.1.1" in txt and "SIMULATED" in txt
    assert "Cloudflare is recommended because" in txt


def test_write_export_by_extension(analysis, tmp_path):
    for ext in ("csv", "json", "txt"):
        p = write_export(analysis, tmp_path / f"r.{ext}")
        assert p.stat().st_size > 100
    assert (tmp_path / "r.csv").read_bytes().startswith(b"\xef\xbb\xbf")  # Excel-friendly BOM
    with pytest.raises(ValueError):
        write_export(analysis, tmp_path / "r.xlsx")


def test_settings_round_trip_and_corruption(home):
    store = SettingsStore()
    s = store.load()
    assert s == Settings()
    s.schedule, s.weights, s.provider_enabled = "weekly", {"latency": 0.6}, {"quad9": False}
    store.save(s)
    s2 = store.load()
    assert s2.schedule == "weekly" and s2.weights == {"latency": 0.6} and not s2.is_enabled(
        next(p for p in s2.all_providers() if p.id == "quad9"))
    store.path.write_text("{broken")
    assert store.load() == Settings()
    assert list(store.root.glob("settings.json.corrupt-*"))
    assert Settings.from_dict({"schedule": "hourly", "timeout_s": 99, "default_mode": 3}).schedule == "disabled"


def test_custom_providers_from_settings(home):
    s = Settings(custom_providers=[{"id": "custom-pi", "name": "Pi-hole", "ipv4": ["192.168.1.5"]},
                                   {"id": "custom-bad", "name": "Bad", "ipv4": ["nope"]}])
    assert [p.id for p in s.custom()] == ["custom-pi"]
    assert "custom-pi" in [p.id for p in s.enabled_providers()]


def test_history_save_list_load_delete(home, analysis):
    h = HistoryStore()
    e = h.save(analysis)
    assert e.winner_id == "cloudflare" and e.demo and e.providers
    assert [x.run_id for x in h.list()] == [analysis.run.id]
    assert len(h.load(analysis.run.id).samples) == len(analysis.run.samples)
    h.index_path.unlink()  # index lost → rebuilt from run files
    assert [x.run_id for x in h.list()] == [analysis.run.id]
    h.delete(analysis.run.id)
    assert h.list() == []
    with pytest.raises(FileNotFoundError):
        h.load(analysis.run.id)


def test_atomic_write(tmp_path):
    p = tmp_path / "a" / "x.json"
    atomic_write(p, '{"a": 1}')
    assert read_json(p) == {"a": 1} and list(p.parent.iterdir()) == [p]


def test_scheduler_arguments():
    a = create_args("weekly", '"C:\\Apps\\DNSBenchmark.exe" --scheduled')
    assert a[:5] == ["schtasks", "/Create", "/F", "/TN", TASK_NAME]
    assert a[a.index("/SC") + 1] == "WEEKLY" and a[a.index("/D") + 1] == "MON" and a[-1].endswith("--scheduled")
    assert create_args("monthly", "x")[create_args("monthly", "x").index("/D") + 1] == "1"
    assert "/D" not in create_args("daily", "x")
    assert delete_args()[-1] == TASK_NAME
    with pytest.raises(ValueError):
        create_args("hourly", "x")
