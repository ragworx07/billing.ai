$ErrorActionPreference = "Stop"

Write-Host "== KKR ERP: Running migrations =="

if (-not (Test-Path "backend/alembic.ini")) {
  Write-Error "Run this script from repository root."
}

Push-Location backend
try {
  if (Test-Path ".venv/Scripts/python.exe") {
    & .venv/Scripts/python.exe -m alembic -c alembic.ini upgrade head
  } else {
    & python -m alembic -c alembic.ini upgrade head
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Write-Host "Migrations complete."
