"""Launch DNS Benchmark from source: ``python run.py`` (window) or ``python run.py --cli``."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dnsbench.main import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
