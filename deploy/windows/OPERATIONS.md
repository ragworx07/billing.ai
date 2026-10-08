# KKR ERP Windows Operations

## Development commands

```powershell
./scripts/windows/migrate.ps1
./scripts/windows/preflight.ps1
./scripts/windows/start_app.ps1
./scripts/windows/stop_app.ps1
```

All commands read the repository-root `.env` through the backend configuration.

## Release

```powershell
./scripts/windows/build_release.ps1
```

Output:

- `dist/windows/latest/*.msi`
- `dist/windows/latest/*.exe`
- `dist/windows/latest/SHA256SUMS.txt`

## Health and logs

- API health: `http://127.0.0.1:8000/api/v1/health`
- Installed backend logs: `%LOCALAPPDATA%\KKR ERP\logs`

## Supabase backup

Prefer Supabase managed backups. For an additional manual backup with PostgreSQL client tools:

```powershell
./scripts/windows/backup_db.ps1
```

Restore is destructive and requires explicit confirmation:

```powershell
./scripts/windows/restore_db.ps1 -BackupFile "backups/kkr_supabase_YYYYMMDD_HHMMSS.backup"
```

## Credential rotation

If `.env`, an installer, or old Git history is exposed, rotate the Supabase database password, service-role key, Groq key, and JWT `SECRET_KEY`, then rebuild the application.
