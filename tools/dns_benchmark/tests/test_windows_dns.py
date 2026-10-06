"""DNS configuration backup / apply / restore. A fake Windows *interprets the generated PowerShell*, so these
tests check the real scripts, not just the Python around them."""

import json
import re

import pytest

from dnsbench.windows_dns import (AdminResult, DnsChangeError, InterfaceDns, WindowsDnsManager, build_apply_script,
                                  build_restore_script, parse_nameserver_value, parse_read_output, ps_quote,
                                  validate_servers)
from dnsbench.winshell import encode_command

GUID = "{11111111-2222-3333-4444-555555555555}"


class FakeWindows:
    def __init__(self, v4_static=None, v6_static=None, mode="ok"):
        self.cfg = InterfaceDns(12, "Wi-Fi", GUID, list(v4_static or []), list(v6_static or []))
        self.dhcp_v4, self.dhcp_v6 = ["192.168.1.1"], []
        self.mode = mode  # ok / cancel / fail / ignore
        self.scripts: list[str] = []
        self.backup_seen_before_change: list[bool] = []
        self.backup_path = None
        self.connected = True
        self.flushed = 0

    def _sync(self):
        self.cfg.ipv4_current = self.cfg.ipv4_static or self.dhcp_v4
        self.cfg.ipv6_current = self.cfg.ipv6_static or self.dhcp_v6

    def read(self, index):
        assert index == 12
        self._sync()
        return InterfaceDns(**{**self.cfg.__dict__, "ipv4_static": list(self.cfg.ipv4_static),
                               "ipv6_static": list(self.cfg.ipv6_static)})

    def find(self, guid):
        return self.read(12) if self.connected and guid == GUID else None

    def run_admin_script(self, script, result_path):
        self.scripts.append(script)
        if self.backup_path is not None:
            self.backup_seen_before_change.append(self.backup_path.exists())
        if self.mode == "cancel":
            return AdminResult(False, True, "declined")
        if self.mode == "fail":
            return AdminResult(False, False, "ERROR: Access is denied")
        if self.mode == "ignore":
            return AdminResult(True)
        for line in script.splitlines():
            line = line.strip()
            if line.startswith("Set-DnsClientServerAddress"):
                assert "-InterfaceIndex 12 " in line
                if "-ResetServerAddresses" in line:
                    self.cfg.ipv4_static, self.cfg.ipv6_static = [], []
                else:
                    addrs = re.findall(r"'([^']*)'", line.split("-ServerAddresses", 1)[1])
                    v4 = [a for a in addrs if ":" not in a]
                    v6 = [a for a in addrs if ":" in a]
                    if v4:
                        self.cfg.ipv4_static = v4
                    if v6:
                        self.cfg.ipv6_static = v6
            elif line == "Clear-DnsClientCache":
                self.flushed += 1
        return AdminResult(True)


@pytest.fixture
def setup(tmp_path):
    def make(**kw):
        win = FakeWindows(**kw)
        win.backup_path = tmp_path / "dns_backup.json"
        return win, WindowsDnsManager(win, win.backup_path)
    return make


def test_apply_backs_up_first_then_changes_flushes_and_verifies(setup):
    win, mgr = setup()
    res = mgr.apply(12, ["1.1.1.1", "1.0.0.1"], [])
    assert res.ok and res.message == "Windows DNS changed successfully."
    assert win.backup_seen_before_change == [True]  # backup on disk before the elevated script ran
    assert win.cfg.ipv4_static == ["1.1.1.1", "1.0.0.1"] and win.cfg.ipv6_static == []
    assert win.flushed == 1
    b = mgr.backups()[GUID]
    assert b.ipv4_static == [] and b.ipv4_current == ["192.168.1.1"]
    assert "automatic" in b.describe()


def test_apply_ipv4_and_ipv6(setup):
    win, mgr = setup()
    assert mgr.apply(12, ["1.1.1.1", "1.0.0.1"], ["2606:4700:4700::1111", "2606:4700:4700::1001"]).ok
    assert win.cfg.ipv6_static == ["2606:4700:4700::1111", "2606:4700:4700::1001"]


def test_restore_returns_to_automatic_dns(setup):
    win, mgr = setup()
    mgr.apply(12, ["8.8.8.8", "8.8.4.4"], ["2001:4860:4860::8888"])
    res = mgr.restore()
    assert res.ok and win.cfg.ipv4_static == [] and win.cfg.ipv6_static == []
    assert win.cfg.ipv4_current == ["192.168.1.1"]
    assert not mgr.has_backup() and not win.backup_path.exists()


def test_restore_returns_to_previous_static_dns(setup):
    win, mgr = setup(v4_static=["9.9.9.9"], v6_static=["2620:fe::fe"])
    mgr.apply(12, ["1.1.1.1"], [])
    assert win.cfg.ipv4_static == ["1.1.1.1"]
    assert mgr.restore().ok
    assert win.cfg.ipv4_static == ["9.9.9.9"] and win.cfg.ipv6_static == ["2620:fe::fe"]


def test_second_apply_keeps_the_original_backup(setup):
    win, mgr = setup(v4_static=["194.168.4.100"])
    mgr.apply(12, ["1.1.1.1"], [])
    mgr.apply(12, ["8.8.8.8"], [])
    assert mgr.backups()[GUID].ipv4_static == ["194.168.4.100"]
    mgr.restore()
    assert win.cfg.ipv4_static == ["194.168.4.100"]


def test_uac_declined_changes_nothing_and_leaves_no_backup(setup):
    win, mgr = setup(mode="cancel")
    res = mgr.apply(12, ["1.1.1.1"], [])
    assert not res.ok and res.cancelled and "declined" in res.message
    assert win.cfg.ipv4_static == [] and not mgr.has_backup()


def test_failed_change_reports_and_cleans_up(setup):
    win, mgr = setup(mode="fail")
    res = mgr.apply(12, ["1.1.1.1"], [])
    assert not res.ok and "didn't accept" in res.message and "Access is denied" in res.details
    assert not mgr.has_backup()


def test_verification_catches_a_change_that_did_not_stick(setup):
    win, mgr = setup(mode="ignore")  # script "succeeds" but Windows didn't change
    res = mgr.apply(12, ["1.1.1.1"], [])
    assert not res.ok


def test_restore_without_backup_or_adapter(setup):
    win, mgr = setup()
    assert not mgr.restore().ok
    mgr.apply(12, ["1.1.1.1"], [])
    win.connected = False
    res = mgr.restore()
    assert not res.ok and "isn't connected" in res.message and mgr.has_backup()


def test_restore_declined_keeps_backup(setup):
    win, mgr = setup()
    mgr.apply(12, ["1.1.1.1"], [])
    win.mode = "cancel"
    assert mgr.restore().cancelled and mgr.has_backup()


@pytest.mark.parametrize("bad", ["1.1.1.1'; Remove-Item C:\\ -Recurse; '", "1.1.1", "2606:4700::1", "fe80::1%12",
                                 "$(calc)", "8.8.8.8 -ResetServerAddresses"])
def test_invalid_or_malicious_addresses_are_rejected_before_any_script(setup, bad):
    win, mgr = setup()
    res = mgr.apply(12, [bad], [])
    assert not res.ok and win.scripts == [] and not mgr.has_backup()
    with pytest.raises(DnsChangeError):
        validate_servers([bad], [])


def test_validate_normalises_and_limits():
    assert validate_servers([" 1.1.1.1 "], ["2606:4700:4700:0:0:0:0:1111"]) == (["1.1.1.1"], ["2606:4700:4700::1111"])
    with pytest.raises(DnsChangeError):
        validate_servers([], [])
    with pytest.raises(DnsChangeError):
        validate_servers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"], [])


def test_scripts_are_well_formed(tmp_path):
    out = tmp_path / "it's here.txt"
    s = build_apply_script(12, ["1.1.1.1"], ["2606:4700:4700::1111"], out)
    assert "Set-DnsClientServerAddress -InterfaceIndex 12 -ServerAddresses @('1.1.1.1','2606:4700:4700::1111')" in s
    assert "Clear-DnsClientCache" in s and "$ErrorActionPreference = 'Stop'" in s
    assert ps_quote(str(out)) in s and "it''s here" in s
    from dnsbench.windows_dns import DnsBackup
    b = DnsBackup(0, 12, "Wi-Fi", GUID, [], ["2620:fe::fe"], [], [])
    r = build_restore_script([(12, b)], out)
    assert r.index("-ResetServerAddresses") < r.index("@('2620:fe::fe')")
    assert re.fullmatch(r"[A-Za-z0-9+/=]+", encode_command(s))


def test_registry_and_read_parsing():
    assert parse_nameserver_value("1.1.1.1,1.0.0.1") == ["1.1.1.1", "1.0.0.1"]
    assert parse_nameserver_value("8.8.8.8 8.8.4.4") == ["8.8.8.8", "8.8.4.4"]
    assert parse_nameserver_value("") == [] and parse_nameserver_value(None) == []
    cfg = parse_read_output(json.dumps({"index": 12, "alias": "Wi-Fi", "guid": GUID, "v4static": "", "v6static": "",
                                        "v4": "192.168.1.1", "v6": ["fe80::1%12"]}))
    assert cfg.ipv4_static == [] and cfg.ipv4_current == ["192.168.1.1"] and cfg.ipv6_current == ["fe80::1%12"]


def test_corrupt_backup_file_does_not_crash(setup):
    win, mgr = setup()
    win.backup_path.write_text("{not json")
    assert mgr.backups() == {}
