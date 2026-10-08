# KKR ERP Windows Build and Install

## Builder prerequisites

- Windows 10/11
- Git, Python 3.13+, uv, Node.js 20+, Rust stable
- Microsoft C++ Build Tools with **Desktop development with C++**
- Microsoft Edge WebView2
- VBSCRIPT optional Windows feature when producing MSI packages

## Build

```powershell
git clone <repository-url>
cd CIDO
Copy-Item .env.example .env
# Fill the Supabase and security values in .env, including SUPABASE_NOTES_BUCKET
./scripts/windows/build_release.ps1
```

Installers and checksums are written to `dist/windows/latest/`.

## Install

Run either the generated `.msi` or NSIS setup `.exe`. Windows may show an unknown-publisher warning until the installer is code signed.

The installed desktop application starts its bundled FastAPI backend automatically. Backend logs are stored under `%LOCALAPPDATA%\KKR ERP\logs`.

## Security

The installer contains the backend `.env`, including Supabase credentials. Share it only with trusted internal users. Rotate credentials immediately if an installer or Git history is exposed to an untrusted party.
