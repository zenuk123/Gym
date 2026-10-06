"""DNS transports: the only code that touches the network for benchmark queries.

Every transport implements ``async query(target, qname, rdtype, timeout) -> QueryResult`` and measures time
from just before the request is sent until the parsed response is back. New protocols (DoH, …) only need a
new class registered in ``RealTransport``.
"""

from __future__ import annotations

import asyncio
import socket
import ssl
import time
from typing import Protocol as TypingProtocol

import dns.asyncbackend
import dns.asyncquery
import dns.flags
import dns.message
import dns.rcode
import dns.rdataclass
import dns.rdatatype

from .errors import ErrorCode, classify_exception
from .models import Outcome, Protocol, QueryResult, Target

SUCCESS_RCODES = {dns.rcode.NOERROR, dns.rcode.NXDOMAIN}


class Transport(TypingProtocol):
    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult: ...

    async def close(self) -> None: ...


def make_query(qname: str, rdtype: str = "A", rdclass: str = "IN") -> dns.message.QueryMessage:
    # EDNS0 with a 1232-byte payload (the DNS Flag Day 2020 recommendation) — what modern stub resolvers send.
    q = dns.message.make_query(qname, rdtype, rdclass=rdclass, use_edns=0, payload=1232)
    q.flags |= dns.flags.RD
    return q


def interpret_response(resp: dns.message.Message, latency_ms: float, via_tcp: bool) -> QueryResult:
    rcode = resp.rcode()
    answers = [r.to_text() for rrset in resp.answer for r in rrset]
    text = dns.rcode.to_text(rcode)
    if rcode in SUCCESS_RCODES:
        return QueryResult(Outcome.OK, latency_ms, text, via_tcp=via_tcp, answers=answers)
    code = {dns.rcode.SERVFAIL: ErrorCode.SERVFAIL, dns.rcode.REFUSED: ErrorCode.REFUSED}.get(rcode, ErrorCode.BAD_RCODE)
    return QueryResult(Outcome.ERROR, latency_ms, text, code, f"Server answered with {text}", via_tcp=via_tcp)


def _failure(exc: BaseException) -> QueryResult:
    code, detail = classify_exception(exc)
    outcome = Outcome.TIMEOUT if code == ErrorCode.TIMEOUT else Outcome.ERROR
    return QueryResult(outcome, None, None, code, detail)


class UdpTransport:
    """Classic DNS: UDP port 53, retried over TCP if the answer is truncated (exactly what a router does)."""

    def __init__(self, port: int = 53) -> None:
        self.port = port

    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult:
        q = make_query(qname, rdtype, rdclass)
        start = time.perf_counter()
        try:
            resp, via_tcp = await asyncio.wait_for(
                dns.asyncquery.udp_with_fallback(q, target.address, timeout=timeout, port=self.port), timeout)
        except (asyncio.TimeoutError, TimeoutError):
            return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, f"No reply within {timeout:g}s")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - every failure becomes a recorded result
            return _failure(exc)
        return interpret_response(resp, (time.perf_counter() - start) * 1000.0, via_tcp)

    async def close(self) -> None:
        return None


class TcpTransport:
    """DNS over TCP (one connection per query, as stub resolvers normally do for TCP fallback)."""

    def __init__(self, port: int = 53) -> None:
        self.port = port

    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult:
        q = make_query(qname, rdtype, rdclass)
        start = time.perf_counter()
        try:
            resp = await asyncio.wait_for(dns.asyncquery.tcp(q, target.address, timeout=timeout, port=self.port), timeout)
        except (asyncio.TimeoutError, TimeoutError):
            return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, f"No reply within {timeout:g}s")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            return _failure(exc)
        return interpret_response(resp, (time.perf_counter() - start) * 1000.0, True)

    async def close(self) -> None:
        return None


class DotTransport:
    """DNS over TLS (port 853) with one persistent connection per server.

    Real DoT clients keep the TLS session open, so the handshake is paid once and *not* included in the
    per-query latency. If the connection drops, the next query reconnects and that query's time includes
    the handshake (an honest cost).
    """

    def __init__(self, port: int = 853, ssl_context: ssl.SSLContext | None = None) -> None:
        self.port = port
        self._socks: dict[str, object] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._ctx = ssl_context or ssl.create_default_context()

    async def _connect(self, target: Target, timeout: float):
        backend = dns.asyncbackend.get_default_backend()
        af = socket.AF_INET6 if ":" in target.address else socket.AF_INET
        return await backend.make_socket(af, socket.SOCK_STREAM, 0, None, (target.address, self.port), timeout,
                                         self._ctx, target.tls_hostname)

    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult:
        if not target.tls_hostname:
            return QueryResult(Outcome.ERROR, None, None, ErrorCode.TLS, "Provider has no DNS-over-TLS hostname")
        lock = self._locks.setdefault(target.id, asyncio.Lock())
        async with lock:
            sock = self._socks.get(target.id)
            if sock is None:
                try:
                    sock = await asyncio.wait_for(self._connect(target, timeout), timeout)
                except asyncio.CancelledError:
                    raise
                except (asyncio.TimeoutError, TimeoutError):
                    return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, "TLS connect timed out")
                except Exception as exc:  # noqa: BLE001
                    return _failure(exc)
                self._socks[target.id] = sock
            q = make_query(qname, rdtype, rdclass)
            start = time.perf_counter()
            try:
                resp = await asyncio.wait_for(dns.asyncquery.tls(q, target.address, timeout=timeout, port=self.port,
                                                                 sock=sock, server_hostname=target.tls_hostname), timeout)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                await self._drop(target.id)
                if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
                    return QueryResult(Outcome.TIMEOUT, None, None, ErrorCode.TIMEOUT, f"No reply within {timeout:g}s")
                return _failure(exc)
            return interpret_response(resp, (time.perf_counter() - start) * 1000.0, True)

    async def _drop(self, key: str) -> None:
        sock = self._socks.pop(key, None)
        if sock is not None:
            try:
                await sock.close()
            except Exception:  # noqa: BLE001
                pass

    async def close(self) -> None:
        for key in list(self._socks):
            await self._drop(key)


class RealTransport:
    """Dispatches to the right protocol implementation for each target."""

    def __init__(self, port: int = 53) -> None:
        self._impl: dict[Protocol, Transport] = {
            Protocol.UDP: UdpTransport(port),
            Protocol.TCP: TcpTransport(port),
            Protocol.DOT: DotTransport(),
        }

    async def query(self, target: Target, qname: str, rdtype: str = "A", timeout: float = 2.0,
                    rdclass: str = "IN") -> QueryResult:
        return await self._impl[target.protocol].query(target, qname, rdtype, timeout, rdclass)

    async def close(self) -> None:
        for impl in self._impl.values():
            await impl.close()
