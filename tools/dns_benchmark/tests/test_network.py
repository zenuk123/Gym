import asyncio
import json

from dnsbench import diagnostics
from dnsbench.diagnostics import Preflight, judge_identity, run_preflight
from dnsbench.fake import FakeTransport, LatencyProfile
from dnsbench.models import Family, Outcome, QueryResult
from dnsbench.network import (connection_type, looks_like_vpn, parse_linux_network, parse_resolv_conf,
                              parse_windows_network)
from tests.fixtures_windows import VPN_JSON, WINDOWS_JSON


def test_windows_active_adapter_is_lowest_metric_default_route():
    n = parse_windows_network(json.dumps(WINDOWS_JSON))
    assert n.active.name == "Ethernet"  # metric 0+25 beats Wi-Fi 0+35
    assert n.active.connection_type == "Ethernet"
    assert n.dns_servers == ["192.168.1.1"]  # single string (PowerShell's 1-element quirk) handled
    assert n.active.gateway_v4 == "192.168.1.1"
    assert n.vpn is None


def test_windows_ipv4_and_ipv6_detection():
    n = parse_windows_network(WINDOWS_JSON)
    wifi = next(a for a in n.adapters if a.name == "Wi-Fi")
    assert wifi.ipv4 == ["192.168.1.23"]
    assert wifi.ipv6 == ["2a02:c7f:1234:5600:1111:2222:3333:4444"]  # link-local excluded
    assert wifi.connection_type == "Wi-Fi" and wifi.ipv4_connectivity == "Internet"
    assert wifi.gateway_v6 == "fe80::1"
    assert wifi.dns_servers == ["192.168.1.1", "fe80::1%12"]
    hyperv = next(a for a in n.adapters if a.index == 30)
    assert hyperv.dns_servers == []  # fec0::ffff placeholders dropped
    assert n.has_ipv4 and not n.has_global_ipv6  # active (Ethernet) has no global IPv6


def test_ipv6_only_on_active_adapter():
    data = json.loads(json.dumps(WINDOWS_JSON))
    data["routes"] = [r for r in data["routes"] if r["InterfaceIndex"] == 12]
    n = parse_windows_network(data)
    assert n.active.name == "Wi-Fi" and n.has_global_ipv6


def test_vpn_detected_and_reported():
    n = parse_windows_network(VPN_JSON)
    assert n.vpn is not None and n.vpn.name == "NordLynx"
    assert n.snapshot()["vpn"] == "NordLynx"
    assert looks_like_vpn("WireGuard Tunnel") and looks_like_vpn("TAP-Windows Adapter V9")
    assert not looks_like_vpn("Intel(R) Ethernet Connection", "Hyper-V Virtual Ethernet Adapter", "Teredo Tunneling")


def test_connection_type_heuristics():
    assert connection_type("Native 802.11", None) == "Wi-Fi"
    assert connection_type("802.3", "802.3") == "Ethernet"
    assert connection_type("Wireless WAN", None) == "Mobile broadband"
    assert connection_type("802.3", None, vpn=True) == "VPN"


def test_linux_parsers():
    assert parse_resolv_conf("# hi\nnameserver 1.1.1.1\nnameserver 2606:4700:4700::1111 # c\nsearch lan\n") == \
        ["1.1.1.1", "2606:4700:4700::1111"]
    routes = '[{"dst":"default","gateway":"192.168.1.1","dev":"wlan0","metric":600}]'
    addrs = json.dumps([{"ifname": "lo", "flags": ["UP"]},
                        {"ifindex": 3, "ifname": "wlan0", "flags": ["UP"], "addr_info": [
                            {"family": "inet", "local": "192.168.1.9"}, {"family": "inet6", "local": "fe80::1"}]}])
    n = parse_linux_network(routes, addrs, "nameserver 192.168.1.1\n")
    assert n.active.name == "wlan0" and n.active.connection_type == "Wi-Fi" and n.dns_servers == ["192.168.1.1"]
    assert n.has_ipv4 and not n.has_global_ipv6


# ---------------------------------------------------------------- pre-flight (IPv4/IPv6, internet, interception)

def preflight(transport, monkeypatch, routes=(True, True), current=("192.168.1.1",)):
    monkeypatch.setattr(diagnostics, "has_route", lambda a: routes[1] if ":" in a else routes[0])
    return asyncio.run(run_preflight(transport, list(current), connectivity_check=False, timeout=0.5))


def test_ipv6_unavailable_is_not_a_failure(monkeypatch):
    pf = preflight(FakeTransport({}, LatencyProfile(10)), monkeypatch, routes=(True, False))
    assert pf.ipv4 == "available" and pf.ipv6 == "no_route" and pf.internet
    assert any("IPv6 testing is unavailable" in m for _, m in pf.warnings())


def test_ipv6_route_but_not_working(monkeypatch):
    v6_dead = {a: LatencyProfile(10, unreachable=True) for a in diagnostics.ANCHORS_V6}
    pf = preflight(FakeTransport(v6_dead, LatencyProfile(10)), monkeypatch)
    assert pf.ipv6 == "not_working" and pf.ipv4 == "available"


def test_ipv6_available(monkeypatch):
    assert preflight(FakeTransport({}, LatencyProfile(10)), monkeypatch).ipv6 == "available"


def test_no_internet(monkeypatch):
    pf = preflight(FakeTransport({}, LatencyProfile(10, unreachable=True)), monkeypatch)
    assert not pf.internet and pf.warnings()[0][0] == "error"


def test_public_dns_blocked_by_firewall(monkeypatch):
    blocked = {a: LatencyProfile(1, unreachable=True) for a in diagnostics.ANCHORS_V4 + diagnostics.ANCHORS_V6}
    pf = preflight(FakeTransport(blocked, LatencyProfile(10)), monkeypatch)
    assert pf.internet and pf.public_dns_blocked
    assert "blocking outbound DNS" in pf.warnings()[0][1]


def test_honest_network_passes_interception_checks(monkeypatch):
    pf = preflight(FakeTransport({}, LatencyProfile(10)), monkeypatch)
    assert not pf.interception_suspected
    assert [c.result for c in pf.identity_checks] == ["pass", "pass", "pass"]
    assert pf.nxdomain_redirect is False
    assert pf.upstream_resolver == "203.0.113.53" and pf.upstream_name == "resolver1.example-isp.net"


class Intercepting(FakeTransport):
    """Everything is answered by one resolver that doesn't know the providers' identity names."""

    async def query(self, target, qname, rdtype="A", timeout=2.0, rdclass="IN"):
        if qname in ("id.server", "debug.opendns.com"):
            return QueryResult(Outcome.ERROR, 3, "SERVFAIL", "servfail")
        if qname.endswith("-nonexistent.com"):  # ISP NXDOMAIN redirection
            return QueryResult(Outcome.OK, 3, "NOERROR", answers=["198.51.100.1"])
        return await super().query(target, qname, rdtype, timeout, rdclass)


def test_dns_interception_and_nxdomain_redirect_detected(monkeypatch):
    pf = preflight(Intercepting({}, LatencyProfile(10)), monkeypatch)
    assert pf.interception_suspected and pf.nxdomain_redirect
    msgs = " ".join(m for _, m in pf.warnings())
    assert "DNS redirection detected" in msgs and "NXDOMAIN redirection" in msgs
    assert Preflight.from_dict(pf.to_dict()).interception_suspected


def test_identity_judgement():
    assert judge_identity("cloudflare", "NOERROR", Outcome.OK, ['"LHR"'])[0] == "pass"
    assert judge_identity("cloudflare", "NOERROR", Outcome.OK, ['"res100.ams.rrdns.pch.net"'])[0] == "fail"
    assert judge_identity("quad9", "NOERROR", Outcome.OK, ['"res100.ams.rrdns.pch.net"'])[0] == "pass"
    assert judge_identity("opendns", "NOERROR", Outcome.OK, ['"server m12.lon"', '"flags 20"'])[0] == "pass"
    assert judge_identity("opendns", "NOERROR", Outcome.OK, [])[0] == "fail"
    assert judge_identity("quad9", None, Outcome.TIMEOUT, [])[0] == "inconclusive"


def test_route_check_is_real_and_safe():
    assert diagnostics.has_route("127.0.0.1")
    assert isinstance(diagnostics.has_route("2606:4700:4700::1111"), bool)
    assert Family.V6.label == "IPv6"
