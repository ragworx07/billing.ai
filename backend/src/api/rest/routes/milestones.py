from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.services.audit_service import log_action
from src.data.clients.session import get_db
from src.data.models.postgres.enums import ProjectStatus
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_milestone import ProjectMilestone
from src.data.models.postgres.user import User
from src.core.permissions import PROJECT_ROLES
from src.schemas.milestone import MilestoneCreate, MilestoneExtend, MilestoneResponse, MilestoneUpdate
from src.utils.crud import get_or_404

router = APIRouter()


def _to_response(row: ProjectMilestone) -> MilestoneResponse:
    project = row.project
    return MilestoneResponse(
        id=row.id,
        project_id=row.project_id,
        project_name=project.project_name if project else None,
        project_status=project.status.value if project and hasattr(project.status, "value") else str(project.status) if project else None,
        project_location=project.location if project else None,
        title=row.title,
        milestone_date=row.milestone_date,
        details=row.details,
        status=row.status,
        completed_at=row.completed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _validate_project(db: Session, project_id: int) -> Project:
    project = get_or_404(db, Project, project_id)
    if project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.status not in (ProjectStatus.ONGOING, ProjectStatus.UPCOMING):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Milestones are only for ongoing or upcoming projects")
    return project


@router.get("/", response_model=list[MilestoneResponse])
async def list_milestones(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = (
        db.query(ProjectMilestone)
        .join(Project, Project.id == ProjectMilestone.project_id)
        .filter(ProjectMilestone.deleted_at == None, Project.deleted_at == None)
        .order_by(ProjectMilestone.milestone_date.asc(), ProjectMilestone.id.asc())
        .all()
    )
    return [_to_response(row) for row in rows]


@router.post("/", response_model=MilestoneResponse, status_code=status.HTTP_201_CREATED)
async def create_milestone(
    payload: MilestoneCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    project = _validate_project(db, payload.project_id)
    row = ProjectMilestone(project_id=project.id, title=payload.title.strip(), milestone_date=payload.milestone_date, details=payload.details)
    db.add(row)
    db.flush()
    db.commit()
    db.refresh(row)
    log_action(db, user, "create", "project_milestones", row.id)
    return _to_response(row)


@router.put("/{milestone_id}", response_model=MilestoneResponse)
async def update_milestone(
    milestone_id: int,
    payload: MilestoneUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    row = get_or_404(db, ProjectMilestone, milestone_id)
    if row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    data = payload.model_dump(exclude_unset=True)
    if "project_id" in data and data["project_id"] is not None:
        project = _validate_project(db, data["project_id"])
        row.project_id = project.id
    if "title" in data and data["title"] is not None:
        row.title = data["title"].strip()
    if "milestone_date" in data and data["milestone_date"] is not None:
        row.milestone_date = data["milestone_date"]
    if "details" in data:
        row.details = data["details"]
    if "status" in data and data["status"] is not None:
        if data["status"] not in ("pending", "completed"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid milestone status")
        row.status = data["status"]
        row.completed_at = datetime.now(timezone.utc) if row.status == "completed" else None
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(db, user, "update", "project_milestones", row.id)
    return _to_response(row)


@router.patch("/{milestone_id}/extend", response_model=MilestoneResponse)
async def extend_milestone(
    milestone_id: int,
    payload: MilestoneExtend,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    row = get_or_404(db, ProjectMilestone, milestone_id)
    if row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    row.milestone_date = payload.milestone_date
    if payload.details is not None:
        row.details = payload.details
    row.status = "pending"
    row.completed_at = None
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(db, user, "extend", "project_milestones", row.id)
    return _to_response(row)


@router.patch("/{milestone_id}/complete", response_model=MilestoneResponse)
async def complete_milestone(
    milestone_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    row = get_or_404(db, ProjectMilestone, milestone_id)
    if row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    row.status = "completed"
    row.completed_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(db, user, "complete", "project_milestones", row.id)
    return _to_response(row)


@router.delete("/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_milestone(
    milestone_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    row = get_or_404(db, ProjectMilestone, milestone_id)
    if row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    row.deleted_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    log_action(db, user, "delete", "project_milestones", row.id)
