"""The desktop UI builds every page and renders real (simulated-data) results without errors."""

import asyncio
import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
QtWidgets = pytest.importorskip("PySide6.QtWidgets")


@pytest.fixture(scope="module")
def qapp():
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    yield app


def test_main_window_pages_and_results(qapp, home, monkeypatch):
    from dnsbench import diagnostics
    from dnsbench.benchmark import request_from_settings, run_benchmark
    from dnsbench.fake import FakeTransport, demo_network, demo_profiles
    from dnsbench.ui import theme
    from dnsbench.ui.app import MainWindow
    from dnsbench.ui.pages.details import ProviderDetailsDialog

    monkeypatch.setattr(diagnostics, "has_route", lambda a: ":" not in a)
    for n, pref in enumerate(("dark", "light"), 1):
        theme.apply_theme(qapp, pref)
        w = MainWindow(demo=True)
        w.show()
        req = request_from_settings(w.settings, "quick", builtins=w.builtins)
        req.config.round_interval_s, req.config.max_qps, req.connectivity_check = 0, 0, False
        run = asyncio.run(run_benchmark(req, demo_network(), FakeTransport(demo_profiles(1), seed=1), demo=True))
        w._benchmark_done(run)
        assert w.stack.currentWidget() is w.results_page
        assert w.analysis.recommendation is not None
        rp = w.results_page
        assert rp.table.rowCount() == len(w.analysis.ranking())
        for i in range(3):
            rp.tabs.setCurrentIndex(i)
            assert not rp.chart_pages[i].grab().isNull()
        for key in ("dashboard", "history", "settings", "help"):
            w.go(key)
            qapp.processEvents()
            assert not w.stack.currentWidget().grab().isNull()
        assert w.history_page.table.rowCount() == n  # each completed run is saved
        d = ProviderDetailsDialog(w, w.analysis, w.analysis.recommendation.winner.provider_id)
        assert not d.grab().isNull()
        assert not w.can_change_dns()  # never in demo mode
        w.close()


def test_charts_handle_empty_and_extreme_data(qapp):
    from dnsbench.ui.charts import (BarChart, BarRow, DistributionChart, DistRow, TimelineChart, TimelinePoint,
                                    TimelineSeries, TrendChart, TrendPoint, log_bounds)

    for chart in (BarChart(), DistributionChart(), TimelineChart(), TrendChart("a", "b")):
        chart.resize(600, 200)
        assert not chart.grab().isNull()
    b = BarChart()
    b.set_rows([BarRow("x", None, note="no answers"), BarRow("y", 0.2), BarRow("z", 4000.0, True)])
    b.resize(600, 200)
    b.grab()
    d = DistributionChart()
    d.set_rows([DistRow("x", 1, 2, 3, 4, 5000, [6000], 2), DistRow("dead", failures=5)])
    d.resize(600, 200)
    d.grab()
    t = TimelineChart()
    t.set_series([TimelineSeries("x", [TimelinePoint(0, 5), TimelinePoint(1, None), TimelinePoint(2, 900)], 5)])
    t.resize(600, 200)
    t.grab()
    tr = TrendChart("a", "b")
    tr.set_points([TrendPoint("1 Oct", 10, None), TrendPoint("2 Oct", None, 30)])
    tr.resize(600, 240)
    tr.grab()
    lo, hi, ticks = log_bounds(3.2, 270)
    assert (lo, hi) == (2, 500) and ticks[0] == 2 and ticks[-1] == 500
