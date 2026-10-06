"""Regenerate assets/app.ico (multi-size, PNG-compressed entries) from the painted app icon.

    python packaging/make_icon.py
"""

import os
import struct
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from PySide6.QtCore import QBuffer, QIODevice  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from dnsbench.ui.icons import app_icon_pixmap  # noqa: E402


def png_bytes(size: int) -> bytes:
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    app_icon_pixmap(size).save(buf, "PNG")
    return bytes(buf.data())


def main() -> None:
    QApplication([])
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    images = [png_bytes(s) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    out = os.path.join(ROOT, "assets", "app.ico")
    with open(out, "wb") as f:
        f.write(header + entries + b"".join(images))
    with open(os.path.join(ROOT, "assets", "app.png"), "wb") as f:
        f.write(png_bytes(256))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
