"""Turn low-level failures into plain English (with the technical detail kept for "Technical details")."""

from __future__ import annotations

import errno
import socket
import ssl


class ErrorCode:
    TIMEOUT = "timeout"
    PORT_CLOSED = "port_closed"            # ICMP port unreachable / WSAECONNRESET
    NETWORK_UNREACHABLE = "network_unreachable"
    HOST_UNREACHABLE = "host_unreachable"
    BLOCKED = "blocked"                    # permission denied (firewall / security software)
    NO_IPV6 = "no_ipv6"
    SERVFAIL = "servfail"
    REFUSED = "refused"
    BAD_RCODE = "bad_rcode"
    BAD_RESPONSE = "bad_response"          # malformed / mismatched / unexpected source
    TLS = "tls"
    OTHER = "other"


# Windows socket error numbers (winerror) — Python maps some, but not all, to errno values.
_WSA = {
    10054: ErrorCode.PORT_CLOSED,          # WSAECONNRESET: ICMP port unreachable on a UDP socket
    10061: ErrorCode.PORT_CLOSED,          # WSAECONNREFUSED
    10051: ErrorCode.NETWORK_UNREACHABLE,  # WSAENETUNREACH
    10065: ErrorCode.HOST_UNREACHABLE,     # WSAEHOSTUNREACH
    10013: ErrorCode.BLOCKED,              # WSAEACCES
    10047: ErrorCode.NO_IPV6,              # WSAEAFNOSUPPORT
    10049: ErrorCode.NO_IPV6,              # WSAEADDRNOTAVAIL (no usable source address)
    10060: ErrorCode.TIMEOUT,              # WSAETIMEDOUT
}

_ERRNO = {
    errno.ECONNREFUSED: ErrorCode.PORT_CLOSED,
    errno.ECONNRESET: ErrorCode.PORT_CLOSED,
    errno.ENETUNREACH: ErrorCode.NETWORK_UNREACHABLE,
    errno.EHOSTUNREACH: ErrorCode.HOST_UNREACHABLE,
    errno.EACCES: ErrorCode.BLOCKED,
    errno.EPERM: ErrorCode.BLOCKED,
    errno.EAFNOSUPPORT: ErrorCode.NO_IPV6,
    errno.EADDRNOTAVAIL: ErrorCode.NO_IPV6,
    errno.ETIMEDOUT: ErrorCode.TIMEOUT,
}


def classify_exception(exc: BaseException) -> tuple[str, str]:
    """Map an exception raised while querying to (ErrorCode, technical detail)."""
    detail = f"{type(exc).__name__}: {exc}".strip()
    try:
        import dns.exception
        import dns.message
        import dns.query

        if isinstance(exc, dns.exception.Timeout):
            return ErrorCode.TIMEOUT, detail
        if isinstance(exc, (dns.query.BadResponse, dns.query.UnexpectedSource, dns.message.TrailingJunk,
                            dns.exception.FormError, dns.message.ShortHeader)):
            return ErrorCode.BAD_RESPONSE, detail
    except ImportError:  # pragma: no cover - dnspython is a hard dependency
        pass
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return ErrorCode.TIMEOUT, detail
    if isinstance(exc, ssl.SSLError):
        return ErrorCode.TLS, detail
    if isinstance(exc, OSError):
        winerror = getattr(exc, "winerror", None)
        if winerror in _WSA:
            return _WSA[winerror], detail
        if exc.errno in _ERRNO:
            return _ERRNO[exc.errno], detail
        if isinstance(exc, (ConnectionRefusedError, ConnectionResetError)):
            return ErrorCode.PORT_CLOSED, detail
    return ErrorCode.OTHER, detail


def friendly_error(code: str | None, name: str, timeout_s: float = 2.0) -> str:
    """One sentence a non-technical user can act on."""
    if code == ErrorCode.TIMEOUT:
        return (f"{name} didn't answer within {timeout_s:g} seconds. The server may be overloaded, far away, "
                f"or your network may be dropping DNS traffic to it.")
    if code == ErrorCode.PORT_CLOSED:
        return f"{name} could not be reached. Your network or firewall may be blocking DNS traffic."
    if code == ErrorCode.NETWORK_UNREACHABLE:
        return f"{name} could not be reached because your PC has no route to it. Check your internet connection."
    if code == ErrorCode.HOST_UNREACHABLE:
        return f"{name} could not be reached — the network reported the server as unreachable."
    if code == ErrorCode.BLOCKED:
        return f"Windows or security software blocked the DNS request to {name}. A firewall may be restricting DNS."
    if code == ErrorCode.NO_IPV6:
        return f"{name} uses IPv6, which isn't working on this connection."
    if code == ErrorCode.SERVFAIL:
        return f"{name} answered, but couldn't look the name up (server failure). This is usually temporary."
    if code == ErrorCode.REFUSED:
        return f"{name} refused to answer. It may only serve its own customers, or it filters this kind of request."
    if code == ErrorCode.BAD_RCODE:
        return f"{name} returned an unusual error response."
    if code == ErrorCode.BAD_RESPONSE:
        return (f"{name} sent back an invalid or unexpected response. Something on your network may be "
                f"intercepting or rewriting DNS traffic.")
    if code == ErrorCode.TLS:
        return f"A secure (TLS) connection to {name} could not be set up."
    return f"Something went wrong while asking {name}."


def summarise_errors(codes: list[str]) -> str | None:
    """Most common error code → the dominant failure reason, or None."""
    if not codes:
        return None
    return max(set(codes), key=codes.count)
