from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_db, require_roles
from src.core.exceptions.exceptions import auth, other, recorded
from src.core.permissions import PROJECT_ROLES, PROJECT_WRITE_ROLES, is_project_operator
from src.core.services.audit_service import log_action
from src.data.models.postgres.labour_incharge_limit import LabourInchargeLimit
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.data.models.postgres.vendor_master import VendorMaster
from src.schemas.labour_incharge_limit import LabourInchargeLimitResponse, LabourInchargeLimitUpsert
from src.utils.crud import get_or_404

router = APIRouter()


def _allowed(project: Project, user: User) -> bool:
    return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)


def _ensure_project_access(db: Session, project_id: int, user: User) -> Project:
    project = get_or_404(db, Project, project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    return project


def _ensure_incharge(db: Session, vendor_id: int) -> VendorMaster:
    vendor = get_or_404(db, VendorMaster, vendor_id)
    if vendor.party_type != "labour_incharge":
        raise other.app_error("Payment limits can only be set for labour incharges.")
    return vendor


@router.get("/{project_id}/labour-incharge-limits", response_model=list[LabourInchargeLimitResponse])
def list_labour_incharge_limits(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    _ensure_project_access(db, project_id, user)
    return (
        db.query(LabourInchargeLimit)
        .filter(LabourInchargeLimit.project_id == project_id)
        .order_by(LabourInchargeLimit.id.asc())
        .all()
    )


@router.put("/{project_id}/labour-incharge-limits/{vendor_id}", response_model=LabourInchargeLimitResponse)
def upsert_labour_incharge_limit(
    project_id: int,
    vendor_id: int,
    payload: LabourInchargeLimitUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    project = _ensure_project_access(db, project_id, user)
    incharge = _ensure_incharge(db, vendor_id)
    amount = round(float(payload.limit_amount), 2)
    row = (
        db.query(LabourInchargeLimit)
        .filter(LabourInchargeLimit.project_id == project_id, LabourInchargeLimit.vendor_id == vendor_id)
        .first()
    )
    now = datetime.now(timezone.utc)
    if row:
        row.limit_amount = amount
        row.updated_at = now
        action = "update"
    else:
        row = LabourInchargeLimit(project_id=project_id, vendor_id=vendor_id, limit_amount=amount, updated_at=now)
        db.add(row)
        action = "create"
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user,
        action,
        "labour_incharge_limits",
        row.id,
        details=f"{'Set' if action == 'create' else 'Updated'} spending limit for {incharge.name} on {project.project_name} · ₹{amount:,.2f}",
    )
    return row


@router.delete("/{project_id}/labour-incharge-limits/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_labour_incharge_limit(
    project_id: int,
    vendor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    project = _ensure_project_access(db, project_id, user)
    row = (
        db.query(LabourInchargeLimit)
        .filter(LabourInchargeLimit.project_id == project_id, LabourInchargeLimit.vendor_id == vendor_id)
        .first()
    )
    if not row:
        raise recorded.record_not_found("LabourInchargeLimit")
    incharge = db.get(VendorMaster, vendor_id)
    incharge_name = incharge.name if incharge else f"#{vendor_id}"
    limit_id = row.id
    db.delete(row)
    db.commit()
    log_action(
        db,
        user,
        "delete",
        "labour_incharge_limits",
        limit_id,
        details=f"Removed spending limit for {incharge_name} on {project.project_name}",
    )
    return None
