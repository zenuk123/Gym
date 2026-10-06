"""DNS Benchmark — find the fastest, most reliable DNS server for *your* connection.

The package is split so that networking and maths never depend on the UI:

- ``providers`` / ``domains``   built-in databases (editable JSON)
- ``transport``                 real DNS queries (dnspython): UDP with TCP fallback, DoT
- ``engine``                    randomised, rate-limited, cancellable benchmark runner
- ``stats`` / ``scoring``       pure statistics + weighted scoring + plain-English explanation
- ``network`` / ``diagnostics`` network detection, IPv6/VPN/interception/captive-portal checks
- ``windows_dns``               safe, reversible Windows DNS changes (backup → apply → verify → restore)
- ``storage`` / ``export``      settings, history, CSV/JSON/TXT export
- ``ui``                        PySide6 desktop interface
"""

__version__ = "1.0.0"
APP_NAME = "DNS Benchmark"
