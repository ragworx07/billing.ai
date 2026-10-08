from datetime import date, datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.data.clients.session import get_db
from src.data.models.postgres.enums import PaymentStatus
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.user import User
from src.core.permissions import FINANCE_ROLES
from src.schemas.payment import PaymentLogBase, PaymentLogResponse
from src.core.services.audit_service import log_action
from src.utils.crud import get_or_404

router = APIRouter()


def _normalize_payment_status(payment: PaymentLog) -> None:
    if payment.received_date:
        payment.status = PaymentStatus.RECEIVED
    elif payment.due_date and payment.due_date < date.today():
        payment.status = PaymentStatus.OVERDUE
    else:
        payment.status = PaymentStatus.PENDING


@router.get("/", response_model=list[PaymentLogResponse])
async def list_payments(project_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(PaymentLog).filter(PaymentLog.deleted_at == None)
    if project_id:
        query = query.filter(PaymentLog.project_id == project_id)
    payments = query.order_by(PaymentLog.due_date.desc()).all()
    for payment in payments:
        _normalize_payment_status(payment)
    return payments


@router.post("/", response_model=PaymentLogResponse, status_code=status.HTTP_201_CREATED)
async def create_payment(payload: PaymentLogBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*FINANCE_ROLES))):
    payment = PaymentLog(**payload.model_dump())
    _normalize_payment_status(payment)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    log_action(db, user, "create", "payment_logs", payment.id)
    return payment


@router.put("/{payment_id}", response_model=PaymentLogResponse)
async def update_payment(payment_id: int, payload: PaymentLogBase, db: Session = Depends(get_db), user: User = Depends(require_roles(*FINANCE_ROLES))):
    payment = get_or_404(db, PaymentLog, payment_id)
    for key, value in payload.model_dump().items():
        setattr(payment, key, value)
    _normalize_payment_status(payment)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    log_action(db, user, "update", "payment_logs", payment.id)
    return payment


@router.delete("/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment(payment_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*FINANCE_ROLES))):
    payment = get_or_404(db, PaymentLog, payment_id)
    payment.deleted_at = datetime.utcnow()
    db.add(payment)
    db.commit()
    log_action(db, user, "delete", "payment_logs", payment_id)
