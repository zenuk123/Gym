"""DNS provider database: built-in providers (``data/providers.json``) + user-added custom providers
+ the DNS servers Windows is currently using."""

from __future__ import annotations

import ipaddress
import json
import re
from dataclasses import dataclass, field
from importlib import resources

from .models import Family, Protocol, Target, family_of, is_valid_ip

CURRENT_ID = "current"


@dataclass
class Provider:
    id: str
    name: str
    ipv4: list[str]
    ipv6: list[str] = field(default_factory=list)
    short: str | None = None
    description: str = ""
    website: str = ""
    features: list[str] = field(default_factory=list)
    tls_hostname: str | None = None
    doh_url: str | None = None
    enabled_by_default: bool = True
    custom: bool = False
    is_current: bool = False  # this provider is (one of) the DNS servers Windows uses right now

    @property
    def display_name(self) -> str:
        return self.short or self.name

    def addresses(self, family: Family) -> list[str]:
        return list(self.ipv4 if family is Family.V4 else self.ipv6)

    def targets(self, families: set[Family], protocol: Protocol = Protocol.UDP) -> list[Target]:
        out: list[Target] = []
        for fam in (Family.V4, Family.V6):
            if fam not in families:
                continue
            for i, addr in enumerate(self.addresses(fam)):
                role = "primary" if i == 0 else "secondary" if i == 1 else f"server {i + 1}"
                out.append(Target(self.id, addr, fam, role, protocol, self.tls_hostname))
        return out

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "short": self.short, "ipv4": self.ipv4, "ipv6": self.ipv6,
            "description": self.description, "website": self.website, "features": self.features,
            "tls_hostname": self.tls_hostname, "doh_url": self.doh_url,
            "enabled_by_default": self.enabled_by_default, "custom": self.custom, "is_current": self.is_current,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Provider:
        return cls(
            id=str(d["id"]), name=str(d["name"]), ipv4=list(d.get("ipv4") or []), ipv6=list(d.get("ipv6") or []),
            short=d.get("short"), description=d.get("description", ""), website=d.get("website", ""),
            features=list(d.get("features") or []), tls_hostname=d.get("tls_hostname"), doh_url=d.get("doh_url"),
            enabled_by_default=bool(d.get("enabled_by_default", True)), custom=bool(d.get("custom", False)),
            is_current=bool(d.get("is_current", False)),
        )


class ProviderError(ValueError):
    pass


def validate_provider(p: Provider) -> None:
    """Raise ProviderError with a friendly message if a provider definition is unusable."""
    if not p.id or not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", p.id):
        raise ProviderError(f"Provider id {p.id!r} must be lowercase letters, digits, '.', '-' or '_'.")
    if not p.name.strip():
        raise ProviderError("Every provider needs a name.")
    if not p.ipv4 and not p.ipv6:
        raise ProviderError(f"{p.name} needs at least one DNS server address.")
    for addr in p.ipv4:
        if not is_valid_ip(addr) or family_of(addr) is not Family.V4:
            raise ProviderError(f"{addr!r} is not a valid IPv4 address ({p.name}).")
    for addr in p.ipv6:
        if not is_valid_ip(addr) or family_of(addr) is not Family.V6:
            raise ProviderError(f"{addr!r} is not a valid IPv6 address ({p.name}).")


def load_builtin_providers() -> list[Provider]:
    raw = resources.files("dnsbench.data").joinpath("providers.json").read_text(encoding="utf-8")
    return parse_providers(json.loads(raw))


def parse_providers(data: dict) -> list[Provider]:
    providers = [Provider.from_dict(d) for d in data.get("providers", [])]
    seen: set[str] = set()
    for p in providers:
        validate_provider(p)
        if p.id in seen:
            raise ProviderError(f"Duplicate provider id {p.id!r}.")
        seen.add(p.id)
    return providers


def make_custom_provider(name: str, primary: str, secondary: str = "", existing_ids: set[str] | None = None) -> Provider:
    """Build a user-defined provider from up to two addresses (IPv4 and/or IPv6 mixed)."""
    addrs = [a.strip() for a in (primary, secondary) if a and a.strip()]
    if not addrs:
        raise ProviderError("Enter at least one DNS server address.")
    for a in addrs:
        if not is_valid_ip(a):
            raise ProviderError(f"{a!r} is not a valid IP address.")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "custom"
    pid = f"custom-{slug}"
    n = 2
    while existing_ids and pid in existing_ids:
        pid = f"custom-{slug}-{n}"
        n += 1
    p = Provider(
        id=pid, name=name.strip() or "Custom DNS",
        ipv4=[a for a in addrs if family_of(a) is Family.V4],
        ipv6=[a for a in addrs if family_of(a) is Family.V6],
        description="Added by you.", custom=True,
    )
    validate_provider(p)
    return p


# Windows lists these deprecated site-local placeholders when IPv6 has no real DNS server.
_PLACEHOLDER_V6 = {"fec0:0:0:ffff::1", "fec0:0:0:ffff::2", "fec0:0:0:ffff::3"}


def clean_dns_servers(servers: list[str]) -> list[str]:
    """Drop invalid entries, Windows' fec0::ffff placeholders and duplicates (order kept)."""
    out: list[str] = []
    for s in servers:
        s = s.strip()
        if not s or not is_valid_ip(s):
            continue
        host = s.split("%", 1)[0]
        if str(ipaddress.ip_address(host)) in _PLACEHOLDER_V6:
            continue
        if s not in out:
            out.append(s)
    return out


def describe_server(address: str) -> str:
    """Plain-English kind of a DNS server address the computer is using."""
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if ip.is_loopback:
        return "a DNS program on this PC"
    if ip.is_link_local or ip.is_private:
        return "your router"
    return "your ISP or network"


def merge_current_dns(providers: list[Provider], current_servers: list[str]) -> list[Provider]:
    """Mark known providers that are already in use and add a "Your current DNS" entry for unknown servers.

    Never guesses the ISP: unknown servers are tested exactly as detected.
    """
    servers = clean_dns_servers(current_servers)
    result = [Provider.from_dict(p.to_dict()) for p in providers]
    unknown: list[str] = []
    for s in servers:
        owner = next((p for p in result if s in p.ipv4 or s in p.ipv6), None)
        if owner:
            owner.is_current = True
        else:
            unknown.append(s)
    if unknown:
        kinds = {describe_server(s) for s in unknown}
        kind = kinds.pop() if len(kinds) == 1 else "your network"
        result.insert(0, Provider(
            id=CURRENT_ID,
            name=f"Current DNS ({kind})",
            short="Current DNS",
            ipv4=[s for s in unknown if family_of(s) is Family.V4],
            ipv6=[s for s in unknown if family_of(s) is Family.V6],
            description=f"The DNS server(s) this PC uses right now — provided by {kind}.",
            is_current=True,
            enabled_by_default=True,
        ))
    return result


def provider_for_address(providers: list[Provider], address: str) -> Provider | None:
    return next((p for p in providers if address in p.ipv4 or address in p.ipv6), None)
