"""Validation, scoping, and execution of the read-only SQL the LLM writes.

The model is only ever allowed to produce a single SELECT. Before anything runs we
strip comments, reject every writing or system keyword, and confirm each referenced
table exists in the catalog. Row visibility is not left to the model: every scoped
table is replaced by a CTE of the same name that pre-filters soft-deleted rows and
restricts project access, so the model's query physically cannot see more than the
current user may read.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.services.schema_catalog import allowed_table_names, schema_tables

MAX_ROWS = 500
STATEMENT_TIMEOUT_MS = 8000

# Company-wide ledgers and identity tables stay with the roles that own them.
RESTRICTED_TABLES = frozenset(
    {
        "users",
        "audit_logs",
        "office_expenses",
        "office_settlements",
        "site_settlements",
    }
)

_FORBIDDEN_KEYWORDS = (
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "create",
    "truncate",
    "grant",
    "revoke",
    "comment",
    "copy",
    "vacuum",
    "reindex",
    "cluster",
    "listen",
    "notify",
    "call",
    "do",
    "execute",
    "prepare",
    "deallocate",
    "discard",
    "lock",
    "merge",
    "refresh",
    "set",
    "reset",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "into",
    "returning",
    "nextval",
    "setval",
    "currval",
    "dblink",
    "lo_import",
    "lo_export",
    "information_schema",
)

_FORBIDDEN_PATTERNS = (
    re.compile(r"\bpg_\w+", re.I),
    re.compile(r"\bpassword_hash\b", re.I),
    re.compile(r"\$\$"),
    re.compile(r"\bcurrent_setting\b", re.I),
    re.compile(r"\bset_config\b", re.I),
    re.compile(r"\w+\s*\.\s*\w+\s*\.", re.I),  # schema.table.column style qualification
)

_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
_STRING_LITERAL_RE = re.compile(r"'(?:''|[^'])*'")
_FROM_JOIN_RE = re.compile(r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_$]*)", re.I)
_CTE_RE = re.compile(r"(?:\bwith\b|,)\s*([a-zA-Z_][a-zA-Z0-9_$]*)\s+as\s*\(", re.I)
_QUALIFIED_RE = re.compile(r"\b([a-zA-Z_][a-zA-Z0-9_$]*)\s*\.", re.I)


class SQLValidationError(ValueError):
    """The generated SQL is unsafe or references something that does not exist."""


def _strip_comments(sql: str) -> str:
    return _BLOCK_COMMENT_RE.sub(" ", _LINE_COMMENT_RE.sub(" ", sql))


def _without_string_literals(sql: str) -> str:
    return _STRING_LITERAL_RE.sub("''", sql)


def referenced_tables(sql: str) -> set[str]:
    scrubbed = _without_string_literals(_strip_comments(sql))
    known = allowed_table_names()
    found = {match.group(1).lower() for match in _FROM_JOIN_RE.finditer(scrubbed)}
    return {name for name in found if name in known}


def cte_names(sql: str) -> set[str]:
    scrubbed = _without_string_literals(_strip_comments(sql))
    return {match.group(1).lower() for match in _CTE_RE.finditer(scrubbed)}


def validate_select(sql: str, *, restricted: bool = False) -> str:
    if not sql or not sql.strip():
        raise SQLValidationError("No SQL was produced.")

    cleaned = _strip_comments(sql).strip()
    cleaned = cleaned.rstrip(";").strip()
    if not cleaned:
        raise SQLValidationError("No SQL was produced.")

    scrubbed = _without_string_literals(cleaned)

    if ";" in scrubbed:
        raise SQLValidationError("Only a single SQL statement is allowed.")
    if not re.match(r"^\s*(select|with)\b", scrubbed, re.I):
        raise SQLValidationError("Only SELECT queries are allowed.")

    for keyword in _FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", scrubbed, re.I):
            raise SQLValidationError(f"The keyword '{keyword}' is not allowed in a read-only query.")
    for pattern in _FORBIDDEN_PATTERNS:
        if pattern.search(scrubbed):
            raise SQLValidationError("The query uses a construct that is not allowed in a read-only query.")

    known = allowed_table_names()
    local_names = cte_names(cleaned)
    used = {match.group(1).lower() for match in _FROM_JOIN_RE.finditer(scrubbed)}
    unknown = sorted(name for name in used if name not in known and name not in local_names)
    if unknown:
        raise SQLValidationError(
            f"Unknown table(s): {', '.join(unknown)}. Only tables from the provided schema may be queried."
        )

    aliases = {match.group(1).lower() for match in _QUALIFIED_RE.finditer(scrubbed)}
    if aliases.intersection(known.difference(used)):
        offending = sorted(aliases.intersection(known.difference(used)))
        raise SQLValidationError(
            f"Table(s) {', '.join(offending)} are referenced without appearing in FROM/JOIN."
        )

    scoped = referenced_tables(cleaned)
    collisions = sorted(local_names.intersection(scoped))
    if collisions:
        raise SQLValidationError(
            f"Do not define a CTE named after a table ({', '.join(collisions)}). Pick a different CTE name."
        )

    if restricted:
        blocked = sorted(scoped.intersection(RESTRICTED_TABLES))
        if blocked:
            raise SQLValidationError(
                f"Your role cannot read: {', '.join(blocked)}."
            )

    return cleaned


def build_scoped_sql(
    sql: str,
    *,
    accessible_project_ids: list[int],
    full_access: bool,
    max_rows: int = MAX_ROWS,
) -> str:
    """Wrap validated SQL so it can only read rows the current user may see."""
    catalog = schema_tables()
    guards: list[str] = []

    for name in sorted(referenced_tables(sql)):
        info = catalog[name]
        conditions: list[str] = []
        if info.soft_delete_column:
            conditions.append(f"{info.soft_delete_column} IS NULL")
        if not full_access and info.project_column:
            if accessible_project_ids:
                ids = ", ".join(str(int(value)) for value in accessible_project_ids)
                conditions.append(f"{info.project_column} IN ({ids})")
            else:
                conditions.append("false")
        if conditions:
            guards.append(f"{name} AS (SELECT * FROM public.{name} WHERE {' AND '.join(conditions)})")

    limit = max(1, min(int(max_rows), MAX_ROWS))
    inner = f"SELECT * FROM (\n{sql}\n) AS ai_result LIMIT {limit}"
    if not guards:
        return inner
    return "WITH " + ",\n     ".join(guards) + "\n" + inner


def _normalize(value: Any) -> Any:
    if isinstance(value, Decimal):
        number = float(value)
        return int(number) if number.is_integer() else round(number, 2)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="minutes")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 2)
    if isinstance(value, (dict, list)):
        return str(value)
    return value


def execute_select(db: Session, sql: str) -> tuple[list[str], list[list[Any]]]:
    """Run the scoped SQL in a fresh read-only transaction and return plain rows."""
    db.rollback()
    try:
        db.execute(text("SET TRANSACTION READ ONLY"))
        db.execute(text(f"SET LOCAL statement_timeout = {int(STATEMENT_TIMEOUT_MS)}"))
        result = db.execute(text(sql))
        columns = list(result.keys())
        rows = [[_normalize(value) for value in row] for row in result.fetchall()]
        return columns, rows
    finally:
        db.rollback()
