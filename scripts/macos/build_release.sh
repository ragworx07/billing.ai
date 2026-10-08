#!/bin/bash
set -e

# Source Rust environment to make cargo and rustc available
if [ -f "$HOME/.cargo/env" ]; then
    . "$HOME/.cargo/env"
fi

echo "== KKR ERP: macOS release build =="

# Get absolute path to repository root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_BUNDLE_SRC="$BACKEND_DIR/dist/kkr-backend"
BACKEND_BUNDLE_DEST="$FRONTEND_DIR/backend-dist/kkr-backend"
ROOT_ENV="$ROOT_DIR/.env"
DIST_ROOT="$ROOT_DIR/dist/macos"

if [ ! -d "$BACKEND_DIR" ] || [ ! -d "$FRONTEND_DIR" ]; then
    echo "Error: Run this script from the repository or scripts folder." >&2
    exit 1
fi

if [ ! -f "$ROOT_ENV" ]; then
    echo "Error: Missing root .env. Copy .env.example to .env and fill in required values." >&2
    exit 1
fi

# 1. Install locked backend dependencies
echo "Installing locked backend dependencies..."
cd "$BACKEND_DIR"
if ! command -v uv &> /dev/null; then
    echo "Error: uv is required. Install it using brew or pip." >&2
    exit 1
fi
uv sync --extra build --frozen
uv run alembic -c alembic.ini upgrade head || uv run alembic -c alembic.ini stamp head

# 2. Compile backend with PyInstaller
echo "Building bundled backend..."
uv run python -m PyInstaller --clean --noconfirm --log-level=WARN kkr-backend.spec

if [ ! -d "$BACKEND_BUNDLE_SRC" ]; then
    echo "Error: Bundled backend folder not found at $BACKEND_BUNDLE_SRC" >&2
    exit 1
fi

# Clean and recreate backend-dist inside frontend
if [ -d "$BACKEND_BUNDLE_DEST" ]; then
    rm -rf "$BACKEND_BUNDLE_DEST"
fi
mkdir -p "$(dirname "$BACKEND_BUNDLE_DEST")"
cp -R "$BACKEND_BUNDLE_SRC" "$BACKEND_BUNDLE_DEST"
cp "$ROOT_ENV" "$BACKEND_BUNDLE_DEST/.env"

# 3. Build Tauri App Bundle (excluding DMG to avoid AppleScript automation errors)
echo "Building Tauri app bundle..."
SIGNING_KEY="$FRONTEND_DIR/src-tauri/.tauri/kkr-erp.key"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
    if [ ! -f "$SIGNING_KEY" ]; then
        echo "Error: Updater signing key is missing at $SIGNING_KEY" >&2
        echo "Set TAURI_SIGNING_PRIVATE_KEY_PATH to the private key before building a release." >&2
        exit 1
    fi
    export TAURI_SIGNING_PRIVATE_KEY_PATH="$SIGNING_KEY"
fi
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    npm install
fi
node "$ROOT_DIR/scripts/tauri_build.mjs" --bundles app

# Find generated APP bundle
TAURI_APP_DIR="$FRONTEND_DIR/src-tauri/target/release/bundle/macos"
APP_PATH="$TAURI_APP_DIR/KKR ERP.app"
if [ ! -d "$APP_PATH" ]; then
    echo "Error: KKR ERP.app was not found in $TAURI_APP_DIR" >&2
    exit 1
fi

# Extract version from tauri.conf.json
TAURI_CONF="$FRONTEND_DIR/src-tauri/tauri.conf.json"
VERSION="unknown"
if [ -f "$TAURI_CONF" ]; then
    VERSION=$(node -e "console.log(require('$TAURI_CONF').version || 'unknown')")
fi

RELEASE_DIR="$DIST_ROOT/$VERSION"
LATEST_DIR="$DIST_ROOT/latest"

mkdir -p "$RELEASE_DIR"
mkdir -p "$LATEST_DIR"

# Clean latest for deterministic output
rm -f "$LATEST_DIR"/*

# 4. Package the .app into a .dmg using hdiutil (bypassing AppleScript layout issues)
echo "Packaging KKR ERP.app into DMG..."
TEMP_DMG_DIR="$DIST_ROOT/temp_dmg"
rm -rf "$TEMP_DMG_DIR"
mkdir -p "$TEMP_DMG_DIR"

# Copy the app and create Applications symlink
cp -R "$APP_PATH" "$TEMP_DMG_DIR/"
ln -s /Applications "$TEMP_DMG_DIR/Applications"

# Create the DMG image
DMG_NAME="KKR_ERP_${VERSION}_aarch64.dmg"
LATEST_DMG_NAME="KKR_ERP_latest_aarch64.dmg"

hdiutil create -fs HFS+ -volname "KKR ERP" -srcfolder "$TEMP_DMG_DIR" -ov "$RELEASE_DIR/$DMG_NAME"
cp "$RELEASE_DIR/$DMG_NAME" "$LATEST_DIR/$LATEST_DMG_NAME"

# Clean up temp folder
rm -rf "$TEMP_DMG_DIR"

# Signed updater bundle used by the in-app Update button.
UPDATER_BUNDLE="$(find "$TAURI_APP_DIR" -maxdepth 1 -name '*.app.tar.gz' ! -name '*.sig' | head -n 1)"
UPDATER_SIG="${UPDATER_BUNDLE}.sig"
if [ -n "$UPDATER_BUNDLE" ] && [ -f "$UPDATER_SIG" ]; then
    cp "$UPDATER_BUNDLE" "$RELEASE_DIR/"
    cp "$UPDATER_SIG" "$RELEASE_DIR/"
    cp "$UPDATER_BUNDLE" "$LATEST_DIR/"
    cp "$UPDATER_SIG" "$LATEST_DIR/"
    ARCH_NAME="$(uname -m)"
    case "$ARCH_NAME" in
        arm64) PLATFORM="darwin-aarch64" ;;
        x86_64) PLATFORM="darwin-x86_64" ;;
        *) PLATFORM="darwin-$ARCH_NAME" ;;
    esac
    MANIFEST_NAME="$(node "$ROOT_DIR/scripts/github_release_config.mjs" manifestName)"
    node "$ROOT_DIR/scripts/write_updater_manifest.mjs" \
        --version "$VERSION" \
        --platform "$PLATFORM" \
        --bundle "$RELEASE_DIR/$(basename "$UPDATER_BUNDLE")" \
        --signature "$UPDATER_SIG" \
        --out "$LATEST_DIR/$MANIFEST_NAME"
    cp "$LATEST_DIR/$MANIFEST_NAME" "$RELEASE_DIR/$MANIFEST_NAME"
else
    echo "Error: Signed updater bundle was not produced." >&2
    exit 1
fi

# Calculate SHA256 checksums
echo "Calculating SHA256 checksum..."
cd "$RELEASE_DIR"
shasum -a 256 "$DMG_NAME" > "SHA256SUMS.txt"

cd "$LATEST_DIR"
shasum -a 256 "$LATEST_DMG_NAME" > "SHA256SUMS.txt"

# Copy installation instructions
mkdir -p "$ROOT_DIR/deploy/macos"
cat << 'EOF' > "$ROOT_DIR/deploy/macos/INSTALL.md"
# KKR ERP macOS Build and Install

## Builder prerequisites

- macOS (Apple Silicon or Intel)
- Git, Python 3.13+, uv, Node.js 20+, Rust stable

## Build

```bash
git clone <repository-url>
cd CIDO
cp .env.example .env
# Fill the Supabase and security values in .env
./scripts/macos/build_release.sh
```

Installers and checksums are written to `dist/macos/latest/`.

## Install

Mount the generated `.dmg` disk image and drag the **KKR ERP** application to your `Applications` folder.

If macOS displays a warning that the app is unsigned or cannot be opened, you can right-click on the app in Finder and select "Open", or remove the quarantine attribute in the terminal:
```bash
xattr -d com.apple.quarantine /Applications/KKR\ ERP.app
```

The app starts its bundled FastAPI backend automatically. Backend logs are stored under `$HOME/Library/Caches/KKR ERP/logs` or temporary folders.

## Security

The bundle contains the backend `.env` including Supabase credentials inside the app package resources. Share the installer only with trusted internal users.
EOF

cp "$ROOT_DIR/deploy/macos/INSTALL.md" "$RELEASE_DIR/"
cp "$ROOT_DIR/deploy/macos/INSTALL.md" "$LATEST_DIR/"

echo "Release build complete."
echo "Versioned folder: $RELEASE_DIR"
echo "Latest folder:    $LATEST_DIR"
echo "Installers are available in '$LATEST_DIR'."
echo "Warning: The installer contains the backend .env. Share it only with trusted internal users."
