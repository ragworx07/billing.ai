from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from src.config import config
from src.core.services.schema_catalog import schema_tables
from src.core.services.sql_guard import SQLValidationError, validate_select
from src.core.services.storage_service import storage_service
from src.data.clients.session import engine


REQUIRED_TABLES = {
    "attendance_logs",
    "audit_logs",
    "clients",
    "expense_logs",
    "expense_master",
    "labor_logs",
    "material_logs",
    "material_master",
    "notes",
    "office_expenses",
    "payment_logs",
    "project_files",
    "project_file_folders",
    "project_milestones",
    "project_shareholders",
    "project_supervisors",
    "projects",
    "shareholder_payment_schedules",
    "shareholder_payments",
    "users",
    "vendor_master",
    "vendor_transactions",
    "workers",
    "work_reports",
}


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def check_database_connection() -> CheckResult:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return CheckResult("database_connection", True, "Database is reachable")
    except SQLAlchemyError as exc:
        return CheckResult("database_connection", False, f"Database connection failed: {exc}")


def check_required_tables() -> CheckResult:
    try:
        with engine.connect() as conn:
            existing = set(inspect(conn).get_table_names())
        missing = sorted(REQUIRED_TABLES - existing)
        if missing:
            return CheckResult("required_tables", False, f"Missing tables: {', '.join(missing)}")
        return CheckResult("required_tables", True, "All required tables are present")
    except SQLAlchemyError as exc:
        return CheckResult("required_tables", False, f"Unable to inspect tables: {exc}")


def check_owner_user() -> CheckResult:
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT id, email FROM users WHERE role = :role LIMIT 1"),
                {"role": "owner"},
            ).first()
        if row is None:
            return CheckResult("owner_user", False, "No owner user found (run bootstrap owner)")
        return CheckResult("owner_user", True, f"Owner user found: id={row.id}, email={row.email}")
    except SQLAlchemyError as exc:
        return CheckResult("owner_user", False, f"Owner user check failed: {exc}")


def check_storage_buckets() -> CheckResult:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        return CheckResult("storage_buckets", False, "Supabase URL or backend secret key is missing")
    try:
        private_buckets = [config.SUPABASE_PROJECT_FILES_BUCKET, config.SUPABASE_NOTES_BUCKET]
        for bucket in private_buckets:
            storage_service.ensure_bucket(bucket)
            storage_service.supabase.storage.get_bucket(bucket)
        storage_service.ensure_public_bucket(config.SUPABASE_MEDIA_BUCKET)
        storage_service.supabase.storage.get_bucket(config.SUPABASE_MEDIA_BUCKET)
        return CheckResult(
            "storage_buckets",
            True,
            f"Storage buckets ready: private={', '.join(private_buckets)}; public={config.SUPABASE_MEDIA_BUCKET}",
        )
    except Exception as exc:
        return CheckResult("storage_buckets", False, f"Supabase Storage check failed: {exc}")


def check_ai_sql_guard() -> CheckResult:
    """The AI assistant executes model-written SQL, so the guard must hold on every boot."""
    accepted = "SELECT project_name FROM projects ORDER BY project_name LIMIT 5"
    rejected = [
        "DROP TABLE projects",
        "SELECT * FROM projects; DELETE FROM projects",
        "UPDATE projects SET project_name = 'x'",
        "SELECT * FROM public.projects",
        "SELECT pg_sleep(10)",
        "SELECT password_hash FROM users",
        "WITH material_logs AS (SELECT 1) SELECT * FROM material_logs",
    ]
    try:
        validate_select(accepted)
        for sql in rejected:
            try:
                validate_select(sql)
            except SQLValidationError:
                continue
            return CheckResult("ai_sql_guard", False, f"Guard failed to block: {sql}")
        table_count = len(schema_tables())
        return CheckResult(
            "ai_sql_guard",
            True,
            f"Read-only SQL guard active over {table_count} catalogued table(s)",
        )
    except Exception as exc:
        return CheckResult("ai_sql_guard", False, f"SQL guard check failed: {exc}")


def main() -> int:
    print("== KKR ERP preflight ==")
    safe_database_url = make_url(config.DATABASE_URL).render_as_string(hide_password=True)
    print(f"Database URL: {safe_database_url}")

    checks = [
        check_database_connection(),
        check_required_tables(),
        check_owner_user(),
        check_storage_buckets(),
        check_ai_sql_guard(),
    ]

    all_ok = True
    for item in checks:
        state = "PASS" if item.ok else "FAIL"
        print(f"[{state}] {item.name}: {item.detail}")
        all_ok = all_ok and item.ok

    if all_ok:
        print("Preflight successful.")
        return 0

    print("Preflight failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
