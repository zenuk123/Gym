"""Runs the asyncio benchmark on its own thread and reports back to the UI through Qt signals."""

from __future__ import annotations

import asyncio
import statistics
import traceback

from PySide6.QtCore import QThread, Signal

from ..benchmark import BenchmarkAborted, BenchmarkRequest, run_benchmark
from ..diagnostics import upstream_resolver
from ..engine import CancelToken
from ..models import Family, Outcome, Protocol, Target, family_of
from ..network import NetworkInfo
from ..transport import Transport


class BenchmarkWorker(QThread):
    progress = Signal(object)      # engine.Progress
    preflight = Signal(object)     # diagnostics.Preflight
    finished_run = Signal(object)  # results.BenchmarkRun
    aborted = Signal(str)
    crashed = Signal(str, str)

    def __init__(self, request: BenchmarkRequest, network: NetworkInfo | None, transport: Transport,
                 demo: bool) -> None:
        super().__init__()
        self.request = request
        self.network = network
        self.transport = transport
        self.demo = demo
        self.token = CancelToken()

    def cancel(self) -> None:
        self.token.cancel()

    def run(self) -> None:
        try:
            if self.network is None:
                from ..network import detect_network

                self.network = detect_network()
            result = asyncio.run(run_benchmark(self.request, self.network, self.transport, progress=self.progress.emit,
                                               on_preflight=self.preflight.emit, cancel=self.token, demo=self.demo))
        except BenchmarkAborted as exc:
            self.aborted.emit(exc.message)
        except Exception as exc:  # noqa: BLE001
            self.crashed.emit(str(exc), traceback.format_exc())
        else:
            self.finished_run.emit(result)


def probe_current_dns(network: NetworkInfo, transport: Transport, queries: int = 5) -> dict:
    """Quick look at the DNS you use now (for the dashboard): typical latency + who actually resolves for you."""
    servers = network.dns_servers
    v4 = [s for s in servers if family_of(s) is Family.V4]
    server = (v4 or servers or [None])[0]
    if server is None:
        return {"server": None}

    async def go() -> dict:
        t = Target("current", server, family_of(server), "primary", Protocol.UDP)
        times, failures = [], 0
        for d in ["google.com", "microsoft.com", "wikipedia.org", "bbc.co.uk", "amazon.co.uk", "github.com"][:queries]:
            r = await transport.query(t, d, "A", 2.0)
            if r.outcome is Outcome.OK and r.latency_ms is not None:
                times.append(r.latency_ms)
            else:
                failures += 1
        ip, name = await upstream_resolver(transport, server, 2.0)
        await transport.close()
        return {"server": server, "median_ms": statistics.median(times) if times else None, "failures": failures,
                "queries": queries, "upstream_ip": ip, "upstream_name": name}

    return asyncio.run(go())
