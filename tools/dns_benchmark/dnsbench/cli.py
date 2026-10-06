"""Command-line version: ``DNSBenchmark.exe --cli [--mode full] [--export results.csv]``."""

from __future__ import annotations

import asyncio
import sys
import threading
import time

from . import APP_NAME, __version__, fmt
from .benchmark import BenchmarkAborted, request_from_settings, run_benchmark
from .engine import CancelToken, Progress
from .export import to_txt, write_export
from .fake import FakeTransport, demo_network, demo_profiles
from .network import detect_network
from .results import analyse
from .scoring import Weights
from .storage import HistoryStore, SettingsStore
from .transport import RealTransport


def _print_progress(p: Progress) -> None:
    if p.phase == "warmup":
        sys.stdout.write("\rWarming up…" + " " * 40)
    elif p.phase == "testing" and p.total:
        bar = int(30 * p.completed / p.total)
        cur = f"{p.current.address}" if p.current else ""
        sys.stdout.write(f"\r[{'#' * bar}{'.' * (30 - bar)}] {p.completed}/{p.total}  ~{fmt.duration(p.eta_s)} left  "
                         f"{cur:<24}")
    sys.stdout.flush()


def run_cli(mode: str, *, demo: bool = False, no_ipv6: bool = False, dot: bool = False, save: bool = True,
            exports: list[str] | None = None) -> int:
    print(f"{APP_NAME} {__version__} — command line")
    store = SettingsStore()
    settings = store.load()
    network = demo_network() if demo else detect_network()
    if network.error:
        print(f"Note: {network.error}")
    a = network.active
    print(f"Network adapter : {a.name if a else 'unknown'} ({a.connection_type if a else '?'})")
    print(f"Current DNS     : {', '.join(network.dns_servers) or 'not detected'}")
    if network.vpn:
        print(f"VPN             : {network.vpn.name} appears active — results may not reflect your normal connection.")
    if demo:
        print("*** DEMO MODE — results are simulated ***")
    request = request_from_settings(settings, mode, include_ipv6=False if no_ipv6 else None,
                                    include_dot=True if dot else None)
    transport = FakeTransport(demo_profiles(), realtime=True, seed=None) if demo else RealTransport()
    cancel = CancelToken()
    box: dict = {}

    def worker() -> None:
        try:
            box["run"] = asyncio.run(run_benchmark(request, network, transport, progress=_print_progress,
                                                   cancel=cancel, demo=demo))
        except BenchmarkAborted as exc:
            box["error"] = exc.message
        except Exception as exc:  # noqa: BLE001
            box["error"] = f"Unexpected error: {exc!r}"

    print("Checking your connection…")
    t = threading.Thread(target=worker, daemon=True)
    t.start()
    try:
        while t.is_alive():
            t.join(0.2)
    except KeyboardInterrupt:
        print("\nCancelling…")
        cancel.cancel()
        t.join()
    print()
    if "error" in box:
        print(box["error"])
        return 2
    run = box["run"]
    analysis = analyse(run, Weights.from_dict(settings.weights))
    print(to_txt(analysis))
    if save and settings.save_history and not run.cancelled:
        HistoryStore().save(analysis)
        rec = analysis.recommendation
        if rec and not run.demo:
            settings.last_winner = {"provider_id": rec.winner.provider_id, "name": rec.winner.name,
                                    "typical_ms": rec.winner.score.typical_ms, "run_id": run.id, "at": time.time()}
            store.save(settings)
    for path in exports or []:
        try:
            print(f"Saved {write_export(analysis, path)}")
        except (OSError, ValueError) as exc:
            print(f"Couldn't export {path}: {exc}")
    return 1 if run.cancelled else 0
