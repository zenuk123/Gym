"""Network detection: active adapter, connection type, current DNS servers, gateway, IPv4/IPv6 addresses and
VPN heuristics. Nothing here talks to the internet — it only asks the operating system.

Windows: PowerShell networking cmdlets → JSON (locale-independent, unlike ``ipconfig`` text).
Other OSes (used for development): /etc/resolv.conf + ``ip -j``.
"""

from __future__ import annotations

import ipaddress
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field

from .providers import clean_dns_servers

WINDOWS_SCRIPT = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ad = @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, InterfaceIndex, InterfaceGuid, MediaType, PhysicalMediaType, LinkSpeed, Virtual, HardwareInterface)
$ip = @(Get-NetIPAddress | Select-Object InterfaceIndex, IPAddress, AddressFamily, PrefixOrigin, SuffixOrigin, AddressState)
$dns = @(Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses)
$rt = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0','::/0' | Select-Object InterfaceIndex, NextHop, RouteMetric, DestinationPrefix)
$if = @(Get-NetIPInterface | Select-Object InterfaceIndex, AddressFamily, InterfaceMetric, ConnectionState)
$cp = @(Get-NetConnectionProfile | Select-Object InterfaceIndex, IPv4Connectivity, IPv6Connectivity)
[pscustomobject]@{ adapters = $ad; addresses = $ip; dns = $dns; routes = $rt; interfaces = $if; profiles = $cp } | ConvertTo-Json -Depth 4 -Compress
"""

_VPN_PATTERNS = re.compile(
    r"\b(vpn|wireguard|wintun|openvpn|tap-windows|tap-win32|nordlynx|nordvpn|expressvpn|express\s?vpn|surfshark|"
    r"proton\s?vpn|mullvad|private internet access|anyconnect|globalprotect|pangp|fortinet|forticlient|"
    r"zscaler|tailscale|zerotier|hamachi|softether|sonicwall|juniper|pulse secure|ivanti|cloudflare warp|"
    r"windscribe|cyberghost|hotspot shield|ivpn|astrill|purevpn|ipvanish|tunnelbear|hide\.me|ras async)\b",
    re.IGNORECASE,
)


def looks_like_vpn(*texts: str | None) -> str | None:
    """Return the matching VPN keyword if any adapter text looks like a VPN client."""
    for t in texts:
        if t:
            m = _VPN_PATTERNS.search(t)
            if m:
                return m.group(0)
    return None


def connection_type(physical_media: str | None, media: str | None, name: str = "", vpn: bool = False) -> str:
    pm = (physical_media or "").lower()
    md = (media or "").lower()
    nm = name.lower()
    if vpn:
        return "VPN"
    if "802.11" in pm or "wireless lan" in pm or "wi-fi" in nm or "wifi" in nm or "wlan" in nm:
        return "Wi-Fi"
    if "wireless wan" in pm or "wwan" in nm or "cellular" in nm or "mobile" in nm:
        return "Mobile broadband"
    if "bluetooth" in pm or "bluetooth" in nm:
        return "Bluetooth"
    if "802.3" in pm or "802.3" in md or "ethernet" in nm or nm.startswith(("eth", "en")):
        return "Ethernet"
    return "Unknown"


@dataclass
class AdapterInfo:
    index: int
    name: str
    description: str = ""
    guid: str = ""
    connection_type: str = "Unknown"
    link_speed: str = ""
    ipv4: list[str] = field(default_factory=list)
    ipv6: list[str] = field(default_factory=list)          # global unicast only
    gateway_v4: str | None = None
    gateway_v6: str | None = None
    dns_v4: list[str] = field(default_factory=list)
    dns_v6: list[str] = field(default_factory=list)
    route_metric: int | None = None
    vpn_keyword: str | None = None
    ipv4_connectivity: str | None = None
    ipv6_connectivity: str | None = None

    @property
    def is_vpn(self) -> bool:
        return self.vpn_keyword is not None

    @property
    def dns_servers(self) -> list[str]:
        return clean_dns_servers(self.dns_v4 + self.dns_v6)


@dataclass
class NetworkInfo:
    platform: str
    adapters: list[AdapterInfo] = field(default_factory=list)
    active: AdapterInfo | None = None
    error: str | None = None

    @property
    def dns_servers(self) -> list[str]:
        if self.active and self.active.dns_servers:
            return self.active.dns_servers
        out: list[str] = []
        for a in self.adapters:
            for s in a.dns_servers:
                if s not in out:
                    out.append(s)
        return out

    @property
    def has_ipv4(self) -> bool:
        return bool(self.active and self.active.ipv4)

    @property
    def has_global_ipv6(self) -> bool:
        return any(a.ipv6 for a in ([self.active] if self.active else self.adapters))

    @property
    def vpn(self) -> AdapterInfo | None:
        """A VPN adapter that is up and carries traffic (default route) or provides DNS servers."""
        for a in self.adapters:
            if a.is_vpn and (a.gateway_v4 or a.gateway_v6 or a.dns_servers or a is self.active):
                return a
        return None

    def snapshot(self) -> dict:
        """What we keep with a saved result: enough to explain it later, nothing that identifies you online."""
        a = self.active
        return {
            "platform": self.platform,
            "adapter": a.name if a else None,
            "connection_type": a.connection_type if a else None,
            "dns_servers": self.dns_servers,
            "has_ipv4": self.has_ipv4,
            "has_global_ipv6": self.has_global_ipv6,
            "vpn": self.vpn.name if self.vpn else None,
        }

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------- Windows

_FAMILY = {2: "v4", 23: "v6", "IPv4": "v4", "IPv6": "v6", "InterNetwork": "v4", "InterNetworkV6": "v6"}
_CONNECTIVITY = {0: "Disconnected", 1: "NoTraffic", 2: "Subnet", 3: "LocalNetwork", 4: "Internet"}


def _as_list(x) -> list:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _fam(v) -> str | None:
    return _FAMILY.get(v) if not isinstance(v, str) or v in _FAMILY else None


def _conn(v) -> str | None:
    if v is None:
        return None
    return _CONNECTIVITY.get(v, str(v)) if isinstance(v, int) else str(v)


def is_global_ipv6(addr: str) -> bool:
    try:
        ip = ipaddress.IPv6Address(addr.split("%", 1)[0])
    except ValueError:
        return False
    return ip.is_global or (ip in ipaddress.IPv6Network("2000::/3") and not ip.is_private)


def parse_windows_network(raw: str | dict) -> NetworkInfo:
    data = json.loads(raw) if isinstance(raw, str) else raw
    adapters: dict[int, AdapterInfo] = {}
    for a in _as_list(data.get("adapters")):
        idx = int(a.get("InterfaceIndex"))
        name = a.get("Name") or f"Adapter {idx}"
        desc = a.get("InterfaceDescription") or ""
        vpn = looks_like_vpn(name, desc)
        adapters[idx] = AdapterInfo(
            index=idx, name=name, description=desc, guid=a.get("InterfaceGuid") or "",
            connection_type=connection_type(a.get("PhysicalMediaType"), a.get("MediaType"), name, vpn is not None),
            link_speed=str(a.get("LinkSpeed") or ""), vpn_keyword=vpn,
        )
    for ip in _as_list(data.get("addresses")):
        a = adapters.get(int(ip.get("InterfaceIndex", -1)))
        addr = (ip.get("IPAddress") or "").split("%", 1)[0]
        if a is None or not addr:
            continue
        fam = _fam(ip.get("AddressFamily"))
        if fam == "v4" and not addr.startswith("169.254."):
            a.ipv4.append(addr)
        elif fam == "v6" and is_global_ipv6(addr):
            a.ipv6.append(addr)
    for d in _as_list(data.get("dns")):
        a = adapters.get(int(d.get("InterfaceIndex", -1)))
        if a is None:
            continue
        servers = [str(s) for s in _as_list(d.get("ServerAddresses"))]
        if _fam(d.get("AddressFamily")) == "v6":
            a.dns_v6 = clean_dns_servers(servers)
        else:
            a.dns_v4 = clean_dns_servers(servers)
    metrics: dict[tuple[int, str], int] = {}
    for i in _as_list(data.get("interfaces")):
        fam = _fam(i.get("AddressFamily"))
        if fam:
            metrics[(int(i.get("InterfaceIndex", -1)), fam)] = int(i.get("InterfaceMetric") or 0)
    best: tuple[int, AdapterInfo] | None = None
    for r in _as_list(data.get("routes")):
        a = adapters.get(int(r.get("InterfaceIndex", -1)))
        if a is None:
            continue
        hop = r.get("NextHop") or ""
        v6 = ":" in (r.get("DestinationPrefix") or "")
        fam = "v6" if v6 else "v4"
        if v6:
            a.gateway_v6 = a.gateway_v6 or (hop if hop not in ("::", "") else None)
        else:
            a.gateway_v4 = a.gateway_v4 or (hop if hop not in ("0.0.0.0", "") else None)
        total = int(r.get("RouteMetric") or 0) + metrics.get((a.index, fam), 0)
        if fam == "v4":  # prefer the adapter carrying the IPv4 default route
            a.route_metric = total if a.route_metric is None else min(a.route_metric, total)
            if best is None or total < best[0]:
                best = (total, a)
    for p in _as_list(data.get("profiles")):
        a = adapters.get(int(p.get("InterfaceIndex", -1)))
        if a:
            a.ipv4_connectivity = _conn(p.get("IPv4Connectivity"))
            a.ipv6_connectivity = _conn(p.get("IPv6Connectivity"))
    active = best[1] if best else None
    if active is None:  # IPv6-only, or no default route: pick an adapter that has DNS servers
        with_route = [a for a in adapters.values() if a.gateway_v6]
        active = (with_route or [a for a in adapters.values() if a.dns_servers] or [None])[0]
    ordered = sorted(adapters.values(), key=lambda a: (a is not active, a.route_metric if a.route_metric is not None else 1 << 30))
    return NetworkInfo("windows", ordered, active)


def detect_windows() -> NetworkInfo:
    from .winshell import run_powershell

    try:
        res = run_powershell(WINDOWS_SCRIPT, timeout=30)
    except Exception as exc:  # noqa: BLE001
        return NetworkInfo("windows", error=f"Could not read network settings: {exc}")
    out = res.stdout.strip()
    if not out:
        return NetworkInfo("windows", error=f"Could not read network settings (PowerShell exit {res.returncode}). "
                                            f"{res.stderr.strip()[:300]}")
    try:
        return parse_windows_network(out)
    except (ValueError, TypeError, KeyError) as exc:
        return NetworkInfo("windows", error=f"Could not understand network settings: {exc}")


# ---------------------------------------------------------------- Linux / other (development)

def parse_resolv_conf(text: str) -> list[str]:
    servers = []
    for line in text.splitlines():
        parts = line.split("#", 1)[0].split()
        if len(parts) >= 2 and parts[0] == "nameserver":
            servers.append(parts[1])
    return clean_dns_servers(servers)


def parse_linux_network(routes_json: str, addrs_json: str, resolv_conf: str) -> NetworkInfo:
    routes = json.loads(routes_json) if routes_json.strip() else []
    addrs = json.loads(addrs_json) if addrs_json.strip() else []
    dns = parse_resolv_conf(resolv_conf)
    adapters: dict[str, AdapterInfo] = {}
    for a in addrs:
        name = a.get("ifname", "?")
        if name == "lo" or "UP" not in a.get("flags", []):
            continue
        vpn = looks_like_vpn(name) or ("vpn" if re.match(r"^(tun|wg|ppp)\d", name) else None)
        info = AdapterInfo(index=int(a.get("ifindex", 0)), name=name,
                           connection_type=connection_type(None, None, name, vpn is not None), vpn_keyword=vpn)
        for ai in a.get("addr_info", []):
            local = ai.get("local", "")
            if ai.get("family") == "inet":
                info.ipv4.append(local)
            elif ai.get("family") == "inet6" and is_global_ipv6(local):
                info.ipv6.append(local)
        adapters[name] = info
    active = None
    for r in routes:
        a = adapters.get(r.get("dev", ""))
        if a is None:
            continue
        gw = r.get("gateway")
        if gw and ":" in gw:
            a.gateway_v6 = a.gateway_v6 or gw
        elif gw:
            a.gateway_v4 = a.gateway_v4 or gw
        metric = int(r.get("metric", 0))
        if active is None or metric < (active.route_metric or 0):
            a.route_metric = metric
            active = a
    if active:
        active.dns_v4 = [s for s in dns if ":" not in s]
        active.dns_v6 = [s for s in dns if ":" in s]
    ordered = sorted(adapters.values(), key=lambda a: a is not active)
    return NetworkInfo(sys.platform, ordered, active)


def _run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout  # noqa: S603
    except (OSError, subprocess.SubprocessError):
        return ""


def detect_posix() -> NetworkInfo:
    try:
        resolv = open("/etc/resolv.conf", encoding="utf-8").read()
    except OSError:
        resolv = ""
    if "127.0.0.53" in resolv:  # systemd-resolved stub: the real upstream servers are listed here
        try:
            resolv = open("/run/systemd/resolve/resolv.conf", encoding="utf-8").read()
        except OSError:
            pass
    routes = _run(["ip", "-j", "route", "show", "default"]) + _run(["ip", "-j", "-6", "route", "show", "default"])
    routes = routes.replace("][", ",")
    try:
        info = parse_linux_network(routes, _run(["ip", "-j", "addr", "show"]), resolv)
    except ValueError as exc:
        info = NetworkInfo(sys.platform, error=str(exc))
        info.adapters = []
    if info.active is None and not info.adapters:
        dns = parse_resolv_conf(resolv)
        if dns:
            info.active = AdapterInfo(0, "default", dns_v4=[s for s in dns if ":" not in s],
                                      dns_v6=[s for s in dns if ":" in s])
            info.adapters = [info.active]
    if info.active is not None and not info.active.ipv4:
        local = local_address_for("1.1.1.1")
        if local:
            info.active.ipv4.append(local)
    return info


def local_address_for(remote: str) -> str | None:
    """The local address the OS would use to reach ``remote`` (UDP connect sends no packets)."""
    import socket

    fam = socket.AF_INET6 if ":" in remote else socket.AF_INET
    try:
        with socket.socket(fam, socket.SOCK_DGRAM) as s:
            s.connect((remote, 53))
            return s.getsockname()[0]
    except OSError:
        return None


def detect_network() -> NetworkInfo:
    return detect_windows() if sys.platform == "win32" else detect_posix()
