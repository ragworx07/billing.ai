import os
import subprocess
import sys
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_python_config(env_vars: dict) -> subprocess.CompletedProcess:
    """Run a Python snippet importing src.config in an isolated subprocess with custom env."""
    full_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        **env_vars,
    }
    code = "from src.config import config; print('CONFIG_LOADED_OK', config.SECRET_KEY[:8])"
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=full_env,
        cwd=str(BACKEND_DIR),
    )


def test_missing_secret_key_raises_clear_error():
    env = {
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    # Explicitly ensure neither SECRET_KEY nor aliases are set
    res = run_python_config(env)
    assert res.returncode != 0
    assert "SECRET_KEY environment variable is missing" in res.stderr
    assert "Project Settings -> Environment Variables" in res.stderr


def test_empty_secret_key_raises_clear_error():
    env = {
        "SECRET_KEY": "   ",
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode != 0
    assert "is present in the environment but is empty or contains only whitespace/quotes" in res.stderr


def test_placeholder_secret_key_raises_clear_error():
    # Value from .env.example
    env = {
        "SECRET_KEY": "replace-with-at-least-32-random-characters",
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode != 0
    assert "contains an insecure placeholder value starting with 'replace-with'" in res.stderr


def test_short_secret_key_raises_clear_error():
    env = {
        "SECRET_KEY": "short-secret-key-12345",
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode != 0
    assert "is too short (22 characters)" in res.stderr
    assert "must contain at least 32 non-placeholder characters" in res.stderr


def test_quoted_secret_key_is_sanitized_and_accepted():
    valid_key = "a" * 32
    env = {
        "SECRET_KEY": f'"{valid_key}"',
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode == 0
    assert "CONFIG_LOADED_OK" in res.stdout


def test_fallback_to_jwt_secret_key():
    valid_key = "b" * 32
    env = {
        "JWT_SECRET_KEY": valid_key,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode == 0
    assert "CONFIG_LOADED_OK" in res.stdout


def test_fallback_to_jwt_secret():
    valid_key = "c" * 32
    env = {
        "JWT_SECRET": valid_key,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode == 0
    assert "CONFIG_LOADED_OK" in res.stdout


def test_safe_diagnostic_on_vercel():
    valid_key = "d" * 32
    env = {
        "VERCEL": "1",
        "SECRET_KEY": valid_key,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    res = run_python_config(env)
    assert res.returncode == 0
    assert "[CONFIG DIAGNOSTIC] SECRET_KEY present: True" in res.stdout
    assert "source: SECRET_KEY" in res.stdout
    assert "sanitized length: 32" in res.stdout
    # Ensure raw secret is NOT leaked in diagnostic output
    assert valid_key not in res.stdout


def test_local_storage_dir_on_vercel():
    env = {
        "VERCEL": "1",
        "SECRET_KEY": "e" * 32,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    code = "from src.config import config; print('STORAGE_DIR:', config.LOCAL_STORAGE_DIR)"
    full_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        **env,
    }
    res = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=full_env,
        cwd=str(BACKEND_DIR),
    )
    assert res.returncode == 0
    assert "STORAGE_DIR: /tmp/uploads" in res.stdout


def test_auth_token_roundtrip():
    valid_key = "f" * 32
    env = {
        "SECRET_KEY": valid_key,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    code = """
from src.utils.auth_utils import create_access_token, get_subject_from_token, is_valid_token

token = create_access_token(subject=42)
assert is_valid_token(token) is True
assert get_subject_from_token(token) == 42
print('AUTH_ROUNDTRIP_OK')
"""
    full_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        **env,
    }
    res = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=full_env,
        cwd=str(BACKEND_DIR),
    )
    assert res.returncode == 0
    assert "AUTH_ROUNDTRIP_OK" in res.stdout


def test_fastapi_app_startup_and_health_endpoint():
    valid_key = "g" * 32
    env = {
        "SECRET_KEY": valid_key,
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
    }
    code = """
import asyncio
from httpx import ASGITransport, AsyncClient
from src.main import app

async def check_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        res = await client.get('/api/v1/health')
        assert res.status_code == 200
        assert res.json() == {'status': 'ok'}
        print('HEALTH_ENDPOINT_OK')

asyncio.run(check_health())
"""
    full_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        **env,
    }
    res = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=full_env,
        cwd=str(BACKEND_DIR),
    )
    assert res.returncode == 0
    assert "HEALTH_ENDPOINT_OK" in res.stdout
