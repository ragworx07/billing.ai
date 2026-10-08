from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.data.clients.session import get_db
from src.data.models.postgres.attendance_log import AttendanceLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.data.models.postgres.worker import Worker
from src.core.permissions import MASTER_WRITE_ROLES
from src.schemas.attendance import WorkerAttendanceCalendarItem
from src.schemas.worker import WorkerBase, WorkerResponse
from src.core.services.audit_service import log_action
from src.utils.crud import get_or_404

router = APIRouter()


def _normalize_wage_options(value: list[float] | str | None) -> list[float]:
    if isinstance(value, list):
        return [float(item) for item in value if item is not None]
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [float(item) for item in parsed if item is not None]
        except Exception:
            stripped = value.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                inner = stripped[1:-1].strip()
                if not inner:
                    return []
                try:
                    return [float(item.strip()) for item in inner.split(",") if item.strip()]
                except Exception:
                    return []
    return []


def _normalize_wages(daily_wage: float, wage_options: list[float] | None) -> tuple[float, list[float]]:
    values = [float(daily_wage or 0)]
    for wage in wage_options or []:
        try:
            parsed = float(wage)
        except (TypeError, ValueError):
            continue
        if parsed >= 0:
            values.append(parsed)
    unique = sorted(set(round(value, 2) for value in values if value >= 0))
    highest = unique[-1] if unique else 0.0
    return highest, unique


@router.get("/", response_model=list[WorkerResponse])
async def list_workers(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    workers = db.query(Worker).filter(Worker.active == True).order_by(Worker.name.asc()).all()
    for worker in workers:
        worker.wage_options = _normalize_wage_options(worker.wage_options)
    return workers


@router.get("/{worker_id}/attendance-calendar", response_model=list[WorkerAttendanceCalendarItem])
async def worker_attendance_calendar(worker_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    get_or_404(db, Worker, worker_id)
    rows = (
        db.query(AttendanceLog, Project.project_name)
        .join(Project, Project.id == AttendanceLog.project_id)
        .filter(AttendanceLog.worker_id == worker_id, AttendanceLog.deleted_at.is_(None))
        .order_by(AttendanceLog.date.desc())
        .all()
    )
    return [
        WorkerAttendanceCalendarItem(
            id=entry.id,
            date=entry.date,
            project_id=entry.project_id,
            project_name=project_name,
            status=entry.status,
            work_done=entry.work_done,
            overtime_hours=float(entry.overtime_hours),
        )
        for entry, project_name in rows
    ]


@router.post("/", response_model=WorkerResponse, status_code=status.HTTP_201_CREATED)
async def create_worker(payload: WorkerBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*MASTER_WRITE_ROLES))):
    data = payload.model_dump()
    highest, options = _normalize_wages(data.get("daily_wage", 0), data.get("wage_options"))
    data["daily_wage"] = highest
    data["wage_options"] = options
    worker = Worker(**data)
    db.add(worker)
    db.commit()
    db.refresh(worker)
    worker.wage_options = _normalize_wage_options(worker.wage_options)
    log_action(db, user, "create", "workers", worker.id)
    return worker


@router.put("/{worker_id}", response_model=WorkerResponse)
async def update_worker(worker_id: int, payload: WorkerBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*MASTER_WRITE_ROLES))):
    worker = get_or_404(db, Worker, worker_id)
    data = payload.model_dump()
    highest, options = _normalize_wages(data.get("daily_wage", 0), data.get("wage_options"))
    data["daily_wage"] = highest
    data["wage_options"] = options
    for key, value in data.items():
        setattr(worker, key, value)
    db.add(worker)
    db.commit()
    db.refresh(worker)
    worker.wage_options = _normalize_wage_options(worker.wage_options)
    log_action(db, user, "update", "workers", worker.id)
    return worker


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker(worker_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*MASTER_WRITE_ROLES))):
    worker = get_or_404(db, Worker, worker_id)
    worker.active = False
    db.add(worker)
    db.commit()
    log_action(db, user, "delete", "workers", worker_id)
