from datetime import datetime
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.exceptions.exceptions import auth
from src.data.clients.session import get_db
from src.data.models.postgres.enums import ProjectStatus
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.data.models.postgres.worker import Worker
from src.schemas.labor import LaborLogBase, LaborLogResponse
from src.utils.crud import get_or_404
from src.core.permissions import PROJECT_WRITE_ROLES, is_project_operator
from src.core.services.audit_service import log_action

router = APIRouter()


def _allowed(project: Project, user: User) -> bool:
    return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)


def _normalize_labour_type(value: str) -> str:
    return " ".join(value.strip().split())


def _upsert_worker_from_labor(db: Session, labour_type: str, wage_per_head: float) -> None:
    """Keep Labour Master in sync from project labour entries.

    We match an existing master entry by role first, then by name (case-insensitive).
    Latest entered wage becomes the current default wage in master.
    """
    normalized = _normalize_labour_type(labour_type)
    if not normalized:
        return

    lowered = normalized.lower()
    master = db.query(Worker).all()
    row = next((item for item in master if (item.role or "").strip().lower() == lowered), None)
    if not row:
        row = next((item for item in master if (item.name or "").strip().lower() == lowered), None)

    if row:
        existing_options = list(row.wage_options or [])
        existing_options.append(float(wage_per_head or 0))
        unique_sorted = sorted({round(float(v), 2) for v in existing_options if float(v) >= 0})
        row.role = normalized
        row.name = normalized
        row.wage_options = unique_sorted
        row.daily_wage = max(unique_sorted) if unique_sorted else float(wage_per_head or 0)
        row.active = True
        db.add(row)
        return

    seed_wage = round(float(wage_per_head or 0), 2)
    db.add(
        Worker(
            name=normalized,
            role=normalized,
            daily_wage=seed_wage,
            wage_options=[seed_wage],
            active=True,
        )
    )


@router.get("/", response_model=list[LaborLogResponse])
async def list_labor_logs(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(LaborLog).filter(LaborLog.deleted_at == None).order_by(LaborLog.date.asc())
    if project_id:
        query = query.filter(LaborLog.project_id == project_id)
    return query.all()


@router.post("/", response_model=LaborLogResponse, status_code=status.HTTP_201_CREATED)
async def create_labor_log(
    payload: LaborLogBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    data = payload.model_dump()
    data["labour_type"] = _normalize_labour_type(data.get("labour_type", ""))
    if data.get("total_wage") is None:
        count = data.get("labour_count", 0)
        data["total_wage"] = count * data.get("wage_per_head", 0) + data.get("overtime_cost", 0)
    row = LaborLog(**data)
    db.add(row)
    _upsert_worker_from_labor(db, row.labour_type, float(row.wage_per_head or 0))
    if project.status == ProjectStatus.UPCOMING:
        project.status = ProjectStatus.ONGOING
        db.add(project)
    db.commit()
    db.refresh(row)
    log_action(db, user, "create", "labor_logs", row.id)
    return row


@router.put("/{labor_log_id}", response_model=LaborLogResponse)
async def update_labor_log(
    labor_log_id: int,
    payload: LaborLogBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    row = get_or_404(db, LaborLog, labor_log_id)
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    data = payload.model_dump()
    data["labour_type"] = _normalize_labour_type(data.get("labour_type", ""))
    if data.get("total_wage") is None:
        count = data.get("labour_count", 0)
        data["total_wage"] = count * data.get("wage_per_head", 0) + data.get("overtime_cost", 0)
    for key, value in data.items():
        setattr(row, key, value)
    db.add(row)
    _upsert_worker_from_labor(db, row.labour_type, float(row.wage_per_head or 0))
    db.commit()
    db.refresh(row)
    log_action(db, user, "update", "labor_logs", row.id)
    return row


@router.delete("/{labor_log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_labor_log(
    labor_log_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    row = get_or_404(db, LaborLog, labor_log_id)
    project = get_or_404(db, Project, row.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    row.deleted_at = datetime.utcnow()
    db.add(row)
    db.commit()
    log_action(db, user, "delete", "labor_logs", labor_log_id)
