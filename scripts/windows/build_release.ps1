param(
  [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

Write-Host "== KKR ERP: Windows release build =="

$root = Get-Location
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$backendBundleSrc = Join-Path $backendDir "dist/kkr-backend"
$backendBundleDest = Join-Path $frontendDir "backend-dist/kkr-backend"
$tauriMsiDir = Join-Path $frontendDir "src-tauri/target/release/bundle/msi"
$tauriNsisDir = Join-Path $frontendDir "src-tauri/target/release/bundle/nsis"
$distRoot = Join-Path $root "dist/windows"
$rootEnv = Join-Path $root ".env"

if (-not (Test-Path $backendDir) -or -not (Test-Path $frontendDir)) {
  Write-Error "Run this script from repository root."
}
if (-not (Test-Path $rootEnv)) {
  Write-Error "Missing root .env. Copy .env.example to .env and fill in the required values."
}

Write-Host "Installing locked backend dependencies..."
Push-Location $backendDir
try {
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Error "uv is required. Install it with: py -m pip install uv"
  }
  Invoke-Native uv sync --extra build --frozen
  Invoke-Native ./.venv/Scripts/alembic.exe -c alembic.ini upgrade head
} finally {
  Pop-Location
}

if (-not $SkipPreflight) {
  Write-Host "Running preflight checks..."
  & (Join-Path $root "scripts/windows/preflight.ps1")
}

Write-Host "Verifying backend dependencies before bundling..."
Push-Location $backendDir
try {
  Invoke-Native ./.venv/Scripts/python.exe -c "import supabase, storage3; assert tuple(map(int, supabase.__version__.split('.')[:2])) >= (2, 30); print('Supabase Storage client:', supabase.__version__)"
} finally {
  Pop-Location
}

Write-Host "Building bundled backend..."
Push-Location $backendDir
try {
  Invoke-Native ./.venv/Scripts/python.exe -m PyInstaller --clean --noconfirm --log-level=WARN kkr-backend.spec
} finally {
  Pop-Location
}

if (-not (Test-Path $backendBundleSrc)) {
  Write-Error "Bundled backend folder not found: $backendBundleSrc"
}

$frontendFullPath = [System.IO.Path]::GetFullPath($frontendDir)
$backendBundleDestFullPath = [System.IO.Path]::GetFullPath($backendBundleDest)
if (-not $backendBundleDestFullPath.StartsWith($frontendFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Error "Refusing to replace backend bundle outside frontend folder: $backendBundleDestFullPath"
}

if (Test-Path $backendBundleDest) {
  Remove-Item -LiteralPath $backendBundleDest -Recurse -Force
}
Copy-Item -LiteralPath $backendBundleSrc -Destination $backendBundleDest -Recurse -Force
Copy-Item -LiteralPath $rootEnv -Destination (Join-Path $backendBundleDest ".env") -Force

Write-Host "Building Tauri installer..."
$signingKey = Join-Path $frontendDir "src-tauri/.tauri/kkr-erp.key"
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  if (-not (Test-Path $signingKey)) {
    Write-Error "Updater signing key is missing at $signingKey. Set TAURI_SIGNING_PRIVATE_KEY_PATH before building a release."
  }
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $signingKey
}
Push-Location $frontendDir
try {
  if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Invoke-Native npm.cmd install
  }
  Invoke-Native node (Join-Path $root "scripts/tauri_build.mjs")
} finally {
  Pop-Location
}

$installerFiles = @()
if (Test-Path $tauriMsiDir) {
  $installerFiles += Get-ChildItem -Path $tauriMsiDir -Filter *.msi -File
}
if (Test-Path $tauriNsisDir) {
  $installerFiles += Get-ChildItem -Path $tauriNsisDir -Filter *.exe -File
}
$installerFiles = $installerFiles | Sort-Object LastWriteTime -Descending
if (-not $installerFiles -or $installerFiles.Count -eq 0) {
  Write-Error "No Windows installer was produced. Check the Tauri bundle output."
}

$tauriConfPath = Join-Path $frontendDir "src-tauri/tauri.conf.json"
$version = "unknown"
if (Test-Path $tauriConfPath) {
  $cfg = Get-Content $tauriConfPath -Raw | ConvertFrom-Json
  if ($cfg.version) {
    $version = [string]$cfg.version
  }
}

$releaseDir = Join-Path $distRoot $version
$latestDir = Join-Path $distRoot "latest"

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
New-Item -ItemType Directory -Path $latestDir -Force | Out-Null

# Clean latest for deterministic output.
Get-ChildItem -Path $latestDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

$hashLines = @()
foreach ($installer in $installerFiles) {
  $destVersion = Join-Path $releaseDir $installer.Name
  $destLatest = Join-Path $latestDir $installer.Name

  Copy-Item -Path $installer.FullName -Destination $destVersion -Force
  Copy-Item -Path $installer.FullName -Destination $destLatest -Force

  $hash = Get-FileHash -Path $destVersion -Algorithm SHA256
  $hashLines += "{0}  {1}" -f $hash.Hash, $installer.Name
}

$nsisUpdater = $installerFiles | Where-Object { $_.Extension -eq ".exe" -and $_.Name -like "*-setup.exe" } | Select-Object -First 1
if ($nsisUpdater) {
  $updaterSig = "$($nsisUpdater.FullName).sig"
  if (Test-Path $updaterSig) {
    Copy-Item -Path $updaterSig -Destination (Join-Path $releaseDir (Split-Path $updaterSig -Leaf)) -Force
    Copy-Item -Path $updaterSig -Destination (Join-Path $latestDir (Split-Path $updaterSig -Leaf)) -Force
    $manifestScript = Join-Path $root "scripts/write_updater_manifest.mjs"
    $manifestName = (& node (Join-Path $root "scripts/github_release_config.mjs") manifestName).Trim()
    Invoke-Native node $manifestScript --version $version --platform "windows-x86_64" --bundle (Join-Path $releaseDir $nsisUpdater.Name) --signature $updaterSig --out (Join-Path $latestDir $manifestName)
    Copy-Item -Path (Join-Path $latestDir $manifestName) -Destination (Join-Path $releaseDir $manifestName) -Force
  } else {
    Write-Error "Signed Windows updater bundle was not produced."
  }
}

$hashFileVersion = Join-Path $releaseDir "SHA256SUMS.txt"
$hashFileLatest = Join-Path $latestDir "SHA256SUMS.txt"
$hashLines | Out-File -FilePath $hashFileVersion -Encoding ascii
$hashLines | Out-File -FilePath $hashFileLatest -Encoding ascii

Copy-Item -Path (Join-Path $root "deploy/windows/INSTALL.md") -Destination (Join-Path $releaseDir "INSTALL.md") -Force
Copy-Item -Path (Join-Path $root "deploy/windows/INSTALL.md") -Destination (Join-Path $latestDir "INSTALL.md") -Force

Write-Host "Release build complete."
Write-Host "Versioned folder: $releaseDir"
Write-Host "Latest folder:    $latestDir"
Write-Host "Installers are available in '$latestDir'."
Write-Warning "The installer contains the backend .env. Share it only with trusted internal users."
