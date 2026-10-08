param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
  Write-Error "Backup file not found: $BackupFile"
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgRestore) {
  Write-Error "pg_restore not found. Install PostgreSQL tools and add to PATH."
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

$confirm = Read-Host "This will overwrite objects in the configured Supabase database. Type YES to continue"
if ($confirm -ne "YES") {
  Write-Host "Restore cancelled."
  exit 0
}

& pg_restore --dbname=$PgDatabaseUrl --clean --if-exists $BackupFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE."
}

Write-Host "Restore completed from: $BackupFile"
