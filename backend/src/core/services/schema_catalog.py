"""Read-only catalog of the live database, handed to the SQL-writing LLM.

The catalog is derived from SQLAlchemy metadata instead of a hand-written copy so
it can never drift from the real tables. Sensitive tables and columns are withheld.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import src.data.models.postgres  # noqa: F401  registers every table on the metadata
from src.data.clients.base_class import metadata

HIDDEN_TABLES = frozenset(
    {
        "alembic_version",
        "notes",  # personal sticky notes, including attachment payloads
        "system_settings",  # role permission configuration
    }
)

HIDDEN_COLUMNS = frozenset(
    {
        ("users", "password_hash"),
        # Storage plumbing and blob payloads: never useful for analytics.
        ("material_logs", "template_meta"),
        ("workers", "wage_options"),
        ("projects", "profile_image_url"),
        ("project_files", "stored_filename"),
        ("project_files", "storage_bucket"),
        ("project_files", "storage_path"),
        ("bills", "seal_type"),
        ("bills", "signature_image"),
    }
)

TABLE_NOTES: dict[str, str] = {
    "projects": "One row per construction project. Budget = construction_sqft * construction_rate_per_sqft. Existing-client government charges use composite/land-factor/area formulas. New-client GST and registration are a percent of due_amount. GST uses govt_new_gst_percent (default 5). Registration uses 6% up to 50 lakhs, 7% up to 3 crores, 9% above that.",
    "clients": "Client/landowner master. A project belongs to at most one client.",
    "project_shareholders": "JV shareholders (flat buyers) per project. due_amount is construction billed to them. new_area is new saleable area (sq.ft). legal_charges is the legal fee to collect from that client.",
    "shareholder_payments": "Money collected from a shareholder. purpose is construction, gst, registration, legal, or gst_invoice.",
    "shareholder_payment_schedules": "Planned construction installments per shareholder; due_date drives follow-ups.",
    "payment_logs": "Client payment milestones. Only status='received' counts as collected.",
    "bills": "GST tax invoices raised to shareholders. status is text: draft/partial/paid. gst_only means paid taxable value does not reduce construction.",
    "bill_items": "Line items of a GST invoice.",
    "material_logs": "Material purchases/consumption booked against a project.",
    "material_master": "Approved material catalog with default rates. No live stock quantity is tracked.",
    "labor_logs": "Daily labour entries per project (headcount, wage, overtime).",
    "attendance_logs": "Per-worker daily attendance for a project.",
    "workers": "Labour master with default daily wage.",
    "expense_logs": "Project-level site expenses (has project_id).",
    "site_expenses": "Weekly site petty-cash register. Each row is allocated to a project, to the office, or to neither.",
    "site_settlements": "Cash handed over to settle the site petty-cash register.",
    "office_expenses": "Weekly office/overhead register. Company-wide, NOT linked to a project.",
    "office_settlements": "Cash handed over to settle the office register.",
    "vendor_master": "Vendors and labour in-charges. party_type is 'material_vendor' or 'labour_incharge'.",
    "labour_incharge_limits": "Per-project cap on labour that can be booked for a labour incharge. Remaining = limit_amount minus labour booked on labor_logs for that vendor on the project.",
    "vendor_transactions": "Payments made to a vendor for a project.",
    "project_milestones": "Project schedule milestones. status is text: pending/completed.",
    "work_reports": "Daily site work reports.",
    "project_files": "Uploaded project documents metadata.",
    "project_file_folders": "Folder tree for project documents.",
    "project_supervisors": "Join table assigning supervisor users to projects.",
    "users": "Application logins. role drives access.",
    "audit_logs": "Who changed which record and when.",
    "expense_master": "Approved expense category catalog.",
}

METRIC_GUIDE = """
Derived metrics — always compute them exactly like this so answers match the app:

- Material value of a material_logs row:
  quantity * unit_cost * (1 + COALESCE(gst_percent, 0) / 100) + COALESCE(transport_cost, 0)
- Labour cost of a labor_logs row:
  CASE WHEN total_wage IS NOT NULL THEN total_wage
       ELSE COALESCE(labour_count, 0) * COALESCE(wage_per_head, 0) + COALESCE(overtime_cost, 0) END
- Project total cost = material value + labour cost + SUM(expense_logs.amount)
  + SUM(site_expenses.amount WHERE allocation = 'project') for that project.
- Project budget / total amount = projects.construction_sqft * projects.construction_rate_per_sqft.
  When that is 0, fall back to SUM(project_shareholders.due_amount) for the project.
- Project collected = SUM(payment_logs.amount WHERE status = 'received')
  + construction paid from shareholder_payments (purpose construction) and the taxable share of paid GST invoices except when bills.gst_only is true.
  Do not add gst / registration / legal / gst_invoice payment rows as construction collected, and do not count gst_invoice payments twice.
- Project outstanding = project budget - project collected.
- Profit is only meaningful for projects with status = 'completed' (budget - total cost).
- GST payable for an existing shareholder = govt_composite_value_per_sqft * govt_land_factor * new_area * govt_gst_percent / 100.
  For a new shareholder GST payable = due_amount * govt_new_gst_percent / 100 (default 5).
- Registration payable for an existing shareholder = govt_construction_cost_per_sqft * new_area * govt_registration_value_percent / 100.
  For a new shareholder registration payable = due_amount * slab%. Slab is 6% when due_amount <= 50 lakhs, 7% when due_amount <= 3 crores, else 9%.
- GST paid comes from bills: paid_amount allocated to tax_amount. Construction paid uses shareholder_payments (purpose construction) plus the taxable share of paid GST invoices except when bills.gst_only is true; do not count gst_invoice payments twice.
- site_expenses.allocation is one of 'project', 'office' or 'other'. Only rows with
  allocation = 'project' have a project_id and count toward that project's cost;
  'office' rows are shown in the Office tab and 'other' rows count nowhere.
""".strip()


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    type_label: str
    enum_values: tuple[str, ...]
    references: str | None
    primary_key: bool

    def render(self) -> str:
        parts = [self.name]
        # An id column's type is never in question, so the label is dead weight there.
        if not (self.name == "id" or self.name.endswith("_id")):
            parts.append(self.type_label)
        if self.enum_values:
            parts.append("=" + "|".join(self.enum_values))
        if self.references:
            parts.append("->" + self.references)
        return " ".join(parts)


@dataclass(frozen=True)
class TableInfo:
    name: str
    columns: tuple[ColumnInfo, ...]
    note: str
    soft_delete_column: str | None
    project_column: str | None

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(column.name for column in self.columns)

    def render(self) -> str:
        body = ", ".join(column.render() for column in self.columns)
        line = f"{self.name}({body})"
        return f"{line}\n  -- {self.note}" if self.note else line


def _foreign_key_label(column_name: str, target_fullname: str) -> str | None:
    """Keep the arrow only when the target is not obvious from the column name."""
    target_table = target_fullname.split(".")[0]
    if column_name.endswith("_id"):
        stem = column_name[:-3]
        if target_table in (stem, f"{stem}s", f"{stem}es"):
            return None
    return target_fullname


def _type_label(column) -> str:
    name = type(column.type).__name__.lower()
    if name in ("integer", "smallinteger", "biginteger"):
        return "int"
    if name in ("string", "text", "unicode", "unicodetext", "varchar"):
        return "text"
    if name == "datetime":
        return "timestamptz"
    if name in ("json", "jsonb"):
        return "json"
    if name == "boolean":
        return "bool"
    return name


@lru_cache(maxsize=1)
def schema_tables() -> dict[str, TableInfo]:
    tables: dict[str, TableInfo] = {}
    for table in sorted(metadata.tables.values(), key=lambda item: item.name):
        if table.name in HIDDEN_TABLES:
            continue
        raw_names = {column.name for column in table.columns}
        columns: list[ColumnInfo] = []
        for column in table.columns:
            if (table.name, column.name) in HIDDEN_COLUMNS:
                continue
            # The server always pre-filters soft deletes, so the model never needs this.
            if column.name == "deleted_at":
                continue
            references = None
            if column.foreign_keys:
                target = sorted(key.target_fullname for key in column.foreign_keys)[0]
                references = _foreign_key_label(column.name, target)
            columns.append(
                ColumnInfo(
                    name=column.name,
                    type_label=_type_label(column),
                    enum_values=tuple(getattr(column.type, "enums", None) or ()),
                    references=references,
                    primary_key=column.primary_key,
                )
            )
        project_column = "id" if table.name == "projects" else ("project_id" if "project_id" in raw_names else None)
        tables[table.name] = TableInfo(
            name=table.name,
            columns=tuple(columns),
            note=TABLE_NOTES.get(table.name, ""),
            soft_delete_column="deleted_at" if "deleted_at" in raw_names else None,
            project_column=project_column,
        )
    return tables


@lru_cache(maxsize=1)
def allowed_table_names() -> frozenset[str]:
    return frozenset(schema_tables().keys())


@lru_cache(maxsize=1)
def schema_prompt() -> str:
    lines = [table.render() for table in schema_tables().values()]
    return "\n".join(lines)
