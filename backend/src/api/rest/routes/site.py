from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_db, require_roles
from src.core.permissions import ASSIGNED_ROLES, CLIENT_ROLES
from src.core.services.audit_service import log_action
from src.data.models.postgres.project import Project
from src.data.models.postgres.site_expense import SiteExpense
from src.data.models.postgres.site_settlement import SiteSettlement
from src.data.models.postgres.user import User
from src.schemas.site import (
    SiteExpenseBase,
    SiteExpenseResponse,
    SiteSettlementBase,
    SiteSettlementResponse,
    SiteWeekCloseRequest,
    SiteWeekCloseResponse,
)

from src.utils.crud import get_or_404

router = APIRouter()


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _validate_allocation(db: Session, payload: SiteExpenseBase) -> None:
    if payload.allocation == "project" and payload.project_id:
        get_or_404(db, Project, payload.project_id)


@router.get("/", response_model=list[SiteExpenseResponse])
async def list_site_expenses(
    week_start: date | None = None,
    include_closed: bool = True,
    allocation: str | None = None,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    query = db.query(SiteExpense)
    if week_start:
        query = query.filter(SiteExpense.week_start == _week_start(week_start))
    if not include_closed:
        query = query.filter(SiteExpense.closed_at.is_(None))
    if allocation:
        query = query.filter(SiteExpense.allocation == allocation)
    if project_id:
        query = query.filter(SiteExpense.project_id == project_id)
    return query.order_by(SiteExpense.date.desc(), SiteExpense.id.desc()).all()


@router.get("", response_model=list[SiteExpenseResponse], include_in_schema=False)
async def list_site_expenses_without_slash(
    week_start: date | None = None,
    include_closed: bool = True,
    allocation: str | None = None,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return await list_site_expenses(week_start, include_closed, allocation, project_id, db, user)


@router.post("/", response_model=SiteExpenseResponse, status_code=status.HTTP_201_CREATED)
async def create_site_expense(
    payload: SiteExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    _validate_allocation(db, payload)
    expense = SiteExpense(
        **payload.model_dump(),
        amount=round(payload.rate * payload.quantity, 2),
        week_start=_week_start(payload.date),
        created_by_id=user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    log_action(db, user, "create", "site_expenses", expense.id)
    return expense


@router.post("", response_model=SiteExpenseResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_site_expense_without_slash(
    payload: SiteExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return await create_site_expense(payload, db, user)


@router.put("/{expense_id}", response_model=SiteExpenseResponse)
async def update_site_expense(
    expense_id: int,
    payload: SiteExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    expense = db.get(SiteExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Site expense not found")
    if expense.closed_at:
        raise HTTPException(status_code=409, detail="Closed site expenses cannot be edited")
    _validate_allocation(db, payload)
    for key, value in payload.model_dump().items():
        setattr(expense, key, value)
    expense.amount = round(payload.rate * payload.quantity, 2)
    expense.week_start = _week_start(payload.date)
    db.commit()
    db.refresh(expense)
    log_action(db, user, "update", "site_expenses", expense.id)
    return expense


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    expense = db.get(SiteExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Site expense not found")
    db.delete(expense)
    db.commit()
    log_action(db, user, "delete", "site_expenses", expense_id)


@router.post("/close-week", response_model=SiteWeekCloseResponse)
async def close_site_week(
    payload: SiteWeekCloseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    normalized_week = _week_start(payload.week_start)
    rows = db.query(SiteExpense).filter(
        SiteExpense.week_start == normalized_week,
        SiteExpense.closed_at.is_(None),
    ).all()
    closed_at = datetime.now(timezone.utc)
    for row in rows:
        row.closed_at = closed_at
        db.add(row)
    db.commit()
    for row in rows:
        log_action(db, user, "close", "site_expenses", row.id)
    return SiteWeekCloseResponse(
        week_start=normalized_week,
        closed_count=len(rows),
        total_amount=float(sum(row.amount or 0 for row in rows)),
        closed_at=closed_at,
    )


@router.get("/settlements", response_model=list[SiteSettlementResponse])
async def list_site_settlements(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return db.query(SiteSettlement).order_by(SiteSettlement.date.desc(), SiteSettlement.id.desc()).all()


@router.post("/settlements", response_model=SiteSettlementResponse, status_code=status.HTTP_201_CREATED)
async def create_site_settlement(
    payload: SiteSettlementBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    settlement = SiteSettlement(
        **payload.model_dump(),
        created_by_id=user.id,
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    log_action(db, user, "create", "site_settlements", settlement.id)
    return settlement


@router.delete("/settlements/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    settlement = db.get(SiteSettlement, settlement_id)
    if not settlement:
        raise HTTPException(status_code=404, detail="Site settlement not found")
    db.delete(settlement)
    db.commit()
    log_action(db, user, "delete", "site_settlements", settlement_id)
