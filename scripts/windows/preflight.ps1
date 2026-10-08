$ErrorActionPreference = "Stop"

Write-Host "== KKR ERP: Preflight checks =="

if (-not (Test-Path "backend")) {
  Write-Error "Run this script from repository root."
}

Push-Location backend
try {
  if (Test-Path ".venv/Scripts/python.exe") {
    & .venv/Scripts/python.exe -m scripts.preflight_check
  } else {
    & python -m scripts.preflight_check
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Preflight failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
