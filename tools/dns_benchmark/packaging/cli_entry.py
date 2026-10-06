"""Entry point for DNSBenchmark-cli.exe: the command-line version (``--cli`` is implied)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dnsbench.main import main  # noqa: E402

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--cli" not in args and "--scheduled" not in args and "--version" not in args and "-h" not in args \
            and "--help" not in args:
        args = ["--cli", *args]
    raise SystemExit(main(args))
