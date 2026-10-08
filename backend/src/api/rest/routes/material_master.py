from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import require_roles
from src.data.clients.session import get_db
from src.data.models.postgres.material_master import MaterialMaster
from src.data.models.postgres.user import User
from src.core.permissions import MASTER_WRITE_ROLES
from src.core.services.audit_service import log_action
from src.schemas.material_master import MaterialMasterBase, MaterialMasterResponse
from src.utils.crud import get_or_404

router = APIRouter()


@router.get('/', response_model=list[MaterialMasterResponse])
async def list_material_master(db: Session = Depends(get_db), _: User = Depends(require_roles(*MASTER_WRITE_ROLES))):
    return db.query(MaterialMaster).filter(MaterialMaster.active == True).order_by(MaterialMaster.name.asc()).all()


@router.post('/', response_model=MaterialMasterResponse, status_code=status.HTTP_201_CREATED)
async def create_material_master(
    payload: MaterialMasterBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = MaterialMaster(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    log_action(db, user, 'create', 'material_master', item.id)
    return item


@router.put('/{item_id}', response_model=MaterialMasterResponse)
async def update_material_master(
    item_id: int,
    payload: MaterialMasterBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = get_or_404(db, MaterialMaster, item_id)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    log_action(db, user, 'update', 'material_master', item.id)
    return item


@router.delete('/{item_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_material_master(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*MASTER_WRITE_ROLES)),
):
    item = get_or_404(db, MaterialMaster, item_id)
    item.active = False
    db.add(item)
    db.commit()
    log_action(db, user, 'delete', 'material_master', item.id)
