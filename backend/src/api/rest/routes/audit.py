from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, get_db
from src.core.services.audit_service import log_action, resolve_audit_context
from src.data.models.postgres.audit_log import AuditLog
from src.data.models.postgres.enums import UserRole
from src.data.models.postgres.user import User

router = APIRouter()


TABLE_CATEGORY_MAP: dict[str, tuple[str, str]] = {
    "projects": ("Projects", "Projects Tab"),
    "material_logs": ("Materials", "Project > Materials"),
    "labor_logs": ("Labour", "Project > Labour"),
    "expense_logs": ("Expenses", "Project > Expenses"),
    "payment_logs": ("Payments", "Project > Payments"),
    "vendor_transactions": ("Vendor Payments", "Project > Vendor Payments"),
    "labour_incharge_limits": ("Labour Incharge Limits", "Project > Transactions"),
    "project_files": ("Project Files", "Project > Files"),
    "project_file_folders": ("File Folders", "Project > Files"),
    "site_expenses": ("Site Expenses", "Office > Site Expenses"),
    "site_settlements": ("Site Settlements", "Office > Site Expenses"),
    "office_expenses": ("Office Expenses", "Office > Office Expenses"),
    "office_settlements": ("Office Settlements", "Office > Office Expenses"),
    "clients": ("Clients", "Clients Tab"),
    "shareholder_payments": ("Client Payments", "Clients > Payments & GST"),
    "government_charges": ("Government Charges", "Clients > Government Charges"),
    "bills": ("GST Invoices", "GST Invoices / Bill Invoice"),
    "workers": ("Workers", "Workers Tab"),
    "vendor_master": ("Vendors & Incharges", "Vendors Tab"),
    "material_master": ("Material Master", "Materials Catalog"),
    "expense_master": ("Expense Master", "Expenses Catalog"),
    "milestones": ("Milestones", "Milestones Tab"),
    "notes": ("Notes", "Notes Tab"),
    "users": ("User Access", "User Access Page"),
    "role_permissions": ("Role Permissions", "User Access > Permissions Toggle"),
    "custom_user_roles": ("Custom Roles", "User Access > Custom Roles"),
}


from typing import Any

class AuditRecordRef(BaseModel):
    table_name: str = Field(default="", max_length=100)
    record_id: Any = None


class AuditActorsRequest(BaseModel):
    records: list[AuditRecordRef] = Field(default_factory=list, max_length=5000)


class AuditHistoryItem(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_email: str
    user_role: str
    user_initials: str
    action: str
    table_name: str
    category_label: str
    tab_label: str
    record_id: int
    project_name: str | None = None
    subject: str | None = None
    details: str | None = None
    timestamp: str


def _initials(name: str, email: str) -> str:
    words = [part for part in name.strip().split() if part]
    if len(words) >= 2:
        return "".join(part[0] for part in words[:2]).upper()
    fallback = words[0] if words else email.split("@", 1)[0]
    letters = "".join(character for character in fallback if character.isalnum()).upper()
    return (letters[:2] or "??").ljust(2, "?")


@router.post("/actors")
async def get_audit_actors(
    payload: AuditActorsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if not payload.records:
        return {}

    requested: set[tuple[str, int]] = set()
    for item in payload.records:
        try:
            tbl = str(item.table_name or "").strip()
            rec_id = int(item.record_id)
            if tbl and rec_id > 0:
                requested.add((tbl, rec_id))
        except (ValueError, TypeError):
            continue

    if not requested:
        return {}

    table_names = {item[0] for item in requested}
    record_ids = {item[1] for item in requested}
    rows = (
        db.query(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.user_id)
        .filter(AuditLog.table_name.in_(table_names), AuditLog.record_id.in_(record_ids))
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .all()
    )

    actors: dict[str, dict[str, str | int]] = {}
    for audit, user in rows:
        key = f"{audit.table_name}:{audit.record_id}"
        if (audit.table_name, audit.record_id) not in requested or key in actors:
            continue
        actor_name = user.name if user else "Deleted User"
        actor_email = user.email if user else ""
        actors[key] = {
            "initials": _initials(actor_name, actor_email),
            "name": actor_name,
            "email": actor_email,
            "action": audit.action,
            "timestamp": audit.timestamp.isoformat(),
        }
    return actors


@router.get("/history", response_model=list[AuditHistoryItem])
async def get_audit_history(
    user_id: int | None = Query(None),
    action: str | None = Query(None),
    table_name: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(500, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can view user history audit logs."
        )

    query = db.query(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)

    if user_id is not None and user_id > 0:
        query = query.filter(AuditLog.user_id == user_id)

    if action and action.strip() and action.strip().lower() != "all":
        query = query.filter(AuditLog.action == action.strip().lower())

    if table_name and table_name.strip() and table_name.strip().lower() != "all":
        query = query.filter(AuditLog.table_name == table_name.strip())

    if start_date and start_date.strip():
        try:
            parsed_start = datetime.strptime(start_date.strip()[:10], "%Y-%m-%d")
            query = query.filter(AuditLog.timestamp >= parsed_start)
        except Exception:
            pass

    if end_date and end_date.strip():
        try:
            parsed_end = datetime.strptime(end_date.strip()[:10] + " 23:59:59", "%Y-%m-%d %H:%M:%S")
            query = query.filter(AuditLog.timestamp <= parsed_end)
        except Exception:
            pass

    fetch_limit = min(max(limit * 5, limit), 2000) if search and search.strip() else limit
    rows = query.order_by(AuditLog.timestamp.desc(), AuditLog.id.desc()).limit(fetch_limit).all()
    contexts = resolve_audit_context(db, [(audit.table_name, audit.record_id) for audit, _user_obj in rows])
    needle = search.strip().lower() if search and search.strip() else ""

    result: list[AuditHistoryItem] = []
    for audit, user_obj in rows:
        cat_label, tab_label = TABLE_CATEGORY_MAP.get(
            audit.table_name, (audit.table_name.replace("_", " ").title(), audit.table_name)
        )
        user_name = user_obj.name if user_obj else "Deleted User"
        user_email = user_obj.email if user_obj else ""
        user_role_str = (
            (user_obj.role.value if hasattr(user_obj.role, "value") else str(user_obj.role))
            if user_obj and user_obj.role
            else "Former User"
        )
        context = contexts.get((audit.table_name, audit.record_id))
        project_name = context.project_name if context else None
        subject = context.subject if context else None
        if needle:
            blob = " ".join(
                part
                for part in (
                    user_name,
                    user_email,
                    audit.action,
                    audit.table_name,
                    cat_label,
                    tab_label,
                    audit.details or "",
                    project_name or "",
                    subject or "",
                )
                if part
            ).lower()
            if needle not in blob:
                continue
        result.append(
            AuditHistoryItem(
                id=audit.id,
                user_id=user_obj.id if user_obj else 0,
                user_name=user_name,
                user_email=user_email,
                user_role=user_role_str,
                user_initials=_initials(user_name, user_email),
                action=audit.action,
                table_name=audit.table_name,
                category_label=cat_label,
                tab_label=tab_label,
                record_id=audit.record_id,
                project_name=project_name,
                subject=subject,
                details=audit.details,
                timestamp=audit.timestamp.isoformat(),
            )
        )
        if len(result) >= limit:
            break
    return result


class AuditEventPayload(BaseModel):
    action: str = Field(min_length=1, max_length=50)
    table_name: str = Field(min_length=1, max_length=100)
    record_id: int = 1
    details: str | None = None


ALLOWED_CLIENT_EVENTS = {("export", "bills")}


@router.post("/event", status_code=status.HTTP_204_NO_CONTENT)
async def record_audit_event(
    payload: AuditEventPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    action = payload.action.strip().lower()
    table_name = payload.table_name.strip()
    if (action, table_name) not in ALLOWED_CLIENT_EVENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This activity cannot be recorded.")
    record_id = payload.record_id if payload.record_id and payload.record_id > 0 else 1
    log_action(db, user, action, table_name, record_id, details=payload.details)
    return None

