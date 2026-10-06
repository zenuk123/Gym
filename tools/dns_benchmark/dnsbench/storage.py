"""Local storage: settings, benchmark history and the Windows DNS backup. Everything stays on this PC.

Location: ``%APPDATA%\\DNS Benchmark`` on Windows (``~/.config/dns-benchmark`` elsewhere). Portable mode: put a
file named ``portable.txt`` next to the .exe and data is kept in a ``data`` folder beside it instead.
``DNSBENCH_HOME`` overrides the location (used by the tests).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .providers import Provider, ProviderError, load_builtin_providers, validate_provider
from .results import Analysis, BenchmarkRun


def app_dir() -> Path:
    env = os.environ.get("DNSBENCH_HOME")
    if env:
        p = Path(env)
    else:
        exe_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None
        if exe_dir and (exe_dir / "portable.txt").exists():
            p = exe_dir / "data"
        elif sys.platform == "win32":
            p = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "DNS Benchmark"
        else:
            p = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "dns-benchmark"
    p.mkdir(parents=True, exist_ok=True)
    return p


def atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + rename so a crash or power cut never leaves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path: Path) -> dict | list | None:
    """Read JSON; a corrupt file is moved aside (``.corrupt``) rather than crashing the app."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        try:
            path.replace(path.with_suffix(path.suffix + f".corrupt-{int(time.time())}"))
        except OSError:
            pass
        return None


SCHEDULES = ("disabled", "daily", "weekly", "monthly")


@dataclass
class Settings:
    default_mode: str = "quick"
    include_ipv6: bool = True
    include_dot: bool = False
    test_uncached: bool = True
    connectivity_check: bool = True
    timeout_s: float = 2.0
    domains: list[str] | None = None          # None = built-in list
    gaming_domains: list[str] | None = None
    provider_enabled: dict[str, bool] = field(default_factory=dict)  # overrides of enabled_by_default
    custom_providers: list[dict] = field(default_factory=list)
    weights: dict = field(default_factory=dict)
    schedule: str = "disabled"
    theme: str = "system"
    save_history: bool = True
    last_winner: dict | None = None           # {provider_id, name, typical_ms, run_id, at}
    pending_notice: str | None = None         # message from a scheduled check, shown on next launch

    @classmethod
    def from_dict(cls, d: dict | None) -> Settings:
        s = cls()
        if not isinstance(d, dict):
            return s
        for k, default in asdict(s).items():
            if k in d and (d[k] is None or default is None or isinstance(d[k], type(default))
                           or (isinstance(default, float) and isinstance(d[k], int))):
                setattr(s, k, d[k])
        if s.schedule not in SCHEDULES:
            s.schedule = "disabled"
        if s.default_mode not in ("quick", "full", "gaming"):
            s.default_mode = "quick"
        s.timeout_s = min(max(float(s.timeout_s), 0.5), 10.0)
        return s

    def custom(self) -> list[Provider]:
        out = []
        for d in self.custom_providers:
            try:
                p = Provider.from_dict({**d, "custom": True})
                validate_provider(p)
                out.append(p)
            except (ProviderError, KeyError, TypeError):
                continue
        return out

    def all_providers(self, builtins: list[Provider] | None = None) -> list[Provider]:
        return list(builtins if builtins is not None else load_builtin_providers()) + self.custom()

    def is_enabled(self, p: Provider) -> bool:
        return self.provider_enabled.get(p.id, p.enabled_by_default)

    def enabled_providers(self, builtins: list[Provider] | None = None) -> list[Provider]:
        return [p for p in self.all_providers(builtins) if self.is_enabled(p)]


class SettingsStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or app_dir()
        self.path = self.root / "settings.json"

    def load(self) -> Settings:
        return Settings.from_dict(read_json(self.path))  # type: ignore[arg-type]

    def save(self, s: Settings) -> None:
        atomic_write(self.path, json.dumps(asdict(s), indent=2))


@dataclass
class HistoryEntry:
    run_id: str
    started_at: float
    mode: str
    demo: bool
    cancelled: bool
    winner_id: str | None
    winner_name: str | None
    typical_ms: float | None
    median_ms: float | None
    avg_ms: float | None
    success_rate: float | None
    score: float | None
    current_name: str | None = None
    current_median_ms: float | None = None
    providers: list[dict] = field(default_factory=list)

    @classmethod
    def from_analysis(cls, a: Analysis) -> HistoryEntry:
        rec = a.recommendation
        w = rec.winner if rec else None
        cur = rec.current if rec else None
        rows = [{"id": e.provider_id, "name": e.name,
                 "median_ms": e.stats.latency.median if e.stats.latency else None,
                 "avg_ms": e.stats.latency.mean if e.stats.latency else None,
                 "success_rate": e.stats.success_rate, "score": round(e.score.total, 2)}
                for e in a.ranking()]
        return cls(
            run_id=a.run.id, started_at=a.run.started_at, mode=a.run.mode, demo=a.run.demo,
            cancelled=a.run.cancelled, winner_id=w.provider_id if w else None, winner_name=w.name if w else None,
            typical_ms=w.score.typical_ms if w else None,
            median_ms=w.stats.latency.median if w and w.stats.latency else None,
            avg_ms=w.stats.latency.mean if w and w.stats.latency else None,
            success_rate=w.stats.success_rate if w else None, score=round(w.score.total, 2) if w else None,
            current_name=cur.name if cur else None,
            current_median_ms=cur.stats.latency.median if cur and cur.stats.latency else None,
            providers=rows,
        )

    @classmethod
    def from_dict(cls, d: dict) -> HistoryEntry:
        fields = cls.__dataclass_fields__
        return cls(**{k: v for k, v in d.items() if k in fields})


class HistoryStore:
    MAX_RUNS = 500

    def __init__(self, root: Path | None = None) -> None:
        self.dir = (root or app_dir()) / "history"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.dir / "index.json"

    def _run_path(self, run_id: str) -> Path:
        safe = "".join(c for c in run_id if c.isalnum() or c in "-_")
        return self.dir / f"run-{safe}.json"

    def _read_index(self) -> list[HistoryEntry]:
        data = read_json(self.index_path)
        if not isinstance(data, list):
            return self._rebuild_index()
        out = []
        for d in data:
            try:
                out.append(HistoryEntry.from_dict(d))
            except TypeError:
                continue
        return out

    def _rebuild_index(self) -> list[HistoryEntry]:
        from .results import analyse

        entries = []
        for f in self.dir.glob("run-*.json"):
            d = read_json(f)
            if isinstance(d, dict):
                try:
                    entries.append(HistoryEntry.from_analysis(analyse(BenchmarkRun.from_dict(d))))
                except (ValueError, KeyError, TypeError):
                    continue
        self._write_index(entries)
        return entries

    def _write_index(self, entries: list[HistoryEntry]) -> None:
        entries.sort(key=lambda e: e.started_at, reverse=True)
        atomic_write(self.index_path, json.dumps([asdict(e) for e in entries], indent=1))

    def save(self, analysis: Analysis) -> HistoryEntry:
        atomic_write(self._run_path(analysis.run.id), json.dumps(analysis.run.to_dict(), separators=(",", ":")))
        entry = HistoryEntry.from_analysis(analysis)
        entries = [e for e in self._read_index() if e.run_id != entry.run_id] + [entry]
        entries.sort(key=lambda e: e.started_at, reverse=True)
        for old in entries[self.MAX_RUNS:]:
            self._run_path(old.run_id).unlink(missing_ok=True)
        self._write_index(entries[: self.MAX_RUNS])
        return entry

    def list(self) -> list[HistoryEntry]:
        return sorted(self._read_index(), key=lambda e: e.started_at, reverse=True)

    def load(self, run_id: str) -> BenchmarkRun:
        d = read_json(self._run_path(run_id))
        if not isinstance(d, dict):
            raise FileNotFoundError(f"Saved result {run_id} is missing or damaged.")
        return BenchmarkRun.from_dict(d)

    def delete(self, run_id: str) -> None:
        self._run_path(run_id).unlink(missing_ok=True)
        self._write_index([e for e in self._read_index() if e.run_id != run_id])

    def clear(self) -> None:
        for f in self.dir.glob("run-*.json"):
            f.unlink(missing_ok=True)
        self._write_index([])
