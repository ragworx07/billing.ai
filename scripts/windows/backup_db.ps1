param(
  [string]$BackupDir = "backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  Write-Error "pg_dump not found. Install PostgreSQL tools and add to PATH."
}
if (-not $DatabaseUrl) {
  $envFile = Join-Path (Get-Location) ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line) { $DatabaseUrl = $line.Substring('DATABASE_URL='.Length) }
  }
}
if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL is required in the root .env or process environment."
}
$PgDatabaseUrl = $DatabaseUrl -replace '^postgresql\+psycopg://', 'postgresql://' -replace '^postgres\+psycopg://', 'postgresql://'

if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $BackupDir "kkr_supabase_$timestamp.backup"

& pg_dump --dbname=$PgDatabaseUrl -F c -f $outFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE."
}

Write-Host "Backup created: $outFile"
