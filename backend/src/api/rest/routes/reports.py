from datetime import datetime
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.exceptions.exceptions import auth
from src.data.clients.session import get_db
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.data.models.postgres.work_report import WorkReport
from src.schemas.report import WorkReportBase, WorkReportResponse
from src.core.services.audit_service import log_action
from src.utils.crud import get_or_404
from src.core.permissions import PROJECT_WRITE_ROLES
from src.core.permissions import is_project_operator

router = APIRouter()


def _allowed(project: Project, user: User) -> bool:
    return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)


@router.get("/", response_model=list[WorkReportResponse])
async def list_reports(project_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(WorkReport).filter(WorkReport.deleted_at == None)
    if project_id:
        query = query.filter(WorkReport.project_id == project_id)
    return query.order_by(WorkReport.report_date.desc()).all()


@router.post("/", response_model=WorkReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(payload: WorkReportBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*PROJECT_WRITE_ROLES))):
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    report = WorkReport(**payload.model_dump())
    db.add(report)
    db.commit()
    db.refresh(report)
    log_action(db, user, "create", "work_reports", report.id)
    return report


@router.put("/{report_id}", response_model=WorkReportResponse)
async def update_report(
    report_id: int,
    payload: WorkReportBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_WRITE_ROLES)),
):
    report = get_or_404(db, WorkReport, report_id)
    project = get_or_404(db, Project, payload.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    for key, value in payload.model_dump().items():
        setattr(report, key, value)
    db.add(report)
    db.commit()
    db.refresh(report)
    log_action(db, user, "update", "work_reports", report.id)
    return report


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(report_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*PROJECT_WRITE_ROLES))):
    report = get_or_404(db, WorkReport, report_id)
    project = get_or_404(db, Project, report.project_id)
    if not _allowed(project, user):
        raise auth.unauthorized_project_access()
    report.deleted_at = datetime.utcnow()
    db.add(report)
    db.commit()
    log_action(db, user, "delete", "work_reports", report_id)
