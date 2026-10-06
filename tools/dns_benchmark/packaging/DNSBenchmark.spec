# PyInstaller spec — builds two single-file executables into dist/:
#   DNSBenchmark.exe      the desktop app (no console window)
#   DNSBenchmark-cli.exe  the same app for the command line (python run.py --cli equivalent)
#
#   pyinstaller --noconfirm packaging/DNSBenchmark.spec
import os

from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.dirname(SPECPATH)  # noqa: F821 (SPECPATH is defined by PyInstaller)

hidden = collect_submodules("dns")  # dnspython loads record-type modules dynamically
excludes = [
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtQml", "PySide6.QtQuick",
    "PySide6.Qt3DCore", "PySide6.QtCharts", "PySide6.QtDataVisualization", "PySide6.QtMultimedia",
    "PySide6.QtPdf", "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtBluetooth", "PySide6.QtNetwork",
    "tkinter", "unittest", "pydoc",
]


def build(name, script, console):
    a = Analysis(  # noqa: F821
        [os.path.join(ROOT, script)],
        pathex=[ROOT],
        datas=[(os.path.join(ROOT, "dnsbench", "data", "providers.json"), "dnsbench/data")],
        hiddenimports=hidden,
        excludes=excludes,
        noarchive=False,
    )
    pyz = PYZ(a.pure)  # noqa: F821
    return EXE(  # noqa: F821
        pyz, a.scripts, a.binaries, a.datas, [],
        name=name,
        console=console,
        icon=os.path.join(ROOT, "assets", "app.ico"),
        version=os.path.join(ROOT, "packaging", "version_info.txt"),
        upx=False,
        runtime_tmpdir=None,
    )


app = build("DNSBenchmark", "run.py", console=False)
cli = build("DNSBenchmark-cli", os.path.join("packaging", "cli_entry.py"), console=True)
