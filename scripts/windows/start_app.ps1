param(
  [string]$AppHost = "127.0.0.1",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

Write-Host "== KKR ERP: Starting backend + frontend preview =="

$root = Get-Location
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$venvPython = Join-Path $backendDir ".venv/Scripts/python.exe"
$pythonCmd = if (Test-Path $venvPython) { $venvPython } else { "python" }

if (-not (Test-Path $backendDir) -or -not (Test-Path $frontendDir)) {
  Write-Error "Run this script from repository root."
}

$backendArgs = "run_prod.py"
$backendProc = Start-Process -FilePath $pythonCmd -ArgumentList $backendArgs -WorkingDirectory $backendDir -PassThru -WindowStyle Minimized
Write-Host "Backend PID: $($backendProc.Id)"

$healthUrl = "http://${AppHost}:${Port}/api/v1/health/"
$maxAttempts = 40
$ready = $false

for ($i = 1; $i -le $maxAttempts; $i++) {
  Start-Sleep -Milliseconds 750
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
      $ready = $true
      break
    }
  } catch {
    # keep waiting
  }
}

if (-not $ready) {
  Write-Warning "Backend did not become healthy in time."
}

$frontendProc = Start-Process -FilePath "npm.cmd" -ArgumentList "run preview -- --host 127.0.0.1 --port 4173" -WorkingDirectory $frontendDir -PassThru -WindowStyle Minimized
Write-Host "Frontend PID: $($frontendProc.Id)"

$stateDir = Join-Path $root ".run"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }

@{
  backend_pid = $backendProc.Id
  frontend_pid = $frontendProc.Id
  started_at = (Get-Date).ToString("s")
} | ConvertTo-Json | Out-File -FilePath (Join-Path $stateDir "windows-run-state.json") -Encoding UTF8

Write-Host "App started."
Write-Host "Frontend: http://127.0.0.1:4173"
Write-Host "Backend:  http://${AppHost}:${Port}"
