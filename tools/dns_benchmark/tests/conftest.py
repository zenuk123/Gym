import os
import socket
import struct
import sys
import threading
import time

import dns.flags
import dns.message
import dns.rcode
import dns.rrset
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class FakeDnsServer:
    """A real DNS server on 127.0.0.1 (UDP + TCP, same port). Behaviour is chosen by the query name's first label:

    ``slow-<ms>.*`` delay then answer · ``nx.*`` NXDOMAIN · ``fail.*`` SERVFAIL · ``refuse.*`` REFUSED ·
    ``silent.*`` never answers (timeout) · ``big.*`` truncated over UDP, full answer over TCP · otherwise answer.
    """

    def __init__(self) -> None:
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.bind(("127.0.0.1", 0))
        self.port = self.udp.getsockname()[1]
        self.tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.tcp.bind(("127.0.0.1", self.port))
        self.tcp.listen(16)
        self.queries: list[tuple[str, str]] = []
        self._stop = threading.Event()
        threading.Thread(target=self._serve_udp, daemon=True).start()
        threading.Thread(target=self._serve_tcp, daemon=True).start()

    def _response(self, wire: bytes, proto: str) -> bytes | None:
        q = dns.message.from_wire(wire)
        name = q.question[0].name.to_text().rstrip(".")
        self.queries.append((proto, name))
        first = name.split(".")[0]
        r = dns.message.make_response(q)
        if first == "silent":
            return None
        if first.startswith("slow-"):
            time.sleep(int(first[5:]) / 1000)
        if first == "nx":
            r.set_rcode(dns.rcode.NXDOMAIN)
        elif first == "fail":
            r.set_rcode(dns.rcode.SERVFAIL)
        elif first == "refuse":
            r.set_rcode(dns.rcode.REFUSED)
        elif first == "big" and proto == "udp":
            r.flags |= dns.flags.TC
        else:
            r.answer.append(dns.rrset.from_text(q.question[0].name, 60, "IN", "A", "192.0.2.10"))
        return r.to_wire()

    def _serve_udp(self) -> None:
        self.udp.settimeout(0.2)
        while not self._stop.is_set():
            try:
                wire, addr = self.udp.recvfrom(4096)
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            resp = self._response(wire, "udp")
            if resp is not None:
                self.udp.sendto(resp, addr)

    def _serve_tcp(self) -> None:
        self.tcp.settimeout(0.2)
        while not self._stop.is_set():
            try:
                conn, _ = self.tcp.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            with conn:
                conn.settimeout(2)
                try:
                    ln = struct.unpack("!H", conn.recv(2))[0]
                    wire = b""
                    while len(wire) < ln:
                        wire += conn.recv(ln - len(wire))
                    resp = self._response(wire, "tcp")
                    if resp is not None:
                        conn.sendall(struct.pack("!H", len(resp)) + resp)
                except (OSError, struct.error):
                    pass

    def close(self) -> None:
        self._stop.set()
        self.udp.close()
        self.tcp.close()


@pytest.fixture
def dns_server():
    s = FakeDnsServer()
    yield s
    s.close()


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("DNSBENCH_HOME", str(tmp_path / "home"))
    return tmp_path / "home"


DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


class FakeDotServer(FakeDnsServer):
    """The same fake server, but its TCP side speaks TLS (DNS over TLS) with a test-only self-signed certificate."""

    def __init__(self) -> None:
        import ssl

        super().__init__()
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ctx.load_cert_chain(os.path.join(DATA, "dot-test-cert.pem"), os.path.join(DATA, "dot-test-key.pem"))
        self.connections = 0

    def _serve_tcp(self) -> None:
        self.tcp.settimeout(0.2)
        while not self._stop.is_set():
            try:
                raw, _ = self.tcp.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            threading.Thread(target=self._handle_tls, args=(raw,), daemon=True).start()

    def _handle_tls(self, raw) -> None:
        try:
            conn = self.ctx.wrap_socket(raw, server_side=True)
        except OSError:
            raw.close()
            return
        self.connections += 1
        conn.settimeout(3)
        with conn:
            while True:  # persistent connection: many queries per TLS session
                try:
                    hdr = conn.recv(2)
                    if len(hdr) < 2:
                        return
                    ln = struct.unpack("!H", hdr)[0]
                    wire = b""
                    while len(wire) < ln:
                        wire += conn.recv(ln - len(wire))
                    resp = self._response(wire, "dot")
                    if resp is not None:
                        conn.sendall(struct.pack("!H", len(resp)) + resp)
                except (OSError, struct.error):
                    return


@pytest.fixture
def dot_server():
    s = FakeDotServer()
    yield s
    s.close()
