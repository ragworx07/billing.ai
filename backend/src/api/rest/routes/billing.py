from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.permissions import CLIENT_ROLES
from src.core.services.audit_service import log_action
from src.data.clients.session import get_db
from src.data.models.postgres.bill import Bill, BillItem
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.user import User
from src.schemas.billing import (
    BillCreate,
    BillRecordPaymentRequest,
    BillResponse,
    BillUpdate,
    NextBillNumberResponse,
)
from src.schemas.jv_client import JVShareholderPaymentResponse
from src.utils.crud import get_or_404

router = APIRouter()


def _bill_number_exists(db: Session, bill_number: str, exclude_id: int | None = None) -> bool:
    query = db.query(Bill.id).filter(Bill.bill_number == bill_number)
    if exclude_id is not None:
        query = query.filter(Bill.id != exclude_id)
    return query.first() is not None


def _generate_bill_number(db: Session) -> str:
    year = datetime.now().year
    count = db.query(func.count(Bill.id)).scalar() or 0
    sequence = int(count) + 1
    while True:
        candidate = f"INV-{year}-{sequence:04d}"
        if not _bill_number_exists(db, candidate):
            return candidate
        sequence += 1


def _resolve_bill_number(db: Session, requested: str | None, exclude_id: int | None = None) -> str:
    custom = (requested or "").strip()
    if not custom:
        return _generate_bill_number(db)
    if _bill_number_exists(db, custom, exclude_id=exclude_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invoice number is already in use",
        )
    return custom


def _build_bill_response(bill: Bill) -> BillResponse:
    sub = float(bill.subtotal or 0)
    tax = float(bill.tax_amount or 0)
    disc = float(bill.discount_amount or 0)
    tot = float(bill.total_amount or (sub + tax - disc))
    paid = float(bill.paid_amount or 0)
    bal = max(tot - paid, 0.0)

    if paid >= tot and tot > 0:
        stat = "paid"
    elif paid > 0:
        stat = "partial"
    else:
        stat = "unpaid"

    res = BillResponse.model_validate(bill)
    res.subtotal = sub
    res.tax_amount = tax
    res.discount_amount = disc
    res.total_amount = tot
    res.paid_amount = paid
    res.balance_amount = round(bal, 2)
    res.status = stat
    res.project_name = bill.project.project_name if bill.project else (bill.custom_project_name or None)
    res.custom_project_name = bill.custom_project_name
    return res


@router.get("/bills", response_model=list[BillResponse])
async def list_bills(
    project_id: int | None = None,
    shareholder_id: int | None = None,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(Bill).filter(Bill.deleted_at == None).order_by(Bill.bill_date.desc(), Bill.id.desc())
    if project_id is not None:
        query = query.filter(Bill.project_id == project_id)
    if shareholder_id is not None:
        query = query.filter(Bill.shareholder_id == shareholder_id)

    bills = query.all()
    results = [_build_bill_response(b) for b in bills]

    if status_filter and status_filter != "all":
        results = [b for b in results if b.status == status_filter]

    return results


@router.get("/bills/next-number", response_model=NextBillNumberResponse)
async def get_next_bill_number(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return NextBillNumberResponse(bill_number=_generate_bill_number(db))


@router.post("/bills", response_model=BillResponse, status_code=status.HTTP_201_CREATED)
async def create_bill(
    payload: BillCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    if payload.project_id:
        get_or_404(db, Project, payload.project_id)
        if payload.shareholder_id:
            sh = get_or_404(db, ProjectShareholder, payload.shareholder_id)
            if sh.project_id != payload.project_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client does not belong to this project")
    elif not payload.custom_project_name and not payload.client_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project name or client name is required")

    bill_num = _resolve_bill_number(db, payload.bill_number)
    bill = Bill(
        bill_number=bill_num,
        project_id=payload.project_id if payload.project_id else None,
        custom_project_name=payload.custom_project_name.strip() if payload.custom_project_name else None,
        shareholder_id=payload.shareholder_id if payload.project_id else None,
        bill_date=payload.bill_date,
        due_date=payload.due_date,
        client_name=payload.client_name,
        company_name=payload.company_name,
        billing_address=payload.billing_address,
        billing_city=payload.billing_city,
        billing_pincode=payload.billing_pincode,
        seal_type=payload.seal_type,
        subtotal=payload.subtotal,
        cgst_amount=payload.cgst_amount,
        sgst_amount=payload.sgst_amount,
        tax_amount=payload.tax_amount,
        discount_amount=payload.discount_amount,
        total_amount=payload.total_amount,
        notes=payload.notes,
        signature_image=payload.signature_image,
        gst_only=bool(payload.gst_only),
    )
    db.add(bill)
    db.flush()

    for item in payload.items:
        bi = BillItem(
            bill_id=bill.id,
            description=item.description,
            hsn_code=item.hsn_code or "995411",
            cgst_rate=item.cgst_rate,
            sgst_rate=item.sgst_rate,
            cgst_amount=item.cgst_amount,
            sgst_amount=item.sgst_amount,
            quantity=item.quantity,
            rate=item.rate,
            amount=item.amount,
        )
        db.add(bi)

    db.commit()
    db.refresh(bill)
    gst_note = " · GST only" if bill.gst_only else ""
    log_action(
        db,
        user,
        "create",
        "bills",
        bill.id,
        details=f"Created invoice {bill.bill_number} for {bill.client_name or 'client'} · ₹{float(bill.total_amount or 0):,.2f}{gst_note}",
    )
    return _build_bill_response(bill)


@router.get("/bills/{bill_id}", response_model=BillResponse)
async def get_bill(bill_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    bill = get_or_404(db, Bill, bill_id)
    return _build_bill_response(bill)


@router.put("/bills/{bill_id}", response_model=BillResponse)
async def update_bill(
    bill_id: int,
    payload: BillUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    bill = get_or_404(db, Bill, bill_id)
    if bill.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")

    if payload.project_id:
        get_or_404(db, Project, payload.project_id)
        if payload.shareholder_id:
            sh = get_or_404(db, ProjectShareholder, payload.shareholder_id)
            if sh.project_id != payload.project_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client does not belong to this project")
    elif not payload.custom_project_name and not payload.client_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project name or client name is required")

    if payload.bill_number is not None:
        custom_number = payload.bill_number.strip()
        if custom_number:
            bill.bill_number = _resolve_bill_number(db, custom_number, exclude_id=bill.id)

    bill.project_id = payload.project_id if payload.project_id else None
    bill.custom_project_name = payload.custom_project_name.strip() if payload.custom_project_name else None
    bill.shareholder_id = payload.shareholder_id if payload.project_id else None
    bill.bill_date = payload.bill_date
    bill.due_date = payload.due_date
    bill.client_name = payload.client_name
    bill.company_name = payload.company_name
    bill.billing_address = payload.billing_address
    bill.billing_city = payload.billing_city
    bill.billing_pincode = payload.billing_pincode
    bill.seal_type = payload.seal_type
    bill.subtotal = payload.subtotal
    bill.cgst_amount = payload.cgst_amount
    bill.sgst_amount = payload.sgst_amount
    bill.tax_amount = payload.tax_amount
    bill.discount_amount = payload.discount_amount
    bill.total_amount = payload.total_amount
    bill.notes = payload.notes
    bill.signature_image = payload.signature_image
    bill.gst_only = bool(payload.gst_only)

    # Replace bill items
    db.query(BillItem).filter(BillItem.bill_id == bill.id).delete()
    for item in payload.items:
        bi = BillItem(
            bill_id=bill.id,
            description=item.description,
            hsn_code=item.hsn_code or "995411",
            cgst_rate=item.cgst_rate,
            sgst_rate=item.sgst_rate,
            cgst_amount=item.cgst_amount,
            sgst_amount=item.sgst_amount,
            quantity=item.quantity,
            rate=item.rate,
            amount=item.amount,
        )
        db.add(bi)

    db.commit()
    db.refresh(bill)
    gst_note = " · GST only" if bill.gst_only else ""
    log_action(
        db,
        user,
        "update",
        "bills",
        bill.id,
        details=f"Updated invoice {bill.bill_number} for {bill.client_name or 'client'} · ₹{float(bill.total_amount or 0):,.2f}{gst_note}",
    )
    return _build_bill_response(bill)


@router.delete("/bills/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bill(
    bill_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    bill = get_or_404(db, Bill, bill_id)
    bill.deleted_at = datetime.utcnow()
    db.add(bill)
    db.commit()
    log_action(db, user, "delete", "bills", bill_id, details=f"Deleted invoice {bill.bill_number}")


@router.post("/bills/{bill_id}/record-payment", response_model=JVShareholderPaymentResponse)
async def record_bill_payment(
    bill_id: int,
    payload: BillRecordPaymentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    bill = get_or_404(db, Bill, bill_id)
    if bill.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")

    # Update paid amount on bill
    bill.paid_amount = float(bill.paid_amount or 0) + payload.amount
    tot = float(bill.total_amount or 0)
    if bill.paid_amount >= tot and tot > 0:
        bill.status = "paid"
    else:
        bill.status = "partial"
    db.add(bill)

    payment_notes = f"Payment for Bill {bill.bill_number}"
    if payload.notes:
        payment_notes += f" - {payload.notes}"

    if bill.project_id and bill.shareholder_id:
        payment = ShareholderPayment(
            project_id=bill.project_id,
            shareholder_id=bill.shareholder_id,
            payment_date=payload.payment_date,
            amount=payload.amount,
            payment_mode=payload.payment_mode,
            purpose="gst_invoice",
            notes=payment_notes,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
        log_action(db, user, "create", "shareholder_payments", payment.id, details=f"Recorded GST invoice payment for {bill.bill_number} · ₹{float(payload.amount or 0):,.2f}")
        log_action(db, user, "update", "bills", bill.id, details=f"Collected payment on invoice {bill.bill_number} · ₹{float(payload.amount or 0):,.2f}")
        return payment

    db.commit()
    log_action(db, user, "update", "bills", bill.id, details=f"Collected payment on invoice {bill.bill_number} · ₹{float(payload.amount or 0):,.2f}")
    return JVShareholderPaymentResponse(
        id=bill.id,
        project_id=bill.project_id or 0,
        shareholder_id=bill.shareholder_id or 0,
        payment_date=payload.payment_date,
        amount=payload.amount,
        payment_mode=payload.payment_mode,
        notes=payment_notes,
    )
