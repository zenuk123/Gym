"""Optional "Best DNS right now" checks via Windows Task Scheduler (no background process of our own).

The task runs ``DNSBenchmark.exe --scheduled``: a quick, headless benchmark that is saved to history and shows
a Windows notification only if a *different* provider has become clearly better (see
``scoring.significant_change``).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TASK_NAME = r"DNS Benchmark\Best DNS check"
FREQUENCIES = {"daily": "DAILY", "weekly": "WEEKLY", "monthly": "MONTHLY"}


def launch_command() -> str:
    """The command line the scheduled task runs."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --scheduled'
    exe = Path(sys.executable)
    pythonw = exe.with_name("pythonw.exe")
    runner = Path(__file__).resolve().parent.parent / "run.py"
    return f'"{pythonw if pythonw.exists() else exe}" "{runner}" --scheduled'


def create_args(frequency: str, command: str, start_time: str = "12:00") -> list[str]:
    if frequency not in FREQUENCIES:
        raise ValueError(f"Unknown schedule {frequency!r}")
    args = ["schtasks", "/Create", "/F", "/TN", TASK_NAME, "/SC", FREQUENCIES[frequency], "/ST", start_time]
    if frequency == "weekly":
        args += ["/D", "MON"]
    elif frequency == "monthly":
        args += ["/D", "1"]
    return args + ["/TR", command]


def delete_args() -> list[str]:
    return ["schtasks", "/Delete", "/F", "/TN", TASK_NAME]


def apply_schedule(frequency: str) -> tuple[bool, str]:
    """Create/replace or remove the scheduled task. Returns (ok, user-facing message)."""
    if sys.platform != "win32":
        return False, "Scheduled checks use Windows Task Scheduler and are only available on Windows."
    flags = 0x08000000  # CREATE_NO_WINDOW
    if frequency == "disabled":
        # A non-zero exit here just means the task didn't exist.
        subprocess.run(delete_args(), capture_output=True, text=True, creationflags=flags)  # noqa: S603
        return True, "Automatic checks are turned off."
    cmd = launch_command()
    if len(cmd) > 261:
        return False, "The app's folder path is too long for Task Scheduler. Move the app to a shorter path."
    proc = subprocess.run(create_args(frequency, cmd), capture_output=True, text=True, creationflags=flags)  # noqa: S603
    if proc.returncode != 0:
        return False, f"Windows Task Scheduler refused the schedule: {(proc.stderr or proc.stdout).strip()}"
    when = {"daily": "every day", "weekly": "every Monday", "monthly": "on the 1st of each month"}[frequency]
    return True, (f"A quick DNS check will run {when} at 12:00 while you're signed in. You'll only be notified if a "
                  f"different DNS becomes clearly faster.")
