"""DNS resolution and timeout handling against a real (local) DNS server."""

import asyncio
import socket
import time

from dnsbench.errors import ErrorCode
from dnsbench.models import Family, Outcome, Target
from dnsbench.transport import TcpTransport, UdpTransport

T = Target("test", "127.0.0.1", Family.V4)


def q(transport, name, timeout=1.0):
    return asyncio.run(transport.query(T, name, "A", timeout))


def test_successful_resolution_measures_latency(dns_server):
    r = q(UdpTransport(dns_server.port), "slow-30.example.com")
    assert r.outcome is Outcome.OK and r.rcode == "NOERROR"
    assert r.answers == ["192.0.2.10"]
    assert 25 <= r.latency_ms < 500  # the server waited 30 ms


def test_nxdomain_is_a_successful_answer(dns_server):
    r = q(UdpTransport(dns_server.port), "nx.example.com")
    assert r.outcome is Outcome.OK and r.rcode == "NXDOMAIN"


def test_servfail_and_refused_are_failures(dns_server):
    t = UdpTransport(dns_server.port)
    assert (q(t, "fail.example.com").outcome, q(t, "fail.example.com").error_code) == (Outcome.ERROR, ErrorCode.SERVFAIL)
    r = q(t, "refuse.example.com")
    assert r.outcome is Outcome.ERROR and r.error_code == ErrorCode.REFUSED and r.rcode == "REFUSED"


def test_timeout_is_reported_within_the_limit(dns_server):
    start = time.perf_counter()
    r = q(UdpTransport(dns_server.port), "silent.example.com", timeout=0.4)
    took = time.perf_counter() - start
    assert r.outcome is Outcome.TIMEOUT and r.error_code == ErrorCode.TIMEOUT and r.latency_ms is None
    assert 0.35 <= took < 1.5


def test_truncated_udp_answer_falls_back_to_tcp(dns_server):
    r = q(UdpTransport(dns_server.port), "big.example.com")
    assert r.outcome is Outcome.OK and r.via_tcp
    assert ("tcp", "big.example.com") in dns_server.queries


def test_tcp_transport(dns_server):
    r = q(TcpTransport(dns_server.port), "example.com")
    assert r.outcome is Outcome.OK and r.via_tcp


def test_closed_port_is_unreachable_not_a_crash():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()  # nothing listens here now
    r = q(UdpTransport(port), "example.com", timeout=0.5)
    assert r.outcome in (Outcome.ERROR, Outcome.TIMEOUT)
    assert r.error_code in (ErrorCode.PORT_CLOSED, ErrorCode.TIMEOUT)


def _dot_client(port, verify=True):
    import os
    import ssl

    from dnsbench.transport import DotTransport

    ctx = ssl.create_default_context(cafile=os.path.join(os.path.dirname(__file__), "data", "dot-test-cert.pem"))
    if not verify:
        ctx = ssl.create_default_context()  # system CAs only: the test certificate is not trusted
    return DotTransport(port, ctx)


def test_dns_over_tls_reuses_one_connection(dot_server):
    from dnsbench.models import Protocol

    t = Target("test", "127.0.0.1", Family.V4, "primary", Protocol.DOT, "dot.test")

    async def go():
        client = _dot_client(dot_server.port)
        out = [await client.query(t, f"q{i}.example.com", "A", 2.0) for i in range(3)]
        out.append(await client.query(t, "nx.example.com", "A", 2.0))
        await client.close()
        return out

    results = asyncio.run(go())
    assert all(r.outcome is Outcome.OK and r.via_tcp for r in results)
    assert results[-1].rcode == "NXDOMAIN"
    assert dot_server.connections == 1  # TLS handshake paid once, not per query


def test_dns_over_tls_rejects_untrusted_certificate(dot_server):
    from dnsbench.models import Protocol

    t = Target("test", "127.0.0.1", Family.V4, "primary", Protocol.DOT, "dot.test")
    r = asyncio.run(_dot_client(dot_server.port, verify=False).query(t, "example.com", "A", 2.0))
    assert r.outcome is Outcome.ERROR and r.error_code == ErrorCode.TLS
