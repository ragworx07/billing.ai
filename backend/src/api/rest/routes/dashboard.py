from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api.rest.dependencies import require_roles
from src.data.clients.session import get_db
from src.core.permissions import ADMIN_ROLES
from src.data.models.postgres.user import User
from src.schemas.dashboard import DashboardResponse, DashboardCalendarResponse
from src.core.services.dashboard_service import build_dashboard, build_dashboard_calendar

router = APIRouter()


@router.get("/", response_model=DashboardResponse)
async def get_dashboard(db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN_ROLES))):
    return build_dashboard(db)


@router.get("/calendar", response_model=DashboardCalendarResponse)
async def get_dashboard_calendar(
    month: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ADMIN_ROLES))
):
    return build_dashboard_calendar(db, month)

