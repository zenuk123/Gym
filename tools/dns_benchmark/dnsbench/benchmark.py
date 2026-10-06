"""Orchestration: pre-flight checks → choose servers → run the engine → package a BenchmarkRun.
Used by both the desktop UI and the command line."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .diagnostics import Preflight, run_preflight
from .engine import BenchmarkConfig, BenchmarkEngine, CancelToken, Progress
from .models import Family, Protocol, Target
from .network import NetworkInfo
from .providers import Provider, merge_current_dns
from .results import BenchmarkRun
from .transport import Transport


class BenchmarkAborted(Exception):
    """Raised when the benchmark can't run at all (e.g. no internet). ``message`` is user-facing."""

    def __init__(self, message: str, preflight: Preflight | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.preflight = preflight


@dataclass
class BenchmarkRequest:
    config: BenchmarkConfig
    providers: list[Provider]           # enabled built-in + custom providers (current DNS is added automatically)
    include_ipv6: bool = True
    include_dot: bool = False           # also benchmark DNS-over-TLS (reference only — routers use plain DNS)
    connectivity_check: bool = True


def select_targets(providers: list[Provider], families: set[Family], include_dot: bool) -> list[Target]:
    targets: list[Target] = []
    for p in providers:
        targets += p.targets(families, Protocol.UDP)
        if include_dot and p.tls_hostname and p.ipv4 and Family.V4 in families:
            # One DoT server per provider keeps the extra load small.
            targets.append(Target(p.id, p.ipv4[0], Family.V4, "primary", Protocol.DOT, p.tls_hostname))
    return targets


async def run_benchmark(request: BenchmarkRequest, network: NetworkInfo, transport: Transport, *,
                        progress: Callable[[Progress], None] | None = None,
                        on_preflight: Callable[[Preflight], None] | None = None,
                        cancel: CancelToken | None = None, demo: bool = False,
                        preflight: Preflight | None = None) -> BenchmarkRun:
    current = network.dns_servers
    if preflight is None:
        preflight = await run_preflight(transport, current, include_ipv6=request.include_ipv6,
                                        connectivity_check=request.connectivity_check,
                                        timeout=request.config.timeout_s)
    if on_preflight:
        on_preflight(preflight)
    if not preflight.internet:
        raise BenchmarkAborted("No internet connection was detected — none of the DNS servers answered. "
                               "Check your connection (and sign in if you're on hotel/café Wi-Fi), then try again.",
                               preflight)
    if cancel and cancel.cancelled:
        raise BenchmarkAborted("Benchmark cancelled.", preflight)

    families = {Family.V4} if preflight.ipv4 != "no_route" else set()
    if request.include_ipv6 and preflight.ipv6 == "available":
        families.add(Family.V6)
    if not families:
        raise BenchmarkAborted("Neither IPv4 nor IPv6 DNS could be reached on this connection.", preflight)

    providers = merge_current_dns(request.providers, current)
    targets = select_targets(providers, families, request.include_dot)
    providers = [p for p in providers if any(t.provider_id == p.id for t in targets)]
    if not targets:
        raise BenchmarkAborted("There are no DNS servers to test. Enable at least one provider in Settings.", preflight)

    engine = BenchmarkEngine(transport)
    result = await engine.run(targets, request.config, progress, cancel)
    network_snapshot = network.snapshot()
    return BenchmarkRun(
        started_at=result.started_at, finished_at=result.finished_at, mode=request.config.mode,
        config=request.config.to_dict(), providers=providers, targets=targets, samples=result.samples,
        cancelled=result.cancelled, demo=demo, ipv4_status=preflight.ipv4,
        ipv6_status=preflight.ipv6 if request.include_ipv6 else "disabled",
        network=network_snapshot, diagnostics={"preflight": preflight.to_dict(), "warmup": result.warmup},
        skipped=result.skipped,
    )


def request_from_settings(settings, mode: str | None = None, *, include_ipv6: bool | None = None,
                          include_dot: bool | None = None, builtins: list[Provider] | None = None) -> BenchmarkRequest:
    """Build a request from saved Settings (shared by the UI, CLI and scheduled checks)."""
    from .engine import config_for_mode

    cfg = config_for_mode(mode or settings.default_mode, domains=settings.domains,
                          gaming_domains=settings.gaming_domains, timeout_s=settings.timeout_s,
                          test_uncached=settings.test_uncached)
    return BenchmarkRequest(
        config=cfg, providers=settings.enabled_providers(builtins),
        include_ipv6=settings.include_ipv6 if include_ipv6 is None else include_ipv6,
        include_dot=settings.include_dot if include_dot is None else include_dot,
        connectivity_check=settings.connectivity_check,
    )
