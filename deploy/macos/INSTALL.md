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
