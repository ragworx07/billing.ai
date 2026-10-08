from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_db, require_roles
from src.core.permissions import ASSIGNED_ROLES, CLIENT_ROLES
from src.data.models.postgres.office_expense import OfficeExpense
from src.data.models.postgres.office_settlement import OfficeSettlement
from src.data.models.postgres.user import User
from src.core.services.audit_service import log_action
from src.schemas.office import (
    OfficeExpenseBase,
    OfficeExpenseResponse,
    OfficeSettlementBase,
    OfficeSettlementResponse,
    OfficeWeekCloseRequest,
    OfficeWeekCloseResponse,
)

router = APIRouter()


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


@router.get("/", response_model=list[OfficeExpenseResponse])
async def list_office_expenses(
    week_start: date | None = None,
    include_closed: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    query = db.query(OfficeExpense)
    if week_start:
        query = query.filter(OfficeExpense.week_start == _week_start(week_start))
    if not include_closed:
        query = query.filter(OfficeExpense.closed_at.is_(None))
    return query.order_by(OfficeExpense.date.desc(), OfficeExpense.id.desc()).all()


@router.get("", response_model=list[OfficeExpenseResponse], include_in_schema=False)
async def list_office_expenses_without_slash(
    week_start: date | None = None,
    include_closed: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return await list_office_expenses(week_start, include_closed, db, user)


@router.post("/", response_model=OfficeExpenseResponse, status_code=status.HTTP_201_CREATED)
async def create_office_expense(
    payload: OfficeExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    expense = OfficeExpense(
        **payload.model_dump(),
        amount=round(payload.rate * payload.quantity, 2),
        week_start=_week_start(payload.date),
        created_by_id=user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    log_action(db, user, "create", "office_expenses", expense.id)
    return expense


@router.post("", response_model=OfficeExpenseResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_office_expense_without_slash(
    payload: OfficeExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return await create_office_expense(payload, db, user)


@router.put("/{expense_id}", response_model=OfficeExpenseResponse)
async def update_office_expense(
    expense_id: int,
    payload: OfficeExpenseBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    expense = db.get(OfficeExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Office expense not found")
    if expense.closed_at:
        raise HTTPException(status_code=409, detail="Closed office expenses cannot be edited")
    for key, value in payload.model_dump().items():
        setattr(expense, key, value)
    expense.amount = round(payload.rate * payload.quantity, 2)
    expense.week_start = _week_start(payload.date)
    db.commit()
    db.refresh(expense)
    log_action(db, user, "update", "office_expenses", expense.id)
    return expense


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_office_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    expense = db.get(OfficeExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Office expense not found")
    db.delete(expense)
    db.commit()
    log_action(db, user, "delete", "office_expenses", expense_id)


@router.post("/close-week", response_model=OfficeWeekCloseResponse)
async def close_office_week(
    payload: OfficeWeekCloseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    normalized_week = _week_start(payload.week_start)
    rows = db.query(OfficeExpense).filter(
        OfficeExpense.week_start == normalized_week,
        OfficeExpense.closed_at.is_(None),
    ).all()
    closed_at = datetime.now(timezone.utc)
    for row in rows:
        row.closed_at = closed_at
        db.add(row)
    db.commit()
    for row in rows:
        log_action(db, user, "close", "office_expenses", row.id)
    return OfficeWeekCloseResponse(
        week_start=normalized_week,
        closed_count=len(rows),
        total_amount=float(sum(row.amount or 0 for row in rows)),
        closed_at=closed_at,
    )


@router.get("/settlements", response_model=list[OfficeSettlementResponse])
async def list_office_settlements(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    return db.query(OfficeSettlement).order_by(OfficeSettlement.date.desc(), OfficeSettlement.id.desc()).all()


@router.post("/settlements", response_model=OfficeSettlementResponse, status_code=status.HTTP_201_CREATED)
async def create_office_settlement(
    payload: OfficeSettlementBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    settlement = OfficeSettlement(
        **payload.model_dump(),
        created_by_id=user.id,
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    log_action(db, user, "create", "office_settlements", settlement.id)
    return settlement


@router.delete("/settlements/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_office_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ASSIGNED_ROLES)),
):
    settlement = db.get(OfficeSettlement, settlement_id)
    if not settlement:
        raise HTTPException(status_code=404, detail="Office settlement not found")
    db.delete(settlement)
    db.commit()
    log_action(db, user, "delete", "office_settlements", settlement_id)

