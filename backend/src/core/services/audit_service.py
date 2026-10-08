from dataclasses import dataclass

from sqlalchemy.orm import Session

from src.data.models.postgres.attendance_log import AttendanceLog
from src.data.models.postgres.audit_log import AuditLog
from src.data.models.postgres.bill import Bill
from src.data.models.postgres.client import Client
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.expense_master import ExpenseMaster
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.labour_incharge_limit import LabourInchargeLimit
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.material_master import MaterialMaster
from src.data.models.postgres.office_expense import OfficeExpense
from src.data.models.postgres.office_settlement import OfficeSettlement
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_file import ProjectFile
from src.data.models.postgres.project_file_folder import ProjectFileFolder
from src.data.models.postgres.project_milestone import ProjectMilestone
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.shareholder_payment_schedule import ShareholderPaymentSchedule
from src.data.models.postgres.site_expense import SiteExpense
from src.data.models.postgres.site_settlement import SiteSettlement
from src.data.models.postgres.user import User
from src.data.models.postgres.vendor_master import VendorMaster
from src.data.models.postgres.vendor_transaction import VendorTransaction
from src.data.models.postgres.work_report import WorkReport
from src.data.models.postgres.worker import Worker

MAX_DETAILS_LENGTH = 500

PERMISSION_LABELS = {
    "tab_gst_invoices": "GST Invoices / Bill Invoice",
    "gst_invoice_manage": "Create / Edit Bill Invoices",
    "gst_invoice_export": "Export GST Invoices",
    "client_gst_billing": "New GST Billing",
    "tab_vendors": "Vendors Master",
    "labour_incharge_detail": "Labour Incharge Details",
    "labour_incharge_limit": "Labour Incharge Limits",
    "client_government_charges": "Government Charges",
    "vendor_transaction_manage": "Manage Vendor Transactions",
}

ROLE_PERMISSIONS_RECORD_ID = 1
CUSTOM_ROLES_RECORD_ID = 2


def _clip_details(details: str | None) -> str | None:
    text = details.strip() if isinstance(details, str) else ""
    if not text:
        return None
    return text[:MAX_DETAILS_LENGTH]


def log_action(db: Session, user: User, action: str, table_name: str, record_id: int, details: str | None = None) -> None:
    text = _clip_details(details)
    if not text and record_id:
        context = resolve_audit_context(db, [(table_name, int(record_id))]).get((table_name, int(record_id)))
        if context:
            text = _clip_details(_join(context.project_name, context.subject))
    db.add(
        AuditLog(
            user_id=user.id,
            actor_name=user.name,
            actor_email=user.email,
            action=action,
            table_name=table_name,
            record_id=record_id,
            details=text,
        )
    )
    db.commit()


def permission_label(key: str) -> str:
    if key in PERMISSION_LABELS:
        return PERMISSION_LABELS[key]
    return key.replace("_", " ").strip().title()


def role_label(role: str) -> str:
    return str(role or "role").replace("_", " ").strip().title()


def summarize_permission_changes(old: dict, new: dict) -> str | None:
    old_map = old if isinstance(old, dict) else {}
    new_map = new if isinstance(new, dict) else {}
    lines: list[str] = []
    for role in sorted({str(key) for key in list(old_map.keys()) + list(new_map.keys())}):
        old_keys = {str(item) for item in (old_map.get(role) or [])}
        new_keys = {str(item) for item in (new_map.get(role) or [])}
        enabled = sorted(new_keys - old_keys)
        disabled = sorted(old_keys - new_keys)
        if not enabled and not disabled:
            continue
        parts: list[str] = []
        if enabled:
            parts.append("on " + ", ".join(permission_label(key) for key in enabled))
        if disabled:
            parts.append("off " + ", ".join(permission_label(key) for key in disabled))
        lines.append(f"{role_label(role)}: {'; '.join(parts)}")
    return _clip_details("; ".join(lines)) if lines else None


@dataclass
class AuditContext:
    project_name: str | None = None
    subject: str | None = None


def _label(value: object) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        value = value.value
    return str(value).replace("_", " ").strip()


def _money(value: object) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return ""
    return f"₹{amount:,.2f}"


def _join(*parts: object) -> str:
    return " · ".join(str(part).strip() for part in parts if str(part or "").strip())


def _load_map(db: Session, model, ids: set[int]) -> dict[int, object]:
    if not ids:
        return {}
    return {row.id: row for row in db.query(model).filter(model.id.in_(ids)).all()}


def _project_names(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return {
        row.id: row.project_name
        for row in db.query(Project.id, Project.project_name).filter(Project.id.in_(ids)).all()
    }


def resolve_audit_context(db: Session, records: list[tuple[str, int]]) -> dict[tuple[str, int], AuditContext]:
    grouped: dict[str, set[int]] = {}
    for table_name, record_id in records:
        if table_name and record_id:
            grouped.setdefault(table_name, set()).add(int(record_id))

    projects = _load_map(db, Project, grouped.get("projects", set()) | grouped.get("government_charges", set()))
    materials = _load_map(db, MaterialLog, grouped.get("material_logs", set()))
    labor = _load_map(db, LaborLog, grouped.get("labor_logs", set()))
    expenses = _load_map(db, ExpenseLog, grouped.get("expense_logs", set()))
    payments = _load_map(db, PaymentLog, grouped.get("payment_logs", set()))
    vendor_txns = _load_map(db, VendorTransaction, grouped.get("vendor_transactions", set()))
    limits = _load_map(db, LabourInchargeLimit, grouped.get("labour_incharge_limits", set()))
    files = _load_map(db, ProjectFile, grouped.get("project_files", set()))
    folders = _load_map(db, ProjectFileFolder, grouped.get("project_file_folders", set()))
    milestones = _load_map(db, ProjectMilestone, grouped.get("project_milestones", set()) | grouped.get("milestones", set()))
    shareholders = _load_map(
        db,
        ProjectShareholder,
        grouped.get("project_shareholders", set()) | grouped.get("shareholder_payment_schedules", set()),
    )
    shareholder_payments = _load_map(db, ShareholderPayment, grouped.get("shareholder_payments", set()))
    schedules = _load_map(db, ShareholderPaymentSchedule, grouped.get("shareholder_payment_schedules", set()))
    bills = _load_map(db, Bill, grouped.get("bills", set()))
    clients = _load_map(db, Client, grouped.get("clients", set()))
    workers = _load_map(db, Worker, grouped.get("workers", set()))
    vendors = _load_map(db, VendorMaster, grouped.get("vendor_master", set()))
    material_master = _load_map(db, MaterialMaster, grouped.get("material_master", set()))
    expense_master = _load_map(db, ExpenseMaster, grouped.get("expense_master", set()))
    site_expenses = _load_map(db, SiteExpense, grouped.get("site_expenses", set()))
    office_expenses = _load_map(db, OfficeExpense, grouped.get("office_expenses", set()))
    site_settlements = _load_map(db, SiteSettlement, grouped.get("site_settlements", set()))
    office_settlements = _load_map(db, OfficeSettlement, grouped.get("office_settlements", set()))
    attendance = _load_map(db, AttendanceLog, grouped.get("attendance_logs", set()))
    reports = _load_map(db, WorkReport, grouped.get("work_reports", set()))
    users = _load_map(db, User, grouped.get("users", set()))

    extra_project_ids: set[int] = set()
    extra_vendor_ids: set[int] = set()
    extra_shareholder_ids: set[int] = set()
    extra_worker_ids: set[int] = set()
    for row in [
        *materials.values(),
        *labor.values(),
        *expenses.values(),
        *payments.values(),
        *vendor_txns.values(),
        *limits.values(),
        *files.values(),
        *folders.values(),
        *milestones.values(),
        *shareholders.values(),
        *shareholder_payments.values(),
        *schedules.values(),
        *bills.values(),
        *site_expenses.values(),
        *attendance.values(),
        *reports.values(),
    ]:
        project_id = getattr(row, "project_id", None)
        if project_id:
            extra_project_ids.add(int(project_id))
        vendor_id = getattr(row, "vendor_id", None)
        if vendor_id:
            extra_vendor_ids.add(int(vendor_id))
        shareholder_id = getattr(row, "shareholder_id", None)
        if shareholder_id:
            extra_shareholder_ids.add(int(shareholder_id))
        worker_id = getattr(row, "worker_id", None)
        if worker_id:
            extra_worker_ids.add(int(worker_id))

    project_names = _project_names(db, extra_project_ids)
    for project in projects.values():
        project_names[project.id] = project.project_name
    vendor_names = {
        row.id: row.name
        for row in db.query(VendorMaster.id, VendorMaster.name).filter(VendorMaster.id.in_(extra_vendor_ids)).all()
    } if extra_vendor_ids else {}
    for vendor in vendors.values():
        vendor_names[vendor.id] = vendor.name
    shareholder_names = {
        row.id: row.name
        for row in db.query(ProjectShareholder.id, ProjectShareholder.name)
        .filter(ProjectShareholder.id.in_(extra_shareholder_ids))
        .all()
    } if extra_shareholder_ids else {}
    for shareholder in shareholders.values():
        shareholder_names[shareholder.id] = shareholder.name
    worker_names = {
        row.id: row.name
        for row in db.query(Worker.id, Worker.name).filter(Worker.id.in_(extra_worker_ids)).all()
    } if extra_worker_ids else {}
    for worker in workers.values():
        worker_names[worker.id] = worker.name

    def project_of(row: object, fallback: str | None = None) -> str | None:
        project_id = getattr(row, "project_id", None)
        if project_id and int(project_id) in project_names:
            return project_names[int(project_id)]
        custom = getattr(row, "custom_project_name", None)
        return str(custom).strip() if custom else fallback

    resolved: dict[tuple[str, int], AuditContext] = {}

    def put(table_name: str, record_id: int, project_name: str | None, subject: str | None) -> None:
        resolved[(table_name, record_id)] = AuditContext(project_name=project_name or None, subject=subject or None)

    for record_id, row in projects.items():
        put("projects", record_id, row.project_name, _join(row.project_name, row.location))
        put("government_charges", record_id, row.project_name, "Government charges")

    for record_id, row in materials.items():
        put("material_logs", record_id, project_of(row), _join(row.material_name, f"{row.quantity} {row.unit}".strip(), row.supplier))
    for record_id, row in labor.items():
        vendor = vendor_names.get(row.vendor_id) if row.vendor_id else None
        put("labor_logs", record_id, project_of(row), _join(row.labour_type, vendor, f"{row.labour_count} workers"))
    for record_id, row in expenses.items():
        put("expense_logs", record_id, project_of(row), _join(row.category, row.description, _money(row.amount)))
    for record_id, row in payments.items():
        put("payment_logs", record_id, project_of(row), _join(_label(row.payment_type), _money(row.amount), _label(row.status)))
    for record_id, row in vendor_txns.items():
        vendor = vendor_names.get(row.vendor_id, "")
        put("vendor_transactions", record_id, project_of(row), _join(vendor, _money(row.amount), row.payment_mode))
    for record_id, row in limits.items():
        vendor = vendor_names.get(row.vendor_id, "")
        put("labour_incharge_limits", record_id, project_of(row), _join(vendor, "limit", _money(row.limit_amount)))
    for record_id, row in files.items():
        put("project_files", record_id, project_of(row), row.original_filename)
    for record_id, row in folders.items():
        put("project_file_folders", record_id, project_of(row), row.name)
    for record_id, row in milestones.items():
        put("project_milestones", record_id, project_of(row), row.title)
        put("milestones", record_id, project_of(row), row.title)
    for record_id, row in shareholders.items():
        put("project_shareholders", record_id, project_of(row), row.name)
        if ("shareholder_payment_schedules", record_id) not in resolved:
            put("shareholder_payment_schedules", record_id, project_of(row), _join(row.name, "payment schedule"))
    for record_id, row in schedules.items():
        if ("shareholder_payment_schedules", record_id) in resolved:
            continue
        name = shareholder_names.get(row.shareholder_id, "")
        put("shareholder_payment_schedules", record_id, project_of(row), _join(name, f"installment {row.installment_no}", _money(row.amount)))
    for record_id, row in shareholder_payments.items():
        name = shareholder_names.get(row.shareholder_id, "")
        put("shareholder_payments", record_id, project_of(row), _join(name, _label(row.purpose), _money(row.amount)))
    for record_id, row in bills.items():
        put("bills", record_id, project_of(row), _join(row.bill_number, row.client_name, _money(row.total_amount)))
    for record_id, row in clients.items():
        put("clients", record_id, None, _join(row.name, row.company_name))
    for record_id, row in workers.items():
        put("workers", record_id, None, _join(row.name, row.role))
    for record_id, row in vendors.items():
        kind = "Labour incharge" if row.party_type == "labour_incharge" else "Vendor"
        put("vendor_master", record_id, None, _join(kind, row.name, row.work_field))
    for record_id, row in material_master.items():
        put("material_master", record_id, None, _join(row.name, row.unit))
    for record_id, row in expense_master.items():
        put("expense_master", record_id, None, row.name)
    for record_id, row in site_expenses.items():
        put("site_expenses", record_id, project_of(row, "Site"), _join(row.item_name or row.category, _money(row.amount)))
    for record_id, row in office_expenses.items():
        put("office_expenses", record_id, "Office", _join(row.item_name or row.category, _money(row.amount)))
    for record_id, row in site_settlements.items():
        put("site_settlements", record_id, "Site", _join("Settlement", _money(row.amount)))
    for record_id, row in office_settlements.items():
        put("office_settlements", record_id, "Office", _join("Settlement", _money(row.amount)))
    for record_id, row in attendance.items():
        worker = worker_names.get(row.worker_id, "")
        put("attendance_logs", record_id, project_of(row), _join(worker, _label(row.status), str(row.date)))
    for record_id, row in reports.items():
        snippet = (row.work_done or "").strip().replace("\n", " ")
        put("work_reports", record_id, project_of(row), snippet[:120])
    for record_id, row in users.items():
        put("users", record_id, None, _join(row.name, row.email))

    return resolved


def summarize_custom_role_changes(old: list, new: list) -> str | None:
    def role_id(item: object) -> str:
        if isinstance(item, dict):
            return str(item.get("id") or item.get("value") or "")
        return ""

    def role_name(item: object) -> str:
        if isinstance(item, dict):
            return str(item.get("label") or item.get("name") or item.get("id") or "custom role")
        return "custom role"

    old_list = old if isinstance(old, list) else []
    new_list = new if isinstance(new, list) else []
    old_by_id = {role_id(item): item for item in old_list if role_id(item)}
    new_by_id = {role_id(item): item for item in new_list if role_id(item)}
    added = [role_name(new_by_id[key]) for key in new_by_id.keys() - old_by_id.keys()]
    removed = [role_name(old_by_id[key]) for key in old_by_id.keys() - new_by_id.keys()]
    parts: list[str] = []
    if added:
        parts.append("added " + ", ".join(added))
    if removed:
        parts.append("removed " + ", ".join(removed))
    if not parts and old_list != new_list:
        parts.append("updated custom role definitions")
    return _clip_details("; ".join(parts)) if parts else None
