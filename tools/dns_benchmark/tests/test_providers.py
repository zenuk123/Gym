import pytest

from dnsbench.models import Family
from dnsbench.providers import (CURRENT_ID, ProviderError, clean_dns_servers, load_builtin_providers,
                                make_custom_provider, merge_current_dns, parse_providers)

REQUIRED = {
    "cloudflare": ["1.1.1.1", "1.0.0.1"], "google": ["8.8.8.8", "8.8.4.4"], "quad9": ["9.9.9.9", "149.112.112.112"],
    "adguard": ["94.140.14.14", "94.140.15.15"], "opendns": ["208.67.222.222", "208.67.220.220"],
    "controld": ["76.76.2.0", "76.76.10.0"],
}


def test_builtin_database_loads_and_contains_required_providers():
    providers = {p.id: p for p in load_builtin_providers()}
    for pid, addrs in REQUIRED.items():
        assert providers[pid].ipv4 == addrs and providers[pid].enabled_by_default
        assert providers[pid].ipv6, f"{pid} should list IPv6 servers"
    assert len({a for p in providers.values() for a in p.ipv4}) == sum(len(p.ipv4) for p in providers.values())


def test_targets_have_roles_and_families():
    p = next(p for p in load_builtin_providers() if p.id == "cloudflare")
    ts = p.targets({Family.V4, Family.V6})
    assert [(t.address, t.role) for t in ts if t.family is Family.V4] == [("1.1.1.1", "primary"), ("1.0.0.1", "secondary")]
    assert len([t for t in ts if t.family is Family.V6]) == 2
    assert all(t.family is Family.V4 for t in p.targets({Family.V4}))


def test_invalid_database_entries_are_rejected():
    with pytest.raises(ProviderError):
        parse_providers({"providers": [{"id": "x", "name": "X", "ipv4": ["999.1.1.1"]}]})
    with pytest.raises(ProviderError):
        parse_providers({"providers": [{"id": "x", "name": "X", "ipv4": ["2606:4700::1"]}]})  # v6 in v4 list
    with pytest.raises(ProviderError):
        parse_providers({"providers": [{"id": "x", "name": "X", "ipv4": ["1.1.1.1"]},
                                       {"id": "x", "name": "Y", "ipv4": ["1.0.0.1"]}]})


def test_custom_provider():
    p = make_custom_provider("My Pi-hole", "192.168.1.5", "fd00::5", existing_ids={"custom-my-pi-hole"})
    assert p.id == "custom-my-pi-hole-2" and p.ipv4 == ["192.168.1.5"] and p.ipv6 == ["fd00::5"] and p.custom
    with pytest.raises(ProviderError):
        make_custom_provider("Bad", "not-an-ip")
    with pytest.raises(ProviderError):
        make_custom_provider("Empty", "")


def test_windows_placeholders_and_duplicates_are_removed():
    assert clean_dns_servers(["192.168.1.1", "fec0:0:0:ffff::1", "192.168.1.1", "junk", "fec0:0:0:ffff::2"]) == ["192.168.1.1"]


def test_current_dns_detected_as_router_and_tested():
    merged = merge_current_dns(load_builtin_providers(), ["192.168.0.1"])
    cur = merged[0]
    assert cur.id == CURRENT_ID and cur.ipv4 == ["192.168.0.1"] and cur.is_current
    assert "router" in cur.name


def test_current_dns_matching_a_known_provider_is_not_duplicated():
    merged = merge_current_dns(load_builtin_providers(), ["1.1.1.1", "1.0.0.1"])
    assert all(p.id != CURRENT_ID for p in merged)
    assert next(p for p in merged if p.id == "cloudflare").is_current


def test_isp_dns_is_never_assumed():
    merged = merge_current_dns(load_builtin_providers(), ["194.168.4.100", "2a02:8000::1"])
    cur = merged[0]
    assert cur.ipv4 == ["194.168.4.100"] and cur.ipv6 == ["2a02:8000::1"] and "ISP" in cur.name
    assert merge_current_dns(load_builtin_providers(), [])[0].id != CURRENT_ID
