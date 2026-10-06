# Build DNSBenchmark.exe and DNSBenchmark-cli.exe on Windows.
#   Right-click → Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) { py -3 -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\pyinstaller.exe --noconfirm --clean --distpath dist --workpath build packaging\DNSBenchmark.spec
Write-Host ""
Write-Host "Done: $PSScriptRoot\dist\DNSBenchmark.exe (and DNSBenchmark-cli.exe)" -ForegroundColor Green
