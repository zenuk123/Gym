"""Headless "Best DNS right now" check launched by Task Scheduler (``--scheduled``)."""

from __future__ import annotations

import asyncio
import time

from .benchmark import BenchmarkAborted, request_from_settings, run_benchmark
from .network import detect_network
from .results import analyse
from .scoring import Weights, significant_change
from .storage import HistoryStore, SettingsStore
from .transport import RealTransport


def run_scheduled_check() -> tuple[int, str | None]:
    """Returns (exit code, notification message or None)."""
    store = SettingsStore()
    settings = store.load()
    network = detect_network()
    if network.vpn:
        return 0, None  # a VPN would skew the comparison; try again next time
    request = request_from_settings(settings, "quick", include_dot=False)
    try:
        run = asyncio.run(run_benchmark(request, network, RealTransport()))
    except BenchmarkAborted:
        return 0, None  # offline / captive portal: stay quiet
    run.mode = "scheduled"
    analysis = analyse(run, Weights.from_dict(settings.weights))
    if settings.save_history:
        HistoryStore().save(analysis)
    rec = analysis.recommendation
    if rec is None:
        return 0, None
    previous = (settings.last_winner or {}).get("provider_id")
    message = significant_change(previous, analysis.ranking())
    settings.last_winner = {"provider_id": rec.winner.provider_id, "name": rec.winner.name,
                            "typical_ms": rec.winner.score.typical_ms, "run_id": run.id, "at": time.time()}
    if message:
        settings.pending_notice = message
    store.save(settings)
    return 0, message
