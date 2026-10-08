# KKR ERP Backend

FastAPI backend for the KKR ERP desktop application. Configuration comes from the repository-root `.env`; `backend/.env` remains a local backward-compatible fallback.

## Setup

```bash
cd ..
cp .env.example .env
cd backend
uv sync --extra build --extra dev --frozen
uv run alembic -c alembic.ini upgrade head
uv run python -m scripts.preflight_check
uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

Use a Supabase direct or Session pooler connection with SSL. The backend uses a small SQLAlchemy pool suitable for the persistent local desktop service.

## Tests

```bash
uv run pytest
uv run python -m compileall src
```

## Desktop bundle

`kkr-backend.spec` creates a one-directory PyInstaller bundle. Use the root platform release scripts instead of invoking it manually; they also run migrations, preflight validation, copy `.env`, and build Tauri.

The `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it through a `VITE_*` variable or commit it to Git.
