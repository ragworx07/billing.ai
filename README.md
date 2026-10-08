# KKR ERP

Construction operations desktop application with a React/Vite frontend, a bundled FastAPI backend, Tauri 2, and Supabase PostgreSQL/Storage.

## Architecture

```text
Tauri desktop window
  -> React frontend
  -> local FastAPI backend (127.0.0.1:8000)
  -> Supabase PostgreSQL + private Storage bucket
```

The frontend never receives the database password or Supabase service-role key. Those values are read only by the backend.

> Security: the local desktop installer includes the backend `.env` so the bundled backend can reach Supabase. A technically capable recipient can extract those credentials. Only distribute this internal build to trusted users. For public or untrusted distribution, host the backend and give the Tauri frontend only its HTTPS API URL.

## Clone-to-build setup

### 1. Prerequisites

- Git
- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+ and npm
- Rust stable and the Windows requirements from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- A Supabase project

Windows also requires Microsoft C++ Build Tools, WebView2, and the VBSCRIPT optional feature for MSI packaging.

### 2. Create the only environment file

From Windows PowerShell at the repository root:

```powershell
Copy-Item .env.example .env
```

Fill every required placeholder in `.env`:

- `SECRET_KEY`: at least 32 random characters.
- `DATABASE_URL`: Supabase Session pooler URI on port `5432`, with `sslmode=require`. URL-encode special characters in the password.
- `SUPABASE_URL`: project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: backend-only service-role key.
- `SUPABASE_PROJECT_FILES_BUCKET`: private Storage bucket name, normally `project-files`.
- `SUPABASE_NOTES_BUCKET`: private Storage bucket for note attachments, normally `note-attachments`.
- `VITE_API_URL`: keep `http://127.0.0.1:8000/api/v1` for the bundled desktop backend.

Generate a JWT secret with:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Do not commit `.env`. If credentials have ever appeared in Git history, rotate the Supabase database password, service-role key, Groq key, and JWT secret before sharing the repository.

### 3. Prepare Supabase

Create private Storage buckets matching `SUPABASE_PROJECT_FILES_BUCKET` and `SUPABASE_NOTES_BUCKET`. Then install dependencies and apply every Alembic migration:

```powershell
Push-Location backend
uv sync --extra build --extra dev --frozen
uv run alembic -c alembic.ini upgrade head
uv run python -m scripts.preflight_check
Pop-Location
```

For persistent desktop backends, Supabase recommends a direct connection when IPv6 is available, or the Session pooler on port `5432` for IPv4 networks. Do not use transaction mode on port `6543` for this long-running SQLAlchemy backend.

### 4. Run in development

Windows PowerShell 1:

```powershell
cd backend
uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

Windows PowerShell 2:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. API health is available at `http://127.0.0.1:8000/api/v1/health`.

If the database has no administrator, call `POST /api/v1/auth/bootstrap-owner` once with `name`, `email`, and `password`. The endpoint refuses to create another owner after one exists.

## Build the Tauri desktop application

Build on Windows 10/11. This repository is configured only for Windows desktop installers.

Run PowerShell from the repository root:

```powershell
./scripts/windows/build_release.ps1
```

The script installs locked dependencies, migrates and validates Supabase, bundles FastAPI into `kkr-backend.exe` with PyInstaller, copies the root `.env` into the backend resource, builds Tauri MSI and NSIS installers, and writes installers plus SHA-256 checksums to `dist/windows/latest/`.

## Manual verification

```powershell
Push-Location frontend
npm ci
npm run build
Pop-Location

Push-Location backend
uv run python -m compileall src
uv run pytest
uv run python -m scripts.preflight_check
Pop-Location
```

## Docker development

Docker Compose uses the same root `.env` and connects to Supabase; it does not start a separate local PostgreSQL server.

```powershell
docker compose up --build
```

## Repository rules

- Commit `.env.example`; never commit `.env` or certificate/private-key files.
- Apply schema changes through Alembic migrations and commit the migration files.
- Keep the service-role key out of `VITE_*` variables because Vite embeds those values in frontend JavaScript.
- Use a private Supabase Storage bucket for construction documents.
- Build the Windows installer on Windows.

## Main folders

```text
backend/               FastAPI, SQLAlchemy models, Alembic migrations
frontend/              React/Vite application
frontend/src-tauri/    Tauri desktop shell
scripts/windows/       Windows development and release scripts
deploy/windows/        Windows operator notes
```
