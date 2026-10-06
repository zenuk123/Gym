"""Entry point: GUI by default, ``--cli`` for the terminal, ``--scheduled`` for Task Scheduler."""

from __future__ import annotations

import argparse
import sys

from . import APP_NAME, __version__


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="DNSBenchmark", description=f"{APP_NAME}: find the best DNS for your connection.")
    p.add_argument("--cli", action="store_true", help="run a benchmark in the terminal instead of the window")
    p.add_argument("--mode", choices=["quick", "full", "gaming"], default=None, help="benchmark length (CLI)")
    p.add_argument("--export", action="append", metavar="FILE", help="save results to .csv/.json/.txt (CLI)")
    p.add_argument("--no-ipv6", action="store_true", help="skip IPv6 servers")
    p.add_argument("--dot", action="store_true", help="also test DNS-over-TLS (CLI)")
    p.add_argument("--no-save", action="store_true", help="don't add this run to history (CLI)")
    p.add_argument("--demo", action="store_true", help="simulated results (to try the app without a network)")
    p.add_argument("--scheduled", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--version", action="version", version=f"{APP_NAME} {__version__}")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.scheduled:
        from .scheduled import run_scheduled_check

        code, message = run_scheduled_check()
        if message:
            try:
                from .ui.notify import show_notification

                show_notification("Best DNS changed", message)
            except Exception:  # noqa: BLE001 - notification is best-effort; the app shows it next launch too
                pass
        return code
    if args.cli:
        if sys.stdout is None:  # windowed build launched with --cli from Explorer
            return 2
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
        from .cli import run_cli

        return run_cli(args.mode or "quick", demo=args.demo, no_ipv6=args.no_ipv6, dot=args.dot,
                       save=not args.no_save, exports=args.export)
    from .ui.app import run_gui

    return run_gui(demo=args.demo)
