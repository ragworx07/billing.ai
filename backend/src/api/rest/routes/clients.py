from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.core.services.audit_service import log_action
from src.core.services.calculation_service import (
    calculate_gst_payable,
    calculate_percent_of_amount,
    calculate_registration_payable,
    calculate_shareholder_construction_received,
    resolve_gst_percent,
    resolve_registration_percent,
    shareholder_charge_paid_maps,
)
from src.data.clients.session import get_db
from src.data.models.postgres.bill import Bill
from src.data.models.postgres.client import Client
from src.data.models.postgres.enums import PaymentStatus
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.shareholder_payment_schedule import ShareholderPaymentSchedule
from src.data.models.postgres.user import User
from src.core.permissions import CLIENT_ROLES
from src.schemas.client import ClientBase, ClientResponse
from src.schemas.jv_client import (
    JVPaymentScheduleResponse,
    JVPaymentScheduleSaveRequest,
    JVProjectLedgerResponse,
    JVProjectSummaryItem,
    JVGovernmentCharges,
    JVShareholderLedgerItem,
    JVShareholderPaymentCreate,
    JVShareholderPaymentEntry,
    JVShareholderPaymentResponse,
)
from src.utils.crud import get_or_404

router = APIRouter()


def _to_float(value) -> float:
    return float(value or 0)


def _coerce_due_amount(item: ProjectShareholder) -> float:
    return float(getattr(item, "due_amount", 0) or 0)


def _government_charges_from_project(project: Project) -> JVGovernmentCharges:
    raw_land_factor = getattr(project, "govt_land_factor", None)
    land_factor = 1.0 if raw_land_factor is None else _to_float(raw_land_factor)

    def _column(name: str, default: float) -> float:
        if not hasattr(project, name):
            return default
        value = getattr(project, name)
        return default if value is None else _to_float(value)

    return JVGovernmentCharges(
        composite_value_per_sqft=_column("govt_composite_value_per_sqft", 0),
        land_factor=min(max(land_factor, 0), 2),
        gst_percent=_column("govt_gst_percent", 5),
        registration_value_percent=_column("govt_registration_value_percent", 4),
        construction_cost_per_sqft=_column("govt_construction_cost_per_sqft", 0),
        new_gst_percent=_column("govt_new_gst_percent", 5),
        new_reg_upto_50l_percent=_column("govt_new_reg_upto_50l_percent", 6),
        new_reg_upto_3cr_percent=_column("govt_new_reg_upto_3cr_percent", 7),
        new_reg_above_3cr_percent=_column("govt_new_reg_above_3cr_percent", 9),
        new_legal_charges=_column("govt_new_legal_charges", 0),
    )


def _round_money(value: float) -> float:
    return round(max(value, 0.0), 2)


@router.get("/", response_model=list[ClientResponse])
async def list_clients(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Client).filter(Client.deleted_at == None).order_by(Client.created_at.desc()).all()


@router.post("/", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
async def create_client(
    payload: ClientBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    client = Client(**payload.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    log_action(db, user, "create", "clients", client.id)
    return client


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: int,
    payload: ClientBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    client = get_or_404(db, Client, client_id)
    for key, value in payload.model_dump().items():
        setattr(client, key, value)
    db.add(client)
    db.commit()
    db.refresh(client)
    log_action(db, user, "update", "clients", client.id)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client(client_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles(*CLIENT_ROLES))):
    client = get_or_404(db, Client, client_id)
    client.deleted_at = datetime.utcnow()
    db.add(client)
    db.commit()
    log_action(db, user, "delete", "clients", client_id)


def _compute_due_percentage(due_amount: float, total_due: float) -> float:
    if total_due <= 0:
        return 0.0
    return (due_amount / total_due) * 100.0


def _build_schedule_responses(
    schedules: list[ShareholderPaymentSchedule],
    paid_by_shareholder: dict[int, float],
    today: date | None = None,
) -> list[JVPaymentScheduleResponse]:
    today = today or date.today()
    remaining_paid = {shareholder_id: float(amount or 0) for shareholder_id, amount in paid_by_shareholder.items()}
    responses: list[JVPaymentScheduleResponse] = []
    for item in sorted(schedules, key=lambda row: (row.shareholder_id, row.due_date, row.installment_no, row.id)):
        paid_available = remaining_paid.get(item.shareholder_id, 0.0)
        amount = _to_float(item.amount)
        paid_amount = min(amount, max(paid_available, 0.0))
        remaining_paid[item.shareholder_id] = max(paid_available - amount, 0.0)
        balance_amount = max(amount - paid_amount, 0.0)
        days_overdue = (today - item.due_date).days if item.due_date < today and balance_amount > 0 else 0
        if balance_amount <= 0:
            schedule_status = "paid"
        elif paid_amount > 0:
            schedule_status = "partial_overdue" if days_overdue > 0 else "partial"
        elif days_overdue > 0:
            schedule_status = "overdue"
        else:
            schedule_status = "pending"
        responses.append(
            JVPaymentScheduleResponse(
                id=item.id,
                project_id=item.project_id,
                shareholder_id=item.shareholder_id,
                installment_no=item.installment_no,
                amount=amount,
                percentage=_to_float(item.percentage),
                due_date=item.due_date,
                remarks=item.remarks,
                paid_amount=round(paid_amount, 2),
                balance_amount=round(balance_amount, 2),
                status=schedule_status,
                days_overdue=days_overdue,
            )
        )
    return responses


@router.get("/jv-projects", response_model=list[JVProjectSummaryItem])
async def list_jv_projects(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    projects = (
        db.query(
            Project.id.label("project_id"),
            Project.project_name.label("project_name"),
            Project.location.label("location"),
            Project.construction_rate_per_sqft.label("construction_rate_per_sqft"),
            Project.estimated_cost.label("estimated_cost"),
            Client.name.label("client_name"),
        )
        .join(Client, Client.id == Project.client_id)
        .filter(Project.deleted_at == None, Client.deleted_at == None)
        .order_by(Project.created_at.asc(), Project.id.asc())
        .all()
    )
    due_rows = (
        db.query(ProjectShareholder.project_id, func.coalesce(func.sum(ProjectShareholder.due_amount), 0))
        .filter(ProjectShareholder.deleted_at == None)
        .group_by(ProjectShareholder.project_id)
        .all()
    )
    project_payment_rows = (
        db.query(PaymentLog.project_id, func.coalesce(func.sum(PaymentLog.amount), 0))
        .filter(PaymentLog.status == PaymentStatus.RECEIVED, PaymentLog.deleted_at == None)
        .group_by(PaymentLog.project_id)
        .all()
    )
    total_due_by_project = {project_id: _to_float(total) for project_id, total in due_rows}
    all_payments = db.query(ShareholderPayment).filter(ShareholderPayment.deleted_at == None).all()
    all_bills = db.query(Bill).filter(Bill.deleted_at == None, Bill.shareholder_id != None).all()
    construction_paid, _, _, _ = shareholder_charge_paid_maps(all_payments, all_bills)
    shareholders = db.query(ProjectShareholder.id, ProjectShareholder.project_id).filter(ProjectShareholder.deleted_at == None).all()
    construction_paid_by_project: dict[int, float] = {}
    for shareholder_id, project_id in shareholders:
        construction_paid_by_project[project_id] = construction_paid_by_project.get(project_id, 0.0) + construction_paid.get(shareholder_id, 0.0)
    for project_id, total in project_payment_rows:
        construction_paid_by_project[project_id] = construction_paid_by_project.get(project_id, 0.0) + _to_float(total)

    response: list[JVProjectSummaryItem] = []
    for project in projects:
        total_due = total_due_by_project.get(project.project_id, 0.0)
        total_paid = construction_paid_by_project.get(project.project_id, 0.0)
        budget = _to_float(project.estimated_cost)
        response.append(
            JVProjectSummaryItem(
                project_id=project.project_id,
                project_name=project.project_name,
                location=project.location,
                client_name=project.client_name,
                construction_rate_per_sqft=_to_float(project.construction_rate_per_sqft),
                total_budget=budget,
                total_due=total_due,
                total_paid=total_paid,
                total_balance=total_due - total_paid,
            )
        )
    return response


@router.get("/jv-projects/{project_id}/ledger", response_model=JVProjectLedgerResponse)
async def get_jv_project_ledger(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    project = get_or_404(db, Project, project_id)
    shareholders = (
        db.query(ProjectShareholder)
        .filter(ProjectShareholder.project_id == project_id, ProjectShareholder.deleted_at == None)
        .order_by(ProjectShareholder.created_at.asc())
        .all()
    )
    payments = (
        db.query(ShareholderPayment)
        .filter(ShareholderPayment.project_id == project_id, ShareholderPayment.deleted_at == None)
        .order_by(ShareholderPayment.payment_date.desc(), ShareholderPayment.id.desc())
        .all()
    )
    bills = (
        db.query(Bill)
        .filter(Bill.project_id == project_id, Bill.deleted_at == None, Bill.shareholder_id != None)
        .all()
    )
    construction_paid, gst_paid_map, registration_paid_map, legal_paid_map = shareholder_charge_paid_maps(payments, bills)
    charges = _government_charges_from_project(project)
    try:
        schedules = (
            db.query(ShareholderPaymentSchedule)
            .filter(ShareholderPaymentSchedule.project_id == project_id, ShareholderPaymentSchedule.deleted_at == None)
            .order_by(
                ShareholderPaymentSchedule.shareholder_id.asc(),
                ShareholderPaymentSchedule.due_date.asc(),
                ShareholderPaymentSchedule.installment_no.asc(),
            )
            .all()
        )
    except SQLAlchemyError:
        db.rollback()
        schedules = []
    total_due = sum(_coerce_due_amount(item) for item in shareholders)
    paid_by_shareholder = {shareholder_id: construction_paid.get(shareholder_id, 0.0) for shareholder_id in {item.id for item in shareholders}}
    for shareholder_id, amount in construction_paid.items():
        paid_by_shareholder[shareholder_id] = amount

    ledger_rows: list[JVShareholderLedgerItem] = []
    for item in shareholders:
        due_amount = _coerce_due_amount(item)
        paid_amount = _round_money(paid_by_shareholder.get(item.id, 0.0))
        saleable_area = float(item.new_area or 0)
        gst_percent = resolve_gst_percent(charges, bool(item.is_existing_shareholder))
        registration_percent = resolve_registration_percent(charges, bool(item.is_existing_shareholder), due_amount)
        if item.is_existing_shareholder:
            gst_payable = calculate_gst_payable(
                charges.composite_value_per_sqft,
                charges.land_factor,
                saleable_area,
                gst_percent,
            )
            registration_payable = calculate_registration_payable(
                charges.construction_cost_per_sqft,
                saleable_area,
                registration_percent,
            )
        else:
            gst_payable = calculate_percent_of_amount(due_amount, gst_percent)
            registration_payable = calculate_percent_of_amount(due_amount, registration_percent)
        legal_payable = _round_money(float(getattr(item, "legal_charges", 0) or 0))
        gst_paid = _round_money(gst_paid_map.get(item.id, 0.0))
        registration_paid = _round_money(registration_paid_map.get(item.id, 0.0))
        legal_paid = _round_money(legal_paid_map.get(item.id, 0.0))
        ledger_rows.append(
            JVShareholderLedgerItem(
                shareholder_id=item.id,
                name=item.name,
                company_name=item.company_name,
                pan_no=item.company_name,
                address=item.address,
                city=item.city,
                pincode=item.pincode,
                is_existing_shareholder=item.is_existing_shareholder,
                existing_area=float(item.existing_area or 0),
                existing_uds=float(item.existing_uds or 0),
                free_cost_area=float(item.free_cost_area or 0),
                new_area=float(item.new_area or 0),
                new_uds=float(item.new_uds or 0),
                additional_sqft=float(item.additional_sqft or 0),
                rate_per_sqft=float(item.rate_per_sqft or 0),
                round_off=float(getattr(item, "round_off", 0) or 0),
                client_subtotal=round(float(item.additional_sqft or 0) * float(item.rate_per_sqft or 0), 2),
                legal_charges=legal_payable,
                due_amount=due_amount,
                due_percentage=_compute_due_percentage(due_amount, total_due),
                paid_amount=paid_amount,
                balance_amount=_round_money(due_amount - paid_amount),
                gst_payable=gst_payable,
                gst_paid=gst_paid,
                gst_balance=_round_money(gst_payable - gst_paid),
                registration_payable=registration_payable,
                registration_paid=registration_paid,
                registration_balance=_round_money(registration_payable - registration_paid),
                legal_payable=legal_payable,
                legal_paid=legal_paid,
                legal_balance=_round_money(legal_payable - legal_paid),
            )
        )

    total_due = sum(item.due_amount for item in ledger_rows)
    total_paid = sum(item.paid_amount for item in ledger_rows)
    total_gst_payable = sum(item.gst_payable for item in ledger_rows)
    total_gst_paid = sum(item.gst_paid for item in ledger_rows)
    total_registration_payable = sum(item.registration_payable for item in ledger_rows)
    total_registration_paid = sum(item.registration_paid for item in ledger_rows)
    total_legal_payable = sum(item.legal_payable for item in ledger_rows)
    total_legal_paid = sum(item.legal_paid for item in ledger_rows)
    return JVProjectLedgerResponse(
        project_id=project.id,
        project_name=project.project_name,
        construction_rate_per_sqft=float(project.construction_rate_per_sqft or 0),
        total_due=total_due,
        total_paid=total_paid,
        total_balance=_round_money(total_due - total_paid),
        total_gst_payable=total_gst_payable,
        total_gst_paid=total_gst_paid,
        total_gst_balance=_round_money(total_gst_payable - total_gst_paid),
        total_registration_payable=total_registration_payable,
        total_registration_paid=total_registration_paid,
        total_registration_balance=_round_money(total_registration_payable - total_registration_paid),
        total_legal_payable=total_legal_payable,
        total_legal_paid=total_legal_paid,
        total_legal_balance=_round_money(total_legal_payable - total_legal_paid),
        government_charges=charges,
        shareholders=ledger_rows,
        payments=[JVShareholderPaymentResponse.model_validate(item) for item in payments],
        payment_schedules=_build_schedule_responses(schedules, paid_by_shareholder),
    )


@router.put(
    "/jv-projects/{project_id}/shareholders/{shareholder_id}/payment-schedule",
    response_model=list[JVPaymentScheduleResponse],
)
async def save_jv_shareholder_payment_schedule(
    project_id: int,
    shareholder_id: int,
    payload: JVPaymentScheduleSaveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    get_or_404(db, Project, project_id)
    shareholder = get_or_404(db, ProjectShareholder, shareholder_id)
    if shareholder.project_id != project_id or shareholder.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")

    existing_rows = (
        db.query(ShareholderPaymentSchedule)
        .filter(
            ShareholderPaymentSchedule.project_id == project_id,
            ShareholderPaymentSchedule.shareholder_id == shareholder_id,
            ShareholderPaymentSchedule.deleted_at == None,
        )
        .all()
    )
    for row in existing_rows:
        row.deleted_at = datetime.utcnow()
        db.add(row)

    new_rows: list[ShareholderPaymentSchedule] = []
    for index, item in enumerate(payload.installments, start=1):
        row = ShareholderPaymentSchedule(
            project_id=project_id,
            shareholder_id=shareholder_id,
            installment_no=item.installment_no or index,
            amount=item.amount,
            percentage=item.percentage,
            due_date=item.due_date,
            remarks=item.remarks,
        )
        db.add(row)
        new_rows.append(row)

    db.commit()
    for row in new_rows:
        db.refresh(row)

    paid_total = calculate_shareholder_construction_received(db, project_id, shareholder_id)
    log_action(db, user, "update", "shareholder_payment_schedules", shareholder_id)
    return _build_schedule_responses(new_rows, {shareholder_id: paid_total})


@router.delete(
    "/jv-projects/{project_id}/shareholders/{shareholder_id}/payment-schedule",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_jv_shareholder_payment_schedule(
    project_id: int,
    shareholder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    shareholder = get_or_404(db, ProjectShareholder, shareholder_id)
    if shareholder.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")
    rows = (
        db.query(ShareholderPaymentSchedule)
        .filter(
            ShareholderPaymentSchedule.project_id == project_id,
            ShareholderPaymentSchedule.shareholder_id == shareholder_id,
            ShareholderPaymentSchedule.deleted_at == None,
        )
        .all()
    )
    for row in rows:
        row.deleted_at = datetime.utcnow()
        db.add(row)
    db.commit()
    log_action(db, user, "delete", "shareholder_payment_schedules", shareholder_id)


@router.get("/jv-payments", response_model=list[JVShareholderPaymentEntry])
async def list_jv_shareholder_payments(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = (
        db.query(
            ShareholderPayment.id.label("id"),
            ShareholderPayment.project_id.label("project_id"),
            Project.project_name.label("project_name"),
            Client.name.label("client_name"),
            ShareholderPayment.shareholder_id.label("shareholder_id"),
            ProjectShareholder.name.label("shareholder_name"),
            ProjectShareholder.company_name.label("company_name"),
            ShareholderPayment.payment_date.label("payment_date"),
            ShareholderPayment.amount.label("amount"),
            ShareholderPayment.payment_mode.label("payment_mode"),
            ShareholderPayment.purpose.label("purpose"),
            ShareholderPayment.notes.label("notes"),
        )
        .join(Project, Project.id == ShareholderPayment.project_id)
        .join(Client, Client.id == Project.client_id)
        .join(ProjectShareholder, ProjectShareholder.id == ShareholderPayment.shareholder_id)
        .filter(
            ShareholderPayment.deleted_at == None,
            Project.deleted_at == None,
            Client.deleted_at == None,
            ProjectShareholder.deleted_at == None
        )
        .order_by(ShareholderPayment.payment_date.desc(), ShareholderPayment.id.desc())
    )
    if project_id is not None:
        query = query.filter(ShareholderPayment.project_id == project_id)

    rows = query.all()
    return [
        JVShareholderPaymentEntry(
            id=row.id,
            project_id=row.project_id,
            project_name=row.project_name,
            client_name=row.client_name,
            shareholder_id=row.shareholder_id,
            shareholder_name=row.shareholder_name,
            company_name=row.company_name,
            pan_no=row.company_name,
            payment_date=row.payment_date,
            amount=row.amount,
            payment_mode=row.payment_mode,
            purpose=getattr(row, "purpose", None),
            notes=row.notes,
        )
        for row in rows
    ]


@router.put("/jv-projects/{project_id}/government-charges", response_model=JVProjectLedgerResponse)
async def update_jv_government_charges(
    project_id: int,
    payload: JVGovernmentCharges,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    project = get_or_404(db, Project, project_id)
    project.govt_composite_value_per_sqft = round(_to_float(payload.composite_value_per_sqft), 2)
    project.govt_land_factor = round(_to_float(payload.land_factor), 4)
    project.govt_gst_percent = round(_to_float(payload.gst_percent), 2)
    project.govt_registration_value_percent = round(_to_float(payload.registration_value_percent), 2)
    project.govt_construction_cost_per_sqft = round(_to_float(payload.construction_cost_per_sqft), 2)
    project.govt_new_gst_percent = round(_to_float(payload.new_gst_percent), 2)
    project.govt_new_reg_upto_50l_percent = round(_to_float(payload.new_reg_upto_50l_percent), 2)
    project.govt_new_reg_upto_3cr_percent = round(_to_float(payload.new_reg_upto_3cr_percent), 2)
    project.govt_new_reg_above_3cr_percent = round(_to_float(payload.new_reg_above_3cr_percent), 2)
    project.govt_new_legal_charges = round(_to_float(payload.new_legal_charges), 2)
    db.add(project)
    db.commit()
    log_action(
        db,
        user,
        "update",
        "government_charges",
        project.id,
        details=f"Updated government charges for {project.project_name}",
    )
    return await get_jv_project_ledger(project_id, db, user)


@router.post("/jv-projects/{project_id}/payments", response_model=JVShareholderPaymentResponse, status_code=status.HTTP_201_CREATED)
async def create_jv_shareholder_payment(
    project_id: int,
    payload: JVShareholderPaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    get_or_404(db, Project, project_id)
    shareholder = get_or_404(db, ProjectShareholder, payload.shareholder_id)
    if shareholder.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")
    row = ShareholderPayment(project_id=project_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user,
        "create",
        "shareholder_payments",
        row.id,
        details=f"{str(payload.purpose or 'payment').replace('_', ' ')} payment for {shareholder.name} · ₹{float(payload.amount or 0):,.2f}",
    )
    return row


@router.put("/jv-projects/{project_id}/payments/{payment_id}", response_model=JVShareholderPaymentResponse)
async def update_jv_shareholder_payment(
    project_id: int,
    payment_id: int,
    payload: JVShareholderPaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    row = get_or_404(db, ShareholderPayment, payment_id)
    if row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment does not belong to this project")
    shareholder = get_or_404(db, ProjectShareholder, payload.shareholder_id)
    if shareholder.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user,
        "update",
        "shareholder_payments",
        row.id,
        details=f"Updated {str(payload.purpose or 'payment').replace('_', ' ')} payment for {shareholder.name} · ₹{float(payload.amount or 0):,.2f}",
    )
    return row


@router.delete("/jv-projects/{project_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_jv_shareholder_payment(
    project_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    row = get_or_404(db, ShareholderPayment, payment_id)
    if row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment does not belong to this project")
    row.deleted_at = datetime.utcnow()
    db.add(row)
    db.commit()
    shareholder = db.get(ProjectShareholder, row.shareholder_id)
    client_name = shareholder.name if shareholder else "client"
    log_action(
        db,
        user,
        "delete",
        "shareholder_payments",
        payment_id,
        details=f"Deleted {str(row.purpose or 'payment').replace('_', ' ')} payment for {client_name} · ₹{float(row.amount or 0):,.2f}",
    )
