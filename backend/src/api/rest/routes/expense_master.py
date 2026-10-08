from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import require_roles
from src.data.clients.session import get_db
from src.data.models.postgres.expense_master import ExpenseMaster
from src.data.models.postgres.user import User
from src.core.permissions import MASTER_WRITE_ROLES
from src.core.services.audit_service import log_action
from src.schemas.expense_master import ExpenseMasterBase, ExpenseMasterResponse
from src.utils.crud import get_or_404

router = APIRouter()


@router.get('/', response_model=list[ExpenseMasterResponse])
async def list_expense_master(db: Session = Depends(get_db), _: User = Depends(require_roles(*MASTER_WRITE_ROLES))):
    return db.query(ExpenseMaster).filter(ExpenseMaster.active == True).order_by(ExpenseMaster.name.asc()).all()


@router.post('/', response_model=ExpenseMasterResponse, status_code=status.HTTP_201_CREATED)
async def create_expense_master(
    payload: ExpenseMasterBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = ExpenseMaster(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    log_action(db, user, 'create', 'expense_master', item.id)
    return item


@router.put('/{item_id}', response_model=ExpenseMasterResponse)
async def update_expense_master(
    item_id: int,
    payload: ExpenseMasterBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = get_or_404(db, ExpenseMaster, item_id)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    log_action(db, user, 'update', 'expense_master', item.id)
    return item


@router.delete('/{item_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense_master(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = get_or_404(db, ExpenseMaster, item_id)
    item.active = False
    db.add(item)
    db.commit()
    log_action(db, user, 'delete', 'expense_master', item.id)
