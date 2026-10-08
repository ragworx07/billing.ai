from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, require_roles
from src.data.clients.session import get_db
from src.data.models.postgres.enums import ProjectStatus, UserRole
from src.core.permissions import ADMIN_ROLES, CLIENT_ROLES
from src.data.models.postgres.client import Client
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.shareholder_payment_schedule import ShareholderPaymentSchedule
from src.data.models.postgres.site_expense import SiteExpense
from src.data.models.postgres.user import User
from src.core.permissions import PROJECT_ROLES
from src.schemas.project import (
    KKRMaterialSummaryItem,
    KKRMaterialSummaryResponse,
    ProjectBase,
    ProjectMetrics,
    ProjectShareholderBase,
    ProjectShareholderResponse,
    ProjectShareholderUpdate,
    ProjectResponse,
    ProjectStatementResponse,
    ProjectTimelineEvent,
)
from src.core.services.audit_service import log_action
from src.core.services.storage_service import storage_service
from src.core.services.calculation_service import (
    apply_project_budget_fields,
    calculate_labour_cost,
    calculate_material_cost,
    calculate_other_expenses,
    calculate_outstanding,
    calculate_profit,
    calculate_profit_percentage,
    calculate_project_budget,
    calculate_project_total_amount,
    calculate_total_cost,
    calculate_total_received,
)
from src.utils.crud import get_or_404

router = APIRouter()


def _calculate_shareholder_amounts(project: Project, data: dict) -> dict:
    """Client Final Cost = (Purchased Area × Client Rate) + Round Off."""
    if not data.get("company_name") and data.get("pan_no"):
        data["company_name"] = data["pan_no"]
    elif not data.get("pan_no") and data.get("company_name"):
        data["pan_no"] = data["company_name"]
    additional_sqft = max(float(data.get("new_area") or 0) - float(data.get("free_cost_area") or 0), 0)
    rate_per_sqft = float(data.get("rate_per_sqft") or 0)
    if rate_per_sqft <= 0:
        rate_per_sqft = float(project.construction_rate_per_sqft or 0)
    round_off = float(data.get("round_off") or 0)
    client_subtotal = additional_sqft * rate_per_sqft
    data["additional_sqft"] = round(additional_sqft, 2)
    data["rate_per_sqft"] = round(rate_per_sqft, 2)
    data["round_off"] = round(round_off, 2)
    data["legal_charges"] = round(float(data.get("legal_charges") or 0), 2)
    data["due_amount"] = round(client_subtotal + round_off, 2)
    return data



def _recalculate_project_shareholder_amounts(db: Session, project: Project) -> None:
    """Refresh purchased-area math using each client's own rate and round-off."""
    shareholders = (
        db.query(ProjectShareholder)
        .filter(ProjectShareholder.project_id == project.id, ProjectShareholder.deleted_at == None)
        .all()
    )
    for shareholder in shareholders:
        additional_sqft = max(float(shareholder.new_area or 0) - float(shareholder.free_cost_area or 0), 0)
        rate_per_sqft = float(shareholder.rate_per_sqft or 0)
        if rate_per_sqft <= 0:
            rate_per_sqft = float(project.construction_rate_per_sqft or 0)
            shareholder.rate_per_sqft = round(rate_per_sqft, 2)
        round_off = float(getattr(shareholder, "round_off", 0) or 0)
        shareholder.additional_sqft = round(additional_sqft, 2)
        shareholder.round_off = round(round_off, 2)
        shareholder.due_amount = round(additional_sqft * rate_per_sqft + round_off, 2)
        db.add(shareholder)


def _to_response(db: Session, project: Project) -> ProjectResponse:
    payload = {
        "id": project.id,
        "client_id": project.client_id,
        "project_name": project.project_name,
        "description": project.description,
        "profile_image_url": project.profile_image_url,
        "location": project.location,
        "start_date": project.start_date,
        "expected_end_date": project.expected_end_date,
        "estimated_cost": float(project.estimated_cost or 0),
        "construction_sqft": float(project.construction_sqft or 0),
        "construction_rate_per_sqft": float(project.construction_rate_per_sqft or 0),
        "status": project.status,
        "existing_shareholders_count": project.existing_shareholders_count,
        "new_shareholders_count": project.new_shareholders_count,
        "created_at": project.created_at,
        "total_amount": calculate_project_budget(project) or calculate_project_total_amount(db, project.id),
    }
    return ProjectResponse.model_validate(payload)


def _resolve_client_id(db: Session, payload: ProjectBase) -> int:
    if payload.client_id:
        return payload.client_id
    fallback = db.query(Client).filter(Client.company_name == "JV Projects").first()
    if fallback:
        return fallback.id
    fallback = Client(
        name="JV Portfolio",
        company_name="JV Projects",
        phone="0000000000",
        address_line1="N/A",
        city="N/A",
        state="N/A",
        pincode="000000",
    )
    db.add(fallback)
    db.flush()
    return fallback.id


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    projects = db.query(Project).filter(Project.deleted_at == None).order_by(Project.created_at.asc(), Project.id.asc()).all()
    return [_to_response(db, project) for project in projects]


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    data = payload.model_dump()
    data["client_id"] = _resolve_client_id(db, payload)
    data["status"] = ProjectStatus.UPCOMING
    project = Project(**data)
    apply_project_budget_fields(project)
    db.add(project)
    db.flush()
    db.commit()
    db.refresh(project)
    log_action(db, user, "create", "projects", project.id)
    return _to_response(db, project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    payload: ProjectBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*PROJECT_ROLES)),
):
    project = get_or_404(db, Project, project_id)
    data = payload.model_dump()
    data["client_id"] = _resolve_client_id(db, payload)
    for key, value in data.items():
        setattr(project, key, value)
    apply_project_budget_fields(project)
    _recalculate_project_shareholder_amounts(db, project)
    db.add(project)
    db.commit()
    db.refresh(project)
    log_action(db, user, "update", "projects", project.id)
    return _to_response(db, project)


@router.post("/upload-image")
async def upload_project_profile_image(
    file: UploadFile = File(...),
    _: User = Depends(require_roles(*ADMIN_ROLES)),
):
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image uploads are allowed")
    return {"url": await storage_service.upload_bill(file, "project-images")}


@router.get("/{project_id}/shareholders", response_model=list[ProjectShareholderResponse])
async def list_project_shareholders(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    get_or_404(db, Project, project_id)
    return (
        db.query(ProjectShareholder)
        .filter(ProjectShareholder.project_id == project_id, ProjectShareholder.deleted_at == None)
        .order_by(ProjectShareholder.created_at.asc())
        .all()
    )


@router.post("/{project_id}/shareholders", response_model=ProjectShareholderResponse, status_code=status.HTTP_201_CREATED)
async def create_project_shareholder(
    project_id: int,
    payload: ProjectShareholderBase,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    project = get_or_404(db, Project, project_id)
    row = ProjectShareholder(project_id=project_id, **_calculate_shareholder_amounts(project, payload.model_dump()))
    db.add(row)
    db.flush()
    db.commit()
    db.refresh(row)
    log_action(db, user, "create", "project_shareholders", row.id)
    return row


@router.put("/{project_id}/shareholders/{shareholder_id}", response_model=ProjectShareholderResponse)
async def update_project_shareholder(
    project_id: int,
    shareholder_id: int,
    payload: ProjectShareholderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    row = get_or_404(db, ProjectShareholder, shareholder_id)
    if row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")
    project = get_or_404(db, Project, project_id)
    for key, value in _calculate_shareholder_amounts(project, payload.model_dump()).items():
        setattr(row, key, value)
    db.add(row)
    db.flush()
    db.commit()
    db.refresh(row)
    log_action(db, user, "update", "project_shareholders", row.id)
    return row


@router.delete("/{project_id}/shareholders/{shareholder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_shareholder(
    project_id: int,
    shareholder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*CLIENT_ROLES)),
):
    row = get_or_404(db, ProjectShareholder, shareholder_id)
    if row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Shareholder does not belong to this project")
    deleted_at = datetime.utcnow()
    row.deleted_at = deleted_at
    db.add(row)

    linked_payments = (
        db.query(ShareholderPayment)
        .filter(
            ShareholderPayment.project_id == project_id,
            ShareholderPayment.shareholder_id == shareholder_id,
            ShareholderPayment.deleted_at == None,
        )
        .all()
    )
    linked_schedules = (
        db.query(ShareholderPaymentSchedule)
        .filter(
            ShareholderPaymentSchedule.project_id == project_id,
            ShareholderPaymentSchedule.shareholder_id == shareholder_id,
            ShareholderPaymentSchedule.deleted_at == None,
        )
        .all()
    )
    for linked_row in [*linked_payments, *linked_schedules]:
        linked_row.deleted_at = deleted_at
        db.add(linked_row)

    db.flush()
    db.commit()
    log_action(db, user, "delete", "project_shareholders", shareholder_id)


@router.patch("/{project_id}/status", response_model=ProjectResponse)
async def update_project_status(
    project_id: int,
    status_value: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    project = get_or_404(db, Project, project_id)
    project.status = ProjectStatus(status_value)
    db.add(project)
    db.commit()
    db.refresh(project)
    log_action(db, user, "update", "projects", project.id)
    return _to_response(db, project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    confirmation_name: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(UserRole.OWNER)),
):
    project = get_or_404(db, Project, project_id)
    if confirmation_name != project.project_name:
        raise HTTPException(status_code=400, detail="Project name confirmation does not match")
    project.deleted_at = datetime.utcnow()
    db.add(project)
    db.commit()
    log_action(db, user, "delete", "projects", project_id)


@router.get("/{project_id}/metrics", response_model=ProjectMetrics)
async def project_metrics(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN_ROLES))):
    get_or_404(db, Project, project_id)
    return ProjectMetrics(
        material_cost=calculate_material_cost(db, project_id),
        labour_cost=calculate_labour_cost(db, project_id),
        other_expenses=calculate_other_expenses(db, project_id),
        total_cost=calculate_total_cost(db, project_id),
        total_received=calculate_total_received(db, project_id),
        outstanding=calculate_outstanding(db, project_id),
        profit=calculate_profit(db, project_id),
        profit_percentage=calculate_profit_percentage(db, project_id),
    )


@router.get("/{project_id}/statement", response_model=ProjectStatementResponse)
async def project_statement(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = get_or_404(db, Project, project_id)

    timeline: list[ProjectTimelineEvent] = [
        ProjectTimelineEvent(
            date=project.start_date.isoformat(),
            type="project",
            title="Project Started",
            detail=f"{project.project_name} at {project.location}",
        )
    ]

    for item in db.query(MaterialLog).filter(MaterialLog.project_id == project_id, MaterialLog.deleted_at.is_(None)).all():
        timeline.append(
            ProjectTimelineEvent(
                date=item.date.isoformat(),
                type="material",
                title=f"Material: {item.material_name}",
                detail=f"Qty {float(item.quantity)} {item.unit}",
                amount=float(item.quantity) * float(item.unit_cost) * (1 + float(item.gst_percent or 0) / 100) + float(item.transport_cost),
            )
        )
    for item in db.query(LaborLog).filter(LaborLog.project_id == project_id, LaborLog.deleted_at.is_(None)).all():
        timeline.append(
            ProjectTimelineEvent(
                date=item.date.isoformat(),
                type="labour",
                title=f"Labour: {item.labour_type}",
                detail=f"Count {float(item.labour_count)} @ {float(item.wage_per_head)}",
                amount=float(item.total_wage) if item.total_wage is not None else (float(item.labour_count) * float(item.wage_per_head) + float(item.overtime_cost)),
            )
        )
    for item in db.query(ExpenseLog).filter(ExpenseLog.project_id == project_id, ExpenseLog.deleted_at.is_(None)).all():
        timeline.append(
            ProjectTimelineEvent(
                date=item.date.isoformat(),
                type="expense",
                title=f"Expense: {item.category}",
                detail=item.description or "General expense",
                amount=float(item.amount),
            )
        )
    for item in db.query(SiteExpense).filter(SiteExpense.project_id == project_id, SiteExpense.allocation == "project").all():
        timeline.append(
            ProjectTimelineEvent(
                date=item.date.isoformat(),
                type="expense",
                title=f"Expense: {item.item_name or item.category}",
                detail=item.description or "Site expense",
                amount=float(item.amount),
            )
        )
    for item in db.query(PaymentLog).filter(PaymentLog.project_id == project_id, PaymentLog.deleted_at.is_(None)).all():
        stamp = item.received_date or item.due_date
        if stamp:
            timeline.append(
                ProjectTimelineEvent(
                    date=stamp.isoformat(),
                    type="payment",
                    title=f"Payment {item.status.value}",
                    detail=f"{item.payment_type.value} payment",
                    amount=float(item.amount),
                )
            )

    timeline.sort(key=lambda event: datetime.fromisoformat(event.date), reverse=True)

    metrics = ProjectMetrics(
        material_cost=calculate_material_cost(db, project_id) if user.role in ADMIN_ROLES else 0,
        labour_cost=calculate_labour_cost(db, project_id) if user.role in ADMIN_ROLES else 0,
        other_expenses=calculate_other_expenses(db, project_id) if user.role in ADMIN_ROLES else 0,
        total_cost=calculate_total_cost(db, project_id) if user.role in ADMIN_ROLES else 0,
        total_received=calculate_total_received(db, project_id) if user.role in ADMIN_ROLES else 0,
        outstanding=calculate_outstanding(db, project_id) if user.role in ADMIN_ROLES else 0,
        profit=calculate_profit(db, project_id) if user.role in ADMIN_ROLES else 0,
        profit_percentage=calculate_profit_percentage(db, project_id) if user.role in ADMIN_ROLES else 0,
    )

    return ProjectStatementResponse(project=_to_response(db, project), timeline=timeline, metrics=metrics)


@router.get("/{project_id}/kkr-material-summary", response_model=KKRMaterialSummaryResponse)
async def kkr_material_summary(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    get_or_404(db, Project, project_id)
    rows = db.query(MaterialLog).filter(MaterialLog.project_id == project_id, MaterialLog.deleted_at.is_(None)).all()

    grouped: dict[str, dict[str, float | str | None]] = {}
    for row in rows:
        supplier = (row.supplier or "").strip() or None
        key = f"{row.material_name.strip().upper()}|{(supplier or 'NO_SUPPLIER').upper()}|{float(row.unit_cost or 0):.2f}"
        if key not in grouped:
            grouped[key] = {
                "material_name": row.material_name,
                "supplier": supplier,
                "unit_rate": float(row.unit_cost or 0),
                "quantity": 0.0,
                "unit": row.unit,
                "total_price": 0.0,
            }
        grouped[key]["quantity"] = float(grouped[key]["quantity"]) + float(row.quantity or 0)
        grouped[key]["total_price"] = float(grouped[key]["total_price"]) + (
            float(row.quantity or 0) * float(row.unit_cost or 0) * (1 + float(row.gst_percent or 0) / 100) + float(row.transport_cost or 0)
        )

    items = [
        KKRMaterialSummaryItem(
            material_name=str(v["material_name"]),
            supplier=str(v["supplier"]) if v["supplier"] is not None else None,
            unit_rate=float(v["unit_rate"]),
            quantity=float(v["quantity"]),
            unit=str(v["unit"]),
            total_price=float(v["total_price"]),
        )
        for v in grouped.values()
    ]
    items.sort(key=lambda x: x.material_name)
    grand_total = sum(item.total_price for item in items)
    return KKRMaterialSummaryResponse(project_id=project_id, grand_total=grand_total, items=items)
