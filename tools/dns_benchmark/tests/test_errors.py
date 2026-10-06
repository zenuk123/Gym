import errno
import socket

import dns.exception

from dnsbench.errors import ErrorCode, classify_exception, friendly_error


def test_exceptions_are_classified():
    assert classify_exception(dns.exception.Timeout())[0] == ErrorCode.TIMEOUT
    assert classify_exception(socket.timeout())[0] == ErrorCode.TIMEOUT
    assert classify_exception(ConnectionRefusedError(errno.ECONNREFUSED, "refused"))[0] == ErrorCode.PORT_CLOSED
    assert classify_exception(OSError(errno.ENETUNREACH, "unreachable"))[0] == ErrorCode.NETWORK_UNREACHABLE
    assert classify_exception(PermissionError(errno.EACCES, "denied"))[0] == ErrorCode.BLOCKED
    assert classify_exception(OSError(errno.EAFNOSUPPORT, "af"))[0] == ErrorCode.NO_IPV6
    assert classify_exception(ValueError("x"))[0] == ErrorCode.OTHER
    win = OSError(0, "reset")
    win.winerror = 10054
    assert classify_exception(win)[0] == ErrorCode.PORT_CLOSED


def test_friendly_messages_are_plain_english_with_technical_detail_kept():
    code, detail = classify_exception(ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused"))
    msg = friendly_error(code, "Cloudflare DNS")
    assert msg == "Cloudflare DNS could not be reached. Your network or firewall may be blocking DNS traffic."
    assert "ConnectionRefusedError" in detail
    for c in vars(ErrorCode).values():
        if isinstance(c, str) and not c.startswith("_"):
            assert "Error" not in friendly_error(c, "X") and friendly_error(c, "X").endswith(".")
