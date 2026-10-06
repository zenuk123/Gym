"""Run PowerShell without a console window flash and without quoting pitfalls (scripts go in -EncodedCommand)."""

from __future__ import annotations

import base64
import subprocess
import sys
from dataclasses import dataclass

CREATE_NO_WINDOW = 0x08000000
UTF8_PREAMBLE = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"


@dataclass
class PsResult:
    returncode: int
    stdout: str
    stderr: str


def encode_command(script: str) -> str:
    """PowerShell's -EncodedCommand takes base64 of UTF-16LE. The output contains only [A-Za-z0-9+/=]."""
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


def powershell_args(script: str, *, hidden: bool = True) -> list[str]:
    args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]
    if hidden:
        args += ["-WindowStyle", "Hidden"]
    return args + ["-EncodedCommand", encode_command(UTF8_PREAMBLE + script)]


def run_powershell(script: str, timeout: float = 30.0) -> PsResult:
    if sys.platform != "win32":
        raise OSError("PowerShell is only available on Windows")
    proc = subprocess.run(  # noqa: S603 - fixed executable, script passed encoded
        powershell_args(script), capture_output=True, timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )
    return PsResult(proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace"))
