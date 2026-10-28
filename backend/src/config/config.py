import os
import sys
from pathlib import Path
from typing import List
from urllib.parse import quote_plus

from dotenv import load_dotenv

base_dir = Path(__file__).resolve().parents[2]
exe_env_path = Path(sys.executable).resolve().parent / ".env" if getattr(sys, "frozen", False) else None
repo_env_path = base_dir.parent / ".env"
local_env_path = base_dir / ".env.local"
env_path = base_dir / ".env"

for candidate in (exe_env_path, repo_env_path, local_env_path, env_path):
    if candidate and candidate.exists():
        load_dotenv(dotenv_path=candidate, override=False)

def _normalize_database_url(value: str) -> str:
    if value:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://") and "+psycopg" not in value:
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


def _build_database_url() -> str:
    host = os.getenv("DATABASE_HOST", "").strip()
    port = os.getenv("DATABASE_PORT", "").strip()
    name = os.getenv("DATABASE_NAME", "").strip()
    user = os.getenv("DATABASE_USER", "").strip()
    password = os.getenv("DATABASE_PASSWORD", "")
    sslmode = os.getenv("DATABASE_SSLMODE", "require").strip()
    if host and name and user:
        encoded_password = quote_plus(password)
        encoded_user = quote_plus(user)
        port_part = f":{port}" if port else ""
        return f"postgresql+psycopg://{encoded_user}:{encoded_password}@{host}{port_part}/{name}?sslmode={sslmode}"
    return _normalize_database_url(os.getenv("DATABASE_URL", ""))

def _clean_secret(val: str | None) -> str:
    if val is None:
        return ""
    cleaned = val.strip()
    if len(cleaned) >= 2:
        if (cleaned.startswith('"') and cleaned.endswith('"')) or (
            cleaned.startswith("'") and cleaned.endswith("'")
        ):
            cleaned = cleaned[1:-1].strip()
    return cleaned


_INSECURE_PLACEHOLDER_PREFIXES = (
    "replace-with",
    "your-secret",
    "change-me",
    "changeme",
    "<secret",
    "insert-secret",
)
_INSECURE_PLACEHOLDER_EXACT = {
    "secret",
    "secretkey",
    "secret_key",
    "placeholder",
    "replace_with_at_least_32_random_characters",
}


def _detect_placeholder(val: str) -> str | None:
    lower = val.lower()
    for prefix in _INSECURE_PLACEHOLDER_PREFIXES:
        if lower.startswith(prefix):
            return prefix
    if lower in _INSECURE_PLACEHOLDER_EXACT:
        return lower
    return None


APP_NAME = os.getenv("APP_NAME", "Application")
API_V1_STR = os.getenv("API_V1_STR", "/api/v1")

# Resolve secret key with supported aliases
_raw_secret_key = os.getenv("SECRET_KEY")
_secret_source = "SECRET_KEY"
if _raw_secret_key is None or not _raw_secret_key.strip():
    _jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if _jwt_secret_key is not None and _jwt_secret_key.strip():
        _raw_secret_key = _jwt_secret_key
        _secret_source = "JWT_SECRET_KEY"
    else:
        _jwt_secret = os.getenv("JWT_SECRET")
        if _jwt_secret is not None and _jwt_secret.strip():
            _raw_secret_key = _jwt_secret
            _secret_source = "JWT_SECRET"

_cleaned_secret = _clean_secret(_raw_secret_key)

# Safe configuration diagnostic (never prints the secret value)
if os.getenv("VERCEL") or os.getenv("CONFIG_DEBUG"):
    print(
        f"[CONFIG DIAGNOSTIC] SECRET_KEY present: {_raw_secret_key is not None} | "
        f"source: {_secret_source if _raw_secret_key is not None else 'NONE'} | "
        f"sanitized length: {len(_cleaned_secret)}"
    )

if _raw_secret_key is None:
    raise RuntimeError(
        "SECRET_KEY environment variable is missing from the environment. "
        "Please define SECRET_KEY (or JWT_SECRET_KEY) in your environment variables. "
        "On Vercel, ensure it is added under Project Settings -> Environment Variables "
        "for the active environment (Production, Preview, or Development) and redeploy."
    )

if not _cleaned_secret:
    raise RuntimeError(
        f"{_secret_source} is present in the environment but is empty or contains only whitespace/quotes. "
        "A valid secret string with at least 32 characters is required."
    )

_placeholder_hit = _detect_placeholder(_cleaned_secret)
if _placeholder_hit:
    raise RuntimeError(
        f"{_secret_source} contains an insecure placeholder value starting with '{_placeholder_hit}'. "
        "You must replace it with a cryptographically secure random string of at least 32 characters "
        "(e.g., generated with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`)."
    )

if len(_cleaned_secret) < 32:
    raise RuntimeError(
        f"{_secret_source} is too short ({len(_cleaned_secret)} characters). "
        "SECRET_KEY must contain at least 32 non-placeholder characters for secure JWT signing."
    )

SECRET_KEY = _cleaned_secret
JWT_SECRET_KEY = SECRET_KEY

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "11520"))
ALGORITHM = os.getenv("ALGORITHM", "HS256")
DATABASE_URL = _build_database_url()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required. Set it to your Supabase Postgres connection string.")
if "PROJECT_REF" in DATABASE_URL or "URL_ENCODED_PASSWORD" in DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL contains placeholder values ('PROJECT_REF' / 'URL_ENCODED_PASSWORD'). "
        "Set it to your actual Supabase Postgres connection string."
    )

SUPABASE_URL = os.getenv("SUPABASE_URL")
_raw_supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
_supabase_service_role_key = _clean_secret(_raw_supabase_key)
if not _supabase_service_role_key or _detect_placeholder(_supabase_service_role_key):
    _supabase_service_role_key = _clean_secret(os.getenv("SUPABASE_KEY"))
SUPABASE_SERVICE_ROLE_KEY = _supabase_service_role_key
# Backward-compatible alias for existing storage code and older private environments.
SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY
STORAGE_PROVIDER = os.getenv("STORAGE_PROVIDER", "gdrive").strip().lower()
GDRIVE_ROOT_FOLDER_ID = os.getenv("GDRIVE_ROOT_FOLDER_ID", "1j_H2hE0Qt0hffjN0q3BpomxnqdFtz7mC").strip()
_gdrive_cred_raw = os.getenv("GDRIVE_CREDENTIALS_FILE", "gdrive_credentials.json").strip()
_gdrive_cred_path = Path(_gdrive_cred_raw)
if not _gdrive_cred_path.is_absolute():
    for candidate_dir in (base_dir, base_dir.parent):
        candidate_file = candidate_dir / _gdrive_cred_raw
        if candidate_file.exists():
            _gdrive_cred_path = candidate_file
            break
        # Also check for kkr-erp-*.json
        alt_matches = list(candidate_dir.glob("kkr-erp-*.json"))
        if alt_matches:
            _gdrive_cred_path = alt_matches[0]
            break
GDRIVE_CREDENTIALS_PATH = str(_gdrive_cred_path)

_gdrive_token_raw = os.getenv("GDRIVE_TOKEN_FILE", "gdrive_token.json").strip()
_gdrive_token_path = Path(_gdrive_token_raw)
if not _gdrive_token_path.is_absolute():
    for candidate_dir in (base_dir, base_dir.parent):
        candidate_file = candidate_dir / _gdrive_token_raw
        if candidate_file.exists():
            _gdrive_token_path = candidate_file
            break
GDRIVE_TOKEN_PATH = str(_gdrive_token_path)
GDRIVE_BACKUP_FOLDER_ID = os.getenv("GDRIVE_BACKUP_FOLDER_ID", "").strip()

# Automated Backup Settings (defaults configurable via .env)
BACKUP_AUTO_ENABLED = os.getenv("BACKUP_AUTO_ENABLED", "true").strip().lower() in ("true", "1", "yes")
BACKUP_FREQUENCY = os.getenv("BACKUP_FREQUENCY", "daily").strip().lower()
BACKUP_TIME = os.getenv("BACKUP_TIME", "02:00").strip()
BACKUP_RETENTION_COUNT = int(os.getenv("BACKUP_RETENTION_COUNT", "7"))
BACKUP_DESTINATION = os.getenv("BACKUP_DESTINATION", "gdrive").strip().lower()
BACKUP_INCLUDE_DATABASE = os.getenv("BACKUP_INCLUDE_DATABASE", "true").strip().lower() in ("true", "1", "yes")
BACKUP_INCLUDE_FINANCIALS = os.getenv("BACKUP_INCLUDE_FINANCIALS", "true").strip().lower() in ("true", "1", "yes")
BACKUP_INCLUDE_MANIFEST = os.getenv("BACKUP_INCLUDE_MANIFEST", "true").strip().lower() in ("true", "1", "yes")

SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "")
SUPABASE_PROJECT_FILES_BUCKET = os.getenv("SUPABASE_PROJECT_FILES_BUCKET", SUPABASE_STORAGE_BUCKET or "project-files")
SUPABASE_NOTES_BUCKET = os.getenv("SUPABASE_NOTES_BUCKET", "note-attachments")
# Public bucket for project profile images and bill/receipt previews shown in <img> tags.
SUPABASE_MEDIA_BUCKET = os.getenv("SUPABASE_MEDIA_BUCKET", "").strip() or "media"
LOCAL_STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "").strip() or str(
    (Path("/tmp") if os.getenv("VERCEL") else Path(__file__).resolve().parents[2]) / "uploads"
)

DATABASE_POOL_SIZE = int(os.getenv("DATABASE_POOL_SIZE", "5"))
DATABASE_MAX_OVERFLOW = int(os.getenv("DATABASE_MAX_OVERFLOW", "5"))
DATABASE_POOL_RECYCLE_SECONDS = int(os.getenv("DATABASE_POOL_RECYCLE_SECONDS", "1800"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_raw_model = os.getenv("GROQ_MODEL", "").strip()
GROQ_MODEL = _raw_model if _raw_model and _raw_model != "llama-3.3-70b-versatile" else "openai/gpt-oss-120b"
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "20"))

_cors_origins = os.getenv("CORS_ORIGINS", "")
_cors_allow_methods = os.getenv("CORS_ALLOW_METHODS", "")
_cors_allow_headers = os.getenv("CORS_ALLOW_HEADERS", "")

CORS_ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() in ("true", "1", "t", "yes", "y")

_desktop_cors_origins = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]
_configured_cors_origins = [origin.strip() for origin in _cors_origins.split(",") if origin.strip()]
CORS_ORIGINS_LIST: List[str] = list(dict.fromkeys([*_configured_cors_origins, *_desktop_cors_origins]))
CORS_ALLOW_METHODS_LIST: List[str] = [method.strip() for method in _cors_allow_methods.split(",") if method.strip()] or ["*"]
CORS_ALLOW_HEADERS_LIST: List[str] = [header.strip() for header in _cors_allow_headers.split(",") if header.strip()] or ["*"]
