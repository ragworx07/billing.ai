$ErrorActionPreference = "Stop"

Write-Host "== KKR ERP: Stopping app =="

$stateFile = Join-Path (Get-Location) ".run/windows-run-state.json"
if (-not (Test-Path $stateFile)) {
  Write-Warning "No run state file found."
  exit 0
}

$state = Get-Content $stateFile -Raw | ConvertFrom-Json

foreach ($pid in @($state.backend_pid, $state.frontend_pid)) {
  if ($pid) {
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Host "Stopped PID $pid"
    } catch {
      Write-Warning "PID $pid already stopped."
    }
  }
}

Remove-Item $stateFile -Force
Write-Host "Stopped successfully."
