from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_db, get_current_user
from src.core.services.audit_service import log_action
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.vendor_master import VendorMaster
from src.data.models.postgres.vendor_transaction import VendorTransaction
from src.data.models.postgres.user import User
from src.schemas.vendor import (
    VendorMasterCreate,
    VendorMasterResponse,
    VendorMasterUpdate,
    VendorPaymentHistoryItem,
    VendorRecordBookItem,
)

router = APIRouter()

VALID_PARTY_TYPES = {"material_vendor", "labour_incharge"}


def _normalize_party_type(value: str | None) -> str:
    normalized = (value or "material_vendor").strip().lower()
    if normalized not in VALID_PARTY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid party type")
    return normalized


def _normalize_work_field(value: str | None) -> str | None:
    normalized = " ".join((value or "").strip().split())
    return normalized or None


def _iso_date(value) -> str:
    text = value.isoformat() if hasattr(value, "isoformat") else str(value)
    return text[:10]


def _material_amount(log: MaterialLog) -> float:
    return (
        float(log.quantity or 0)
        * float(log.unit_cost or 0)
        * (1 + float(log.gst_percent or 0) / 100)
        + float(log.transport_cost or 0)
    )


def _labor_amount(log: LaborLog) -> float:
    if log.total_wage is not None:
        return float(log.total_wage)
    return float(log.labour_count or 0) * float(log.wage_per_head or 0) + float(log.overtime_cost or 0)


def _payment_amount(transaction: VendorTransaction) -> float:
    return float(transaction.amount or 0) + float(transaction.round_off or 0)


def _apply_common_filters(
    query,
    *,
    vendor_column,
    project_column,
    date_column,
    vendor_id: int | None,
    party_type: str | None,
    project_id: int | None,
    date_from: date | None,
    date_to: date | None,
):
    query = query.filter(Project.deleted_at == None)
    if vendor_id:
        query = query.filter(vendor_column == vendor_id)
    if party_type:
        query = query.filter(VendorMaster.party_type == party_type)
    if project_id:
        query = query.filter(project_column == project_id)
    if date_from:
        query = query.filter(date_column >= date_from)
    if date_to:
        query = query.filter(date_column <= date_to)
    return query


def _collect_vendor_entries(
    db: Session,
    *,
    vendor_id: int | None = None,
    party_type: str | None = None,
    project_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[VendorRecordBookItem]:
    entries: list[VendorRecordBookItem] = []

    material_query = (
        db.query(MaterialLog, Project, VendorMaster)
        .join(Project, Project.id == MaterialLog.project_id)
        .join(VendorMaster, VendorMaster.id == MaterialLog.vendor_id)
        .filter(MaterialLog.deleted_at == None, MaterialLog.vendor_id != None)
    )
    material_query = _apply_common_filters(
        material_query,
        vendor_column=MaterialLog.vendor_id,
        project_column=MaterialLog.project_id,
        date_column=MaterialLog.date,
        vendor_id=vendor_id,
        party_type=party_type,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    entries.extend(
        VendorRecordBookItem(
            id=log.id,
            source="Material Cost",
            vendor_id=vendor.id,
            vendor_name=vendor.name,
            party_type=vendor.party_type or "material_vendor",
            project_id=project.id,
            project_name=project.project_name,
            payment_date=_iso_date(log.date),
            work_detail=log.material_name,
            quantity=float(log.quantity or 0),
            rate=float(log.unit_cost or 0),
            amount=_material_amount(log),
            payment_mode=None,
            notes=log.work_remarks or log.supplier,
        )
        for log, project, vendor in material_query.all()
    )

    labour_query = (
        db.query(LaborLog, Project, VendorMaster)
        .join(Project, Project.id == LaborLog.project_id)
        .join(VendorMaster, VendorMaster.id == LaborLog.vendor_id)
        .filter(LaborLog.deleted_at == None, LaborLog.vendor_id != None)
    )
    labour_query = _apply_common_filters(
        labour_query,
        vendor_column=LaborLog.vendor_id,
        project_column=LaborLog.project_id,
        date_column=LaborLog.date,
        vendor_id=vendor_id,
        party_type=party_type,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    entries.extend(
        VendorRecordBookItem(
            id=log.id,
            source="Labour Cost",
            vendor_id=vendor.id,
            vendor_name=vendor.name,
            party_type=vendor.party_type or "labour_incharge",
            project_id=project.id,
            project_name=project.project_name,
            payment_date=_iso_date(log.date),
            work_detail=log.labour_type,
            quantity=float(log.labour_count or 0),
            rate=float(log.wage_per_head or 0),
            amount=_labor_amount(log),
            payment_mode=None,
            notes=log.remarks,
        )
        for log, project, vendor in labour_query.all()
    )

    payment_query = (
        db.query(VendorTransaction, Project, VendorMaster)
        .join(Project, Project.id == VendorTransaction.project_id)
        .join(VendorMaster, VendorMaster.id == VendorTransaction.vendor_id)
        .filter(VendorTransaction.deleted_at == None)
    )
    payment_query = _apply_common_filters(
        payment_query,
        vendor_column=VendorTransaction.vendor_id,
        project_column=VendorTransaction.project_id,
        date_column=VendorTransaction.payment_date,
        vendor_id=vendor_id,
        party_type=party_type,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    entries.extend(
        VendorRecordBookItem(
            id=transaction.id,
            source="Payment",
            vendor_id=vendor.id,
            vendor_name=vendor.name,
            party_type=vendor.party_type or "material_vendor",
            project_id=project.id,
            project_name=project.project_name,
            payment_date=_iso_date(transaction.payment_date),
            work_detail=vendor.work_field or "Payment",
            quantity=None,
            rate=None,
            amount=_payment_amount(transaction),
            payment_mode=transaction.payment_mode,
            notes=transaction.notes,
        )
        for transaction, project, vendor in payment_query.all()
    )

    return entries


@router.post('/', response_model=VendorMasterResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(payload: VendorMasterCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = payload.model_dump()
    data["party_type"] = _normalize_party_type(data.get("party_type"))
    data["work_field"] = _normalize_work_field(data.get("work_field"))
    vendor = VendorMaster(**data)
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    log_action(
        db,
        user,
        'create',
        'vendor_master',
        vendor.id,
        details=f"Added {'labour incharge' if vendor.party_type == 'labour_incharge' else 'vendor'} {vendor.name}",
    )
    return vendor


@router.get('/', response_model=List[VendorMasterResponse])
def get_vendors(
    party_type: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = db.query(VendorMaster).filter(VendorMaster.active == True)
    if party_type:
        query = query.filter(VendorMaster.party_type == _normalize_party_type(party_type))
    return query.order_by(VendorMaster.name.asc()).all()


@router.get('/work-fields', response_model=List[str])
def get_work_fields(
    party_type: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = db.query(VendorMaster.work_field).filter(
        VendorMaster.active == True,
        VendorMaster.work_field != None,
        VendorMaster.work_field != "",
    )
    if party_type:
        query = query.filter(VendorMaster.party_type == _normalize_party_type(party_type))
    values = [row[0] for row in query.distinct().order_by(VendorMaster.work_field.asc()).all()]
    return [value for value in values if value]


@router.get('/record-book', response_model=List[VendorRecordBookItem])
def get_vendor_record_book(
    party_type: str | None = None,
    vendor_id: int | None = None,
    project_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    normalized_party = _normalize_party_type(party_type) if party_type else None
    entries = _collect_vendor_entries(
        db,
        vendor_id=vendor_id,
        party_type=normalized_party,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    return sorted(
        entries,
        key=lambda item: (item.payment_date, item.vendor_name.lower(), item.project_name.lower(), item.source, item.id),
    )


@router.get('/{vendor_id}/payment-history', response_model=List[VendorPaymentHistoryItem])
def get_vendor_payment_history(vendor_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    vendor = db.query(VendorMaster).filter(VendorMaster.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail='Vendor not found')

    history = _collect_vendor_entries(db, vendor_id=vendor_id)
    return sorted(history, key=lambda item: (item.project_name.lower(), item.payment_date, item.source, item.id))


@router.put('/{vendor_id}', response_model=VendorMasterResponse)
def update_vendor(vendor_id: int, payload: VendorMasterUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vendor = db.query(VendorMaster).filter(VendorMaster.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail='Vendor not found')

    update_data = payload.model_dump(exclude_unset=True)
    if "party_type" in update_data:
        update_data["party_type"] = _normalize_party_type(update_data.get("party_type"))
    if "work_field" in update_data:
        update_data["work_field"] = _normalize_work_field(update_data.get("work_field"))
    for key, value in update_data.items():
        setattr(vendor, key, value)

    db.commit()
    db.refresh(vendor)
    log_action(
        db,
        user,
        'update',
        'vendor_master',
        vendor.id,
        details=f"Updated {'labour incharge' if vendor.party_type == 'labour_incharge' else 'vendor'} {vendor.name}",
    )
    return vendor


@router.delete('/{vendor_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor(vendor_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vendor = db.query(VendorMaster).filter(VendorMaster.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail='Vendor not found')

    vendor.active = False
    db.add(vendor)
    db.commit()
    log_action(
        db,
        user,
        'delete',
        'vendor_master',
        vendor.id,
        details=f"Removed {'labour incharge' if vendor.party_type == 'labour_incharge' else 'vendor'} {vendor.name}",
    )
