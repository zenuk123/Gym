"""Windows DNS manager: safe, verified, reversible changes to this PC's DNS servers.

Safety rules:

1. Addresses are validated (real IPs of the right family) before anything runs — nothing user-typed is ever
   spliced into a command unvalidated.
2. The adapter's *original* configuration (automatic/DHCP or the static list, per IPv4/IPv6) is written to
   ``dns_backup.json`` **before** any change. An existing backup is never overwritten, so after several
   changes "Restore" still returns to what you had before you first used this app.
3. The change runs in one elevated PowerShell script (UAC prompt) passed via ``-EncodedCommand`` — no temporary
   script file another program could swap.
4. After the change the DNS cache is flushed and the new configuration is read back and compared.
5. The router is never touched.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

from .models import Family, family_of, is_valid_ip
from .storage import atomic_write, read_json

UAC_CANCELLED = 1223


@dataclass
class InterfaceDns:
    index: int
    alias: str
    guid: str
    ipv4_static: list[str] = field(default_factory=list)  # [] means automatic (DHCP / router)
    ipv6_static: list[str] = field(default_factory=list)
    ipv4_current: list[str] = field(default_factory=list)
    ipv6_current: list[str] = field(default_factory=list)


@dataclass
class DnsBackup:
    created_at: float
    index: int
    alias: str
    guid: str
    ipv4_static: list[str]
    ipv6_static: list[str]
    ipv4_current: list[str]
    ipv6_current: list[str]

    @classmethod
    def of(cls, cfg: InterfaceDns) -> DnsBackup:
        return cls(time.time(), cfg.index, cfg.alias, cfg.guid, list(cfg.ipv4_static), list(cfg.ipv6_static),
                   list(cfg.ipv4_current), list(cfg.ipv6_current))

    def describe(self) -> str:
        def side(static: list[str], label: str) -> str:
            return f"{label}: " + (", ".join(static) if static else "automatic (from your router/ISP)")
        return f"{self.alias} — " + "; ".join([side(self.ipv4_static, "IPv4"), side(self.ipv6_static, "IPv6")])


@dataclass
class AdminResult:
    ok: bool
    cancelled: bool = False
    message: str = ""


@dataclass
class ChangeResult:
    ok: bool
    message: str
    details: str = ""
    before: InterfaceDns | None = None
    after: InterfaceDns | None = None
    cancelled: bool = False


class DnsSystem(Protocol):
    def read(self, index: int) -> InterfaceDns: ...
    def find(self, guid: str) -> InterfaceDns | None: ...
    def run_admin_script(self, script: str, result_path: Path) -> AdminResult: ...


class DnsChangeError(ValueError):
    pass


# ------------------------------------------------------------------ pure helpers (unit tested)

def normalise_ip(addr: str) -> str:
    return str(ipaddress.ip_address(addr.strip()))


def validate_servers(ipv4: list[str], ipv6: list[str]) -> tuple[list[str], list[str]]:
    v4 = [a.strip() for a in ipv4 if a and a.strip()]
    v6 = [a.strip() for a in ipv6 if a and a.strip()]
    if not v4 and not v6:
        raise DnsChangeError("No DNS server addresses were given.")
    if len(v4) > 3 or len(v6) > 3:
        raise DnsChangeError("At most three DNS servers per IP version are supported.")
    for a in v4:
        if not is_valid_ip(a) or "%" in a or family_of(a) is not Family.V4:
            raise DnsChangeError(f"{a!r} is not a valid IPv4 address.")
    for a in v6:
        if not is_valid_ip(a) or "%" in a or family_of(a) is not Family.V6:
            raise DnsChangeError(f"{a!r} is not a valid IPv6 address.")
    return [normalise_ip(a) for a in v4], [normalise_ip(a) for a in v6]


def parse_nameserver_value(value: str | list | None) -> list[str]:
    """Registry ``NameServer`` value: comma- or space-separated (empty = automatic)."""
    if value is None:
        return []
    if isinstance(value, list):
        value = ",".join(str(v) for v in value)
    out = []
    for part in re.split(r"[,\s]+", str(value)):
        if part and is_valid_ip(part):
            out.append(normalise_ip(part))
    return out


def ps_quote(s: str) -> str:
    """Single-quoted PowerShell literal (only ' needs escaping, by doubling)."""
    return "'" + s.replace("'", "''") + "'"


def _addr_array(addrs: list[str]) -> str:
    for a in addrs:  # defence in depth: only normalised IP literals reach a script
        if normalise_ip(a) != a:
            raise DnsChangeError(f"Unexpected address format {a!r}")
    return "@(" + ",".join(ps_quote(a) for a in addrs) + ")"


def _wrap(body: str, result_path: Path) -> str:
    return (
        "$ErrorActionPreference = 'Stop'\n"
        f"$out = {ps_quote(str(result_path))}\n"
        "try {\n"
        f"{body}"
        "  Clear-DnsClientCache\n"
        "  Set-Content -LiteralPath $out -Value 'OK' -Encoding UTF8\n"
        "  exit 0\n"
        "} catch {\n"
        "  try { Set-Content -LiteralPath $out -Value ('ERROR: ' + $_.Exception.Message) -Encoding UTF8 } catch {}\n"
        "  exit 1\n"
        "}\n"
    )


def build_apply_script(index: int, ipv4: list[str], ipv6: list[str], result_path: Path) -> str:
    index = int(index)
    body = f"  Set-DnsClientServerAddress -InterfaceIndex {index} -ServerAddresses {_addr_array(ipv4 + ipv6)}\n"
    return _wrap(body, result_path)


def build_restore_script(items: list[tuple[int, DnsBackup]], result_path: Path) -> str:
    """Reset each adapter to automatic, then re-apply whatever was static before."""
    body = ""
    for index, b in items:
        index = int(index)
        body += f"  Set-DnsClientServerAddress -InterfaceIndex {index} -ResetServerAddresses\n"
        static = [normalise_ip(a) for a in b.ipv4_static + b.ipv6_static]
        if static:
            body += f"  Set-DnsClientServerAddress -InterfaceIndex {index} -ServerAddresses {_addr_array(static)}\n"
    return _wrap(body, result_path)


def _same(a: list[str], b: list[str]) -> bool:
    return [normalise_ip(x) for x in a] == [normalise_ip(x) for x in b]


# ------------------------------------------------------------------ manager

class WindowsDnsManager:
    def __init__(self, system: DnsSystem, backup_path: Path) -> None:
        self.system = system
        self.backup_path = backup_path

    # backups ---------------------------------------------------------
    def backups(self) -> dict[str, DnsBackup]:
        data = read_json(self.backup_path)
        out: dict[str, DnsBackup] = {}
        if isinstance(data, dict):
            for guid, d in data.get("adapters", {}).items():
                try:
                    out[guid] = DnsBackup(**d)
                except TypeError:
                    continue
        return out

    def _write_backups(self, backups: dict[str, DnsBackup]) -> None:
        if not backups:
            self.backup_path.unlink(missing_ok=True)
            return
        atomic_write(self.backup_path, json.dumps(
            {"format": "dns-benchmark-backup", "adapters": {g: asdict(b) for g, b in backups.items()}}, indent=2))

    def has_backup(self) -> bool:
        return bool(self.backups())

    # apply -------------------------------------------------------------
    def apply(self, index: int, ipv4: list[str], ipv6: list[str]) -> ChangeResult:
        try:
            v4, v6 = validate_servers(ipv4, ipv6)
        except DnsChangeError as exc:
            return ChangeResult(False, str(exc))
        try:
            before = self.system.read(index)
        except Exception as exc:  # noqa: BLE001
            return ChangeResult(False, "Couldn't read the current DNS settings of your network adapter, so nothing "
                                       "was changed.", str(exc))
        backups = self.backups()
        created_backup = before.guid not in backups
        if created_backup:
            backups[before.guid] = DnsBackup.of(before)
            self._write_backups(backups)  # persisted BEFORE any change

        result_path = _result_file()
        res = self.system.run_admin_script(build_apply_script(index, v4, v6, result_path), result_path)
        if res.cancelled:
            if created_backup:
                backups.pop(before.guid, None)
                self._write_backups(backups)
            return ChangeResult(False, "You declined the administrator prompt, so nothing was changed.",
                                before=before, cancelled=True)
        try:
            after = self.system.read(index)
        except Exception as exc:  # noqa: BLE001
            return ChangeResult(False, "The change was attempted but the new settings couldn't be read back. "
                                       "Use “Restore previous DNS” if anything doesn't work.", str(exc), before)
        ok_v4 = not v4 or _same(after.ipv4_static, v4)
        ok_v6 = not v6 or _same(after.ipv6_static, v6)
        if res.ok and ok_v4 and ok_v6:
            return ChangeResult(True, "Windows DNS changed successfully.", res.message, before, after)
        changed = not (_same(after.ipv4_static, before.ipv4_static) and _same(after.ipv6_static, before.ipv6_static))
        if not changed and created_backup:
            backups.pop(before.guid, None)
            self._write_backups(backups)
        msg = ("Windows didn't accept the new DNS settings." if not changed else
               "The DNS change only partly applied. Use “Restore previous DNS” to go back.")
        return ChangeResult(False, msg, res.message, before, after)

    # restore -------------------------------------------------------------
    def restore(self, guid: str | None = None) -> ChangeResult:
        backups = self.backups()
        chosen = {g: b for g, b in backups.items() if guid is None or g == guid}
        if not chosen:
            return ChangeResult(False, "There is no saved DNS configuration to restore.")
        items: list[tuple[int, DnsBackup]] = []
        missing: list[str] = []
        for g, b in chosen.items():
            cur = self.system.find(g)
            if cur is None:
                missing.append(b.alias)
            else:
                items.append((cur.index, b))
        if not items:
            return ChangeResult(False, f"The network adapter ({', '.join(missing)}) isn't connected right now. "
                                       f"Connect it and try again.")
        result_path = _result_file()
        res = self.system.run_admin_script(build_restore_script(items, result_path), result_path)
        if res.cancelled:
            return ChangeResult(False, "You declined the administrator prompt, so nothing was changed.", cancelled=True)
        failed: list[str] = []
        last_after = None
        for index, b in items:
            after = self.system.read(index)
            last_after = after
            if _same(after.ipv4_static, b.ipv4_static) and _same(after.ipv6_static, b.ipv6_static):
                backups.pop(b.guid, None)
            else:
                failed.append(b.alias)
        self._write_backups(backups)
        if failed:
            return ChangeResult(False, f"Couldn't fully restore DNS on {', '.join(failed)}. Your saved settings are "
                                       f"kept so you can try again.", res.message, after=last_after)
        note = f" ({', '.join(missing)} not connected — kept for later.)" if missing else ""
        return ChangeResult(True, "Your previous DNS settings have been restored." + note, res.message, after=last_after)


def _result_file() -> Path:
    fd, p = tempfile.mkstemp(prefix="dnsbench-", suffix=".txt")
    os.close(fd)
    return Path(p)


# ------------------------------------------------------------------ real Windows backend

_READ_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$a = Get-NetAdapter -InterfaceIndex {index}
$g = $a.InterfaceGuid
$v4 = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$g" -Name NameServer -ErrorAction SilentlyContinue).NameServer
$v6 = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\$g" -Name NameServer -ErrorAction SilentlyContinue).NameServer
$c4 = @((Get-DnsClientServerAddress -InterfaceIndex {index} -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
$c6 = @((Get-DnsClientServerAddress -InterfaceIndex {index} -AddressFamily IPv6 -ErrorAction SilentlyContinue).ServerAddresses)
[pscustomobject]@{{ index = {index}; alias = $a.Name; guid = $g; v4static = "$v4"; v6static = "$v6"; v4 = $c4; v6 = $c6 }} | ConvertTo-Json -Compress
"""

_FIND_SCRIPT = r"""
$a = Get-NetAdapter | Where-Object {{ $_.InterfaceGuid -eq {guid} }} | Select-Object -First 1
if ($a) {{ $a.InterfaceIndex }} else {{ -1 }}
"""

_ELEVATE_SCRIPT = r"""
try {{
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-EncodedCommand','{encoded}')
  exit $p.ExitCode
}} catch {{
  $e = $_.Exception; $code = 0
  while ($e) {{ if ($e -is [System.ComponentModel.Win32Exception]) {{ $code = $e.NativeErrorCode; break }}; $e = $e.InnerException }}
  if ($code -eq 1223 -or $_.Exception.Message -match 'cancel') {{ exit 1223 }}
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1222
}}
"""


def parse_read_output(text: str) -> InterfaceDns:
    d = json.loads(text)

    def lst(x) -> list[str]:
        if x is None:
            return []
        return [str(i) for i in (x if isinstance(x, list) else [x]) if i]

    return InterfaceDns(index=int(d["index"]), alias=str(d.get("alias") or ""), guid=str(d.get("guid") or ""),
                        ipv4_static=parse_nameserver_value(d.get("v4static")),
                        ipv6_static=parse_nameserver_value(d.get("v6static")),
                        ipv4_current=lst(d.get("v4")), ipv6_current=lst(d.get("v6")))


def is_admin() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return False


class WindowsDnsSystem:
    def read(self, index: int) -> InterfaceDns:
        from .winshell import run_powershell

        res = run_powershell(_READ_SCRIPT.format(index=int(index)), timeout=30)
        if res.returncode != 0 or not res.stdout.strip():
            raise OSError(res.stderr.strip() or f"PowerShell exit {res.returncode}")
        return parse_read_output(res.stdout)

    def find(self, guid: str) -> InterfaceDns | None:
        from .winshell import run_powershell

        if not re.fullmatch(r"\{?[0-9A-Fa-f-]{36}\}?", guid):
            return None
        res = run_powershell(_FIND_SCRIPT.format(guid=ps_quote(guid)), timeout=30)
        try:
            idx = int(res.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return None
        return self.read(idx) if idx >= 0 else None

    def run_admin_script(self, script: str, result_path: Path) -> AdminResult:
        from .winshell import encode_command, run_powershell

        try:
            if is_admin():
                res = run_powershell(script, timeout=120)
            else:
                res = run_powershell(_ELEVATE_SCRIPT.format(encoded=encode_command(script)), timeout=300)
        except Exception as exc:  # noqa: BLE001
            return AdminResult(False, False, str(exc))
        try:
            outcome = result_path.read_text(encoding="utf-8-sig").strip()
        except OSError:
            outcome = ""
        finally:
            try:
                result_path.unlink()
            except OSError:
                pass
        if res.returncode == UAC_CANCELLED:
            return AdminResult(False, True, "Administrator prompt declined")
        if res.returncode == 0 and outcome == "OK":
            return AdminResult(True, False, "")
        return AdminResult(False, False, outcome or res.stderr.strip() or f"PowerShell exit {res.returncode}")


def dns_manager_available() -> bool:
    return sys.platform == "win32"


def default_manager(root: Path | None = None) -> WindowsDnsManager:
    from .storage import app_dir

    return WindowsDnsManager(WindowsDnsSystem(), (root or app_dir()) / "dns_backup.json")
