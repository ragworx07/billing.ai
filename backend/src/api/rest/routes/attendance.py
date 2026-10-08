from datetime import datetime
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.exceptions.exceptions import auth, recorded
from src.data.clients.session import get_db
from src.data.models.postgres.attendance_log import AttendanceLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.schemas.attendance import AttendanceLogBase, AttendanceLogResponse
from src.core.services.audit_service import log_action
from src.utils.crud import get_or_404
from src.core.permissions import PROJECT_WRITE_ROLES
from src.core.permissions import is_project_operator

router = APIRouter()


def _allowed(project: Project, user: User) -> bool:
    return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)


@router.get("/", response_model=list[AttendanceLogResponse])
async def list_attendance(project_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(AttendanceLog).filter(AttendanceLog.deleted_at == None)
    if project_id:
        query = query.filter(AttendanceLog.project_id == project_id)
    return query.order_by(AttendanceLog.date.desc()).all()


@router.post("/", response_model=AttendanceLogResponse, status_code=status.HTTP_201_CREATED)
async def create_attendance(payload: AttendanceLogBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*PROJECT_WRITE_ROLES))):
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()

    existing_entry = (
        db.query(AttendanceLog)
        .filter(AttendanceLog.worker_id == payload.worker_id, AttendanceLog.project_id == payload.project_id, AttendanceLog.date == payload.date)
        .first()
    )
    if existing_entry:
        if existing_entry.deleted_at is None:
            raise recorded.attendance_already_exists()
        # Reactivate soft-deleted entry
        existing_entry.deleted_at = None
        existing_entry.status = payload.status
        existing_entry.work_done = payload.work_done
        existing_entry.overtime_hours = payload.overtime_hours
        db.add(existing_entry)
        db.commit()
        db.refresh(existing_entry)
        log_action(db, user, "create", "attendance_logs", existing_entry.id)
        return existing_entry

    entry = AttendanceLog(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    log_action(db, user, "create", "attendance_logs", entry.id)
    return entry


@router.put("/{attendance_id}", response_model=AttendanceLogResponse)
async def update_attendance(attendance_id: int, payload: AttendanceLogBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*PROJECT_WRITE_ROLES))):
    entry = get_or_404(db, AttendanceLog, attendance_id)
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    for key, value in payload.model_dump().items():
        setattr(entry, key, value)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    log_action(db, user, "update", "attendance_logs", entry.id)
    return entry


@router.delete("/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attendance(attendance_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PROJECT_WRITE_ROLES))):
    entry = get_or_404(db, AttendanceLog, attendance_id)
    project = get_or_404(db, Project, entry.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    entry.deleted_at = datetime.utcnow()
    db.add(entry)
    db.commit()
    log_action(db, user, "delete", "attendance_logs", attendance_id)
