from collections import defaultdict
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.data.models.postgres.enums import PaymentStatus, ProjectStatus
from src.data.models.postgres.bill import Bill
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.site_expense import SiteExpense


def _to_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def calculate_material_cost(db: Session, project_id: int) -> float:
    total = db.query(
        func.sum(MaterialLog.quantity * MaterialLog.unit_cost * (1 + func.coalesce(MaterialLog.gst_percent, 0) / 100) + MaterialLog.transport_cost)
    ).filter(MaterialLog.project_id == project_id, MaterialLog.deleted_at == None).scalar()
    return _to_float(total)


def calculate_labour_cost(db: Session, project_id: int) -> float:
    rows = db.query(LaborLog).filter(LaborLog.project_id == project_id, LaborLog.deleted_at == None).all()
    total = 0.0
    for row in rows:
        if row.total_wage is not None:
            total += _to_float(row.total_wage)
        else:
            total += _to_float(row.labour_count) * _to_float(row.wage_per_head) + _to_float(row.overtime_cost)
    return round(total, 2)


def calculate_site_expenses(db: Session, project_id: int) -> float:
    total = (
        db.query(func.sum(SiteExpense.amount))
        .filter(SiteExpense.project_id == project_id, SiteExpense.allocation == "project")
        .scalar()
    )
    return _to_float(total)


def calculate_other_expenses(db: Session, project_id: int) -> float:
    total = db.query(func.sum(ExpenseLog.amount)).filter(ExpenseLog.project_id == project_id, ExpenseLog.deleted_at == None).scalar()
    return round(_to_float(total) + calculate_site_expenses(db, project_id), 2)


def calculate_total_cost(db: Session, project_id: int) -> float:
    return round(
        calculate_material_cost(db, project_id)
        + calculate_labour_cost(db, project_id)
        + calculate_other_expenses(db, project_id),
        2,
    )


def calculate_shareholder_construction_received(db: Session, project_id: int, shareholder_id: int | None = None) -> float:
    payment_query = db.query(ShareholderPayment).filter(
        ShareholderPayment.project_id == project_id,
        ShareholderPayment.deleted_at == None,
    )
    bill_query = db.query(Bill).filter(Bill.project_id == project_id, Bill.deleted_at == None)
    if shareholder_id:
        payment_query = payment_query.filter(ShareholderPayment.shareholder_id == shareholder_id)
        bill_query = bill_query.filter(Bill.shareholder_id == shareholder_id)
    construction, _, _, _ = shareholder_charge_paid_maps(payment_query.all(), bill_query.all())
    if shareholder_id:
        return round(_to_float(construction.get(shareholder_id, 0.0)), 2)
    return round(sum(construction.values()), 2)


def calculate_total_received(db: Session, project_id: int) -> float:
    payment_total = (
        db.query(func.sum(PaymentLog.amount))
        .filter(PaymentLog.project_id == project_id, PaymentLog.status == PaymentStatus.RECEIVED, PaymentLog.deleted_at == None)
        .scalar()
    )
    return round(_to_float(payment_total) + calculate_shareholder_construction_received(db, project_id), 2)


def calculate_project_budget(project: Project | None) -> float:
    """Total Project Budget = Total Area (Sq Ft) × Project Rate per Sq Ft."""
    if not project:
        return 0.0
    sqft = _to_float(project.construction_sqft)
    rate = _to_float(project.construction_rate_per_sqft)
    return round(sqft * rate, 2)


def calculate_project_total_amount(db: Session, project_id: int) -> float:
    """Project budget used across statements/dashboard (area × project rate)."""
    project = db.get(Project, project_id)
    budget = calculate_project_budget(project)
    if budget > 0:
        return budget
    # Legacy fallback when rate/area are not configured yet.
    total = db.query(func.sum(ProjectShareholder.due_amount)).filter(
        ProjectShareholder.project_id == project_id,
        ProjectShareholder.deleted_at == None,
    ).scalar()
    return round(_to_float(total), 2)


def apply_project_budget_fields(project: Project) -> float:
    """Persist Total Project Budget onto estimated_cost when area/rate change."""
    budget = calculate_project_budget(project)
    project.estimated_cost = budget
    return budget



def calculate_outstanding(db: Session, project_id: int) -> float:
    total_amount = calculate_project_total_amount(db, project_id)
    return round(total_amount - calculate_total_received(db, project_id), 2)


def calculate_profit(db: Session, project_id: int) -> float:
    project = db.get(Project, project_id)
    if not project:
        return 0.0
    if project.status != ProjectStatus.COMPLETED:
        return 0.0
    return round(calculate_project_total_amount(db, project_id) - calculate_total_cost(db, project_id), 2)


def calculate_profit_percentage(db: Session, project_id: int) -> float:
    project = db.get(Project, project_id)
    total_amount = calculate_project_total_amount(db, project_id)
    if total_amount <= 0 or not project or project.status != ProjectStatus.COMPLETED:
        return 0.0
    return round((calculate_profit(db, project_id) / total_amount) * 100, 2)


GST_INVOICE_PAYMENT_PREFIX = "Payment for Bill"
PAYMENT_PURPOSES = ("construction", "gst", "registration", "legal", "gst_invoice")


def normalize_payment_purpose(value: str | None) -> str:
    raw = str(value or "construction").strip().lower()
    if raw in PAYMENT_PURPOSES:
        return raw
    return "construction"


def is_gst_invoice_linked_payment(notes: str | None, purpose: str | None = None) -> bool:
    if normalize_payment_purpose(purpose) == "gst_invoice":
        return True
    return str(notes or "").lstrip().startswith(GST_INVOICE_PAYMENT_PREFIX)


def split_invoice_paid(
    subtotal: Any,
    tax_amount: Any,
    paid_amount: Any,
    total_amount: Any,
    discount_amount: Any = 0,
) -> tuple[float, float]:
    """Allocate invoice collections between taxable value and GST."""
    paid = max(_to_float(paid_amount), 0.0)
    sub = max(_to_float(subtotal), 0.0)
    tax = max(_to_float(tax_amount), 0.0)
    disc = max(_to_float(discount_amount), 0.0)
    tot = max(_to_float(total_amount), 0.0)
    if tot > 0:
        paid = min(paid, tot)
    taxable_base = max(sub - disc, 0.0)
    base = taxable_base + tax
    if paid <= 0:
        return 0.0, 0.0
    if base <= 0:
        return round(paid, 2), 0.0
    taxable_paid = paid * (taxable_base / base)
    gst_paid = paid * (tax / base)
    return round(taxable_paid, 2), round(gst_paid, 2)


NEW_CLIENT_GST_PERCENT = 5.0
NEW_CLIENT_REG_UPTO_50L = 5_000_000.0
NEW_CLIENT_REG_UPTO_3CR = 30_000_000.0
NEW_CLIENT_REG_UPTO_50L_PERCENT = 6.0
NEW_CLIENT_REG_UPTO_3CR_PERCENT = 7.0
NEW_CLIENT_REG_ABOVE_3CR_PERCENT = 9.0


def calculate_gst_payable(composite_value: Any, land_factor: Any, saleable_area: Any, gst_percent: Any) -> float:
    return round(
        _to_float(composite_value) * _to_float(land_factor) * _to_float(saleable_area) * (_to_float(gst_percent) / 100.0),
        2,
    )


def calculate_registration_payable(construction_cost: Any, saleable_area: Any, registration_percent: Any) -> float:
    return round(
        _to_float(construction_cost) * _to_float(saleable_area) * (_to_float(registration_percent) / 100.0),
        2,
    )


def calculate_percent_of_amount(amount: Any, percent: Any) -> float:
    return round(_to_float(amount) * (_to_float(percent) / 100.0), 2)


def resolve_gst_percent(charges: Any, is_existing_shareholder: bool) -> float:
    if is_existing_shareholder:
        return _to_float(getattr(charges, "gst_percent", 5))
    return _to_float(getattr(charges, "new_gst_percent", NEW_CLIENT_GST_PERCENT))


def resolve_new_client_registration_percent(charges: Any, payable_amount: Any) -> float:
    amount = _to_float(payable_amount)
    if amount <= NEW_CLIENT_REG_UPTO_50L:
        return _to_float(getattr(charges, "new_reg_upto_50l_percent", NEW_CLIENT_REG_UPTO_50L_PERCENT))
    if amount <= NEW_CLIENT_REG_UPTO_3CR:
        return _to_float(getattr(charges, "new_reg_upto_3cr_percent", NEW_CLIENT_REG_UPTO_3CR_PERCENT))
    return _to_float(getattr(charges, "new_reg_above_3cr_percent", NEW_CLIENT_REG_ABOVE_3CR_PERCENT))


def resolve_registration_percent(charges: Any, is_existing_shareholder: bool, payable_amount: Any = 0) -> float:
    if is_existing_shareholder:
        return _to_float(getattr(charges, "registration_value_percent", 4))
    return resolve_new_client_registration_percent(charges, payable_amount)


def shareholder_charge_paid_maps(
    payments: Iterable[Any],
    bills: Iterable[Any],
) -> tuple[dict[int, float], dict[int, float], dict[int, float], dict[int, float]]:
    """Construction paid includes GST-invoice taxable collections, not the GST itself."""
    construction: dict[int, float] = defaultdict(float)
    gst: dict[int, float] = defaultdict(float)
    registration: dict[int, float] = defaultdict(float)
    legal: dict[int, float] = defaultdict(float)

    for bill in bills:
        shareholder_id = getattr(bill, "shareholder_id", None)
        if not shareholder_id:
            continue
        taxable_paid, gst_paid = split_invoice_paid(
            getattr(bill, "subtotal", 0),
            getattr(bill, "tax_amount", 0),
            getattr(bill, "paid_amount", 0),
            getattr(bill, "total_amount", 0),
            getattr(bill, "discount_amount", 0),
        )
        construction[int(shareholder_id)] += 0 if getattr(bill, "gst_only", False) else taxable_paid
        gst[int(shareholder_id)] += gst_paid

    for payment in payments:
        shareholder_id = getattr(payment, "shareholder_id", None)
        if not shareholder_id:
            continue
        purpose = normalize_payment_purpose(getattr(payment, "purpose", None))
        if is_gst_invoice_linked_payment(getattr(payment, "notes", None), purpose):
            continue
        amount = _to_float(getattr(payment, "amount", 0))
        key = int(shareholder_id)
        if purpose == "gst":
            gst[key] += amount
        elif purpose == "registration":
            registration[key] += amount
        elif purpose == "legal":
            legal[key] += amount
        else:
            construction[key] += amount

    return construction, gst, registration, legal
