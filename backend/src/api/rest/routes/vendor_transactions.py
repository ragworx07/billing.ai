from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_db, get_current_user
from src.data.models.postgres.vendor_transaction import VendorTransaction
from src.data.models.postgres.vendor_master import VendorMaster
from src.data.models.postgres.user import User
from src.core.services.audit_service import log_action
from src.schemas.vendor_transaction import VendorTransactionCreate, VendorTransactionResponse, VendorTransactionUpdate

router = APIRouter()


def _transaction_details(db: Session, transaction: VendorTransaction, verb: str) -> str:
    vendor = db.get(VendorMaster, transaction.vendor_id)
    party = "labour incharge" if vendor and vendor.party_type == "labour_incharge" else "vendor"
    name = vendor.name if vendor else f"#{transaction.vendor_id}"
    return f"{verb} {party} payment for {name} · ₹{float(transaction.amount or 0):,.2f}"


@router.post('/', response_model=VendorTransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(payload: VendorTransactionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = payload.model_dump()
    data["amount"] = round(float(data.get("amount") or 0), 2)
    data["round_off"] = round(float(data.get("round_off") or 0), 2)
    transaction = VendorTransaction(**data)
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    log_action(db, user, "create", "vendor_transactions", transaction.id, details=_transaction_details(db, transaction, "Recorded"))
    return transaction


@router.get('/project/{project_id}', response_model=List[VendorTransactionResponse])
def get_project_transactions(project_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return db.query(VendorTransaction).filter(VendorTransaction.project_id == project_id, VendorTransaction.deleted_at == None).all()


@router.put('/{transaction_id}', response_model=VendorTransactionResponse)
def update_transaction(transaction_id: int, payload: VendorTransactionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    transaction = db.query(VendorTransaction).filter(VendorTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail='Transaction not found')

    update_data = payload.model_dump(exclude_unset=True)
    if "amount" in update_data and update_data["amount"] is not None:
        update_data["amount"] = round(float(update_data["amount"]), 2)
    if "round_off" in update_data and update_data["round_off"] is not None:
        update_data["round_off"] = round(float(update_data["round_off"]), 2)
    for key, value in update_data.items():
        setattr(transaction, key, value)

    db.commit()
    db.refresh(transaction)
    log_action(db, user, "update", "vendor_transactions", transaction.id, details=_transaction_details(db, transaction, "Updated"))
    return transaction


@router.delete('/{transaction_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    transaction = db.query(VendorTransaction).filter(VendorTransaction.id == transaction_id, VendorTransaction.deleted_at == None).first()
    if not transaction:
        raise HTTPException(status_code=404, detail='Transaction not found')

    transaction.deleted_at = datetime.utcnow()
    db.add(transaction)
    db.commit()
    log_action(db, user, "delete", "vendor_transactions", transaction_id, details=_transaction_details(db, transaction, "Deleted"))
