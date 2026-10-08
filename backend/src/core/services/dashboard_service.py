from collections import defaultdict
import calendar
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, case, func, literal, select, union_all
from sqlalchemy.orm import Session

from src.core.services.calculation_service import shareholder_charge_paid_maps
from src.data.models.postgres.bill import Bill
from src.data.models.postgres.enums import PaymentStatus, ProjectStatus
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_milestone import ProjectMilestone
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.shareholder_payment_schedule import ShareholderPaymentSchedule
from src.data.models.postgres.site_expense import SiteExpense
from src.data.models.postgres.vendor_master import VendorMaster
from src.data.models.postgres.vendor_transaction import VendorTransaction
from src.schemas.dashboard import (
    CostBreakdownItem,
    DashboardCard,
    DashboardAlertItem,
    DashboardResponse,
    MonthlyCashflowItem,
    OverdueAgingItem,
    OverduePaymentItem,
    ProjectMonthlyCashflowItem,
    ProjectHealthItem,
    ShareholderRiskItem,
    StatusDistributionItem,
    CalendarTransactionItem,
    CalendarDaySummary,
    DashboardCalendarResponse,
)


def _to_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _month_expr(column):
    return func.date_trunc("month", column)


def _enum_value(value) -> str:
    if value is None:
        return ""
    return value.value if hasattr(value, "value") else str(value)


def build_dashboard(db: Session) -> DashboardResponse:
    project_rows = (
        db.query(
            Project.id.label("project_id"),
            Project.project_name.label("project_name"),
            Project.status.label("status"),
            Project.client_id.label("client_id"),
            Project.construction_sqft.label("construction_sqft"),
            Project.construction_rate_per_sqft.label("construction_rate_per_sqft"),
            Project.estimated_cost.label("estimated_cost"),
            Project.created_at.label("created_at"),
            case(
                (
                    Project.construction_sqft * Project.construction_rate_per_sqft > 0,
                    Project.construction_sqft * Project.construction_rate_per_sqft
                ),
                else_=func.coalesce(func.sum(ProjectShareholder.due_amount), 0)
            ).label("total_amount"),
        )
        .outerjoin(
            ProjectShareholder,
            and_(
                ProjectShareholder.project_id == Project.id,
                ProjectShareholder.deleted_at == None,
            ),
        )
        .filter(Project.deleted_at == None)
        .group_by(
            Project.id,
            Project.project_name,
            Project.status,
            Project.client_id,
            Project.construction_sqft,
            Project.construction_rate_per_sqft,
            Project.estimated_cost,
            Project.created_at,
        )
        .order_by(Project.created_at.desc())
        .all()
    )

    if not project_rows:
        return DashboardResponse(
            cards=[],
            monthly_cashflow=[],
            monthly_cashflow_by_project=[],
            cost_breakdown=[],
            status_distribution=[],
            overdue_aging=[],
            overdue_payments=[],
            project_health=[],
            shareholder_risks=[],
            alerts=[],
        )

    active_project_ids = [project.project_id for project in project_rows]
    construction_paid_map, _, _, _ = shareholder_charge_paid_maps(
        db.query(ShareholderPayment).filter(ShareholderPayment.deleted_at == None, ShareholderPayment.project_id.in_(active_project_ids)).all(),
        db.query(Bill).filter(Bill.deleted_at == None, Bill.project_id.in_(active_project_ids)).all(),
    )
    construction_by_project: dict[int, float] = defaultdict(float)
    for shareholder_id, project_id in (
        db.query(ProjectShareholder.id, ProjectShareholder.project_id)
        .filter(ProjectShareholder.deleted_at == None, ProjectShareholder.project_id.in_(active_project_ids))
        .all()
    ):
        construction_by_project[project_id] += _to_float(construction_paid_map.get(shareholder_id, 0.0))

    labour_amount_expr = case(
        (
            LaborLog.total_wage.is_not(None),
            LaborLog.total_wage,
        ),
        else_=LaborLog.labour_count * LaborLog.wage_per_head + LaborLog.overtime_cost,
    )

    project_amounts = union_all(
        select(
            MaterialLog.project_id.label("project_id"),
            literal("material").label("source"),
            (MaterialLog.quantity * MaterialLog.unit_cost * (1 + func.coalesce(MaterialLog.gst_percent, 0) / 100) + MaterialLog.transport_cost).label("amount"),
        ).where(MaterialLog.deleted_at == None, MaterialLog.project_id.in_(active_project_ids)),
        select(
            LaborLog.project_id.label("project_id"),
            literal("labour").label("source"),
            labour_amount_expr.label("amount"),
        ).where(LaborLog.deleted_at == None, LaborLog.project_id.in_(active_project_ids)),
        select(
            ExpenseLog.project_id.label("project_id"),
            literal("expense").label("source"),
            ExpenseLog.amount.label("amount"),
        ).where(ExpenseLog.deleted_at == None, ExpenseLog.project_id.in_(active_project_ids)),
        select(
            SiteExpense.project_id.label("project_id"),
            literal("expense").label("source"),
            SiteExpense.amount.label("amount"),
        ).where(SiteExpense.allocation == "project", SiteExpense.project_id.in_(active_project_ids)),
    ).subquery()

    project_amount_rows = (
        db.query(
            project_amounts.c.project_id,
            project_amounts.c.source,
            func.coalesce(func.sum(project_amounts.c.amount), 0),
        )
        .group_by(project_amounts.c.project_id, project_amounts.c.source)
        .all()
    )

    received_payment_rows = (
        db.query(PaymentLog.project_id, func.coalesce(func.sum(PaymentLog.amount), 0))
        .filter(
            PaymentLog.status == PaymentStatus.RECEIVED,
            PaymentLog.deleted_at == None,
            PaymentLog.project_id.in_(active_project_ids),
        )
        .group_by(PaymentLog.project_id)
        .all()
    )
    status_distribution = defaultdict(int)
    total_quoted = 0.0
    total_cost = 0.0
    total_received = 0.0
    total_outstanding = 0.0
    project_health: list[ProjectHealthItem] = []

    material_by_project: dict[int, float] = defaultdict(float)
    labour_by_project: dict[int, float] = defaultdict(float)
    expense_by_project: dict[int, float] = defaultdict(float)
    for project_id, source, total in project_amount_rows:
        if source == "material":
            material_by_project[project_id] += _to_float(total)
        elif source == "labour":
            labour_by_project[project_id] += _to_float(total)
        elif source == "expense":
            expense_by_project[project_id] += _to_float(total)
    received_by_project = {project_id: _to_float(total) for project_id, total in received_payment_rows}
    for project_id, total in construction_by_project.items():
        received_by_project[project_id] = received_by_project.get(project_id, 0.0) + total

    for project in project_rows:
        project_id = project.project_id
        total_amount = _to_float(project.total_amount)
        material_cost = material_by_project.get(project_id, 0.0)
        labour_cost = labour_by_project.get(project_id, 0.0)
        expense_cost = expense_by_project.get(project_id, 0.0)
        cost = round(material_cost + labour_cost + expense_cost, 2)
        received = received_by_project.get(project_id, 0.0)
        outstanding = round(total_amount - received, 2)
        profit_projection = total_amount - cost
        profit_margin_pct = (profit_projection / total_amount * 100) if total_amount > 0 else 0.0
        collection_eff = (received / total_amount * 100) if total_amount > 0 else 0.0
        cost_to_quote_pct = (cost / total_amount * 100) if total_amount > 0 else 0.0

        status_distribution[_enum_value(project.status)] += 1
        total_quoted += total_amount
        total_cost += cost
        total_received += received
        total_outstanding += outstanding

        project_health.append(
            ProjectHealthItem(
                project_id=project_id,
                project_name=project.project_name,
                status=_enum_value(project.status),
                construction_sqft=round(_to_float(project.construction_sqft), 2),
                construction_rate_per_sqft=round(_to_float(project.construction_rate_per_sqft), 2),
                estimated_cost=round(_to_float(project.estimated_cost), 2),
                total_amount=round(total_amount, 2),
                total_cost=round(cost, 2),
                total_received=round(received, 2),
                outstanding=round(outstanding, 2),
                profit_projection=round(profit_projection, 2),
                profit_margin_pct=round(profit_margin_pct, 2),
                collection_efficiency_pct=round(collection_eff, 2),
                cost_to_quote_pct=round(cost_to_quote_pct, 2),
            )
        )

    project_health.sort(key=lambda row: row.outstanding, reverse=True)
    active_projects = [project for project in project_rows if project.status == ProjectStatus.ONGOING]

    material_total = sum(material_by_project.values())
    labour_total = sum(labour_by_project.values())
    expense_total = sum(expense_by_project.values())
    cost_grand_total = material_total + labour_total + expense_total

    outflow_by_month: dict[str, float] = defaultdict(float)
    expense_month_expr = _month_expr(ExpenseLog.date)
    site_expense_month_expr = _month_expr(SiteExpense.date)
    material_month_expr = _month_expr(MaterialLog.date)
    labour_month_expr = _month_expr(LaborLog.date)
    payment_month_expr = _month_expr(PaymentLog.received_date)

    outflow_amounts = union_all(
        select(ExpenseLog.project_id.label("project_id"), expense_month_expr.label("month"), ExpenseLog.amount.label("amount")).where(
            ExpenseLog.deleted_at == None,
            ExpenseLog.project_id.in_(active_project_ids),
        ),
        select(
            MaterialLog.project_id.label("project_id"),
            material_month_expr.label("month"),
            (MaterialLog.quantity * MaterialLog.unit_cost * (1 + func.coalesce(MaterialLog.gst_percent, 0) / 100) + MaterialLog.transport_cost).label("amount"),
        ).where(MaterialLog.deleted_at == None, MaterialLog.project_id.in_(active_project_ids)),
        select(LaborLog.project_id.label("project_id"), labour_month_expr.label("month"), labour_amount_expr.label("amount")).where(
            LaborLog.deleted_at == None,
            LaborLog.project_id.in_(active_project_ids),
        ),
        select(
            SiteExpense.project_id.label("project_id"),
            site_expense_month_expr.label("month"),
            SiteExpense.amount.label("amount"),
        ).where(SiteExpense.allocation == "project", SiteExpense.project_id.in_(active_project_ids)),
    ).subquery()
    outflow_month_rows = (
        db.query(outflow_amounts.c.month, func.coalesce(func.sum(outflow_amounts.c.amount), 0))
        .group_by(outflow_amounts.c.month)
        .all()
    )
    for month, amount in outflow_month_rows:
        if month:
            outflow_by_month[month.strftime("%Y-%m")] += _to_float(amount)

    inflow_by_month: dict[str, float] = defaultdict(float)
    inflow_amounts = union_all(
        select(payment_month_expr.label("month"), PaymentLog.amount.label("amount")).where(
            PaymentLog.status == PaymentStatus.RECEIVED,
            PaymentLog.received_date.is_not(None),
            PaymentLog.deleted_at == None,
            PaymentLog.project_id.in_(active_project_ids),
        ),
        select(
            _month_expr(ShareholderPayment.payment_date).label("month"),
            ShareholderPayment.amount.label("amount"),
        ).where(ShareholderPayment.deleted_at == None, ShareholderPayment.project_id.in_(active_project_ids)),
    ).subquery()
    payment_month_rows = (
        db.query(inflow_amounts.c.month, func.coalesce(func.sum(inflow_amounts.c.amount), 0))
        .group_by(inflow_amounts.c.month)
        .all()
    )
    for month, amount in payment_month_rows:
        if month:
            inflow_by_month[month.strftime("%Y-%m")] += _to_float(amount)

    all_months = sorted(set(outflow_by_month.keys()) | set(inflow_by_month.keys()))
    monthly_cashflow = [
        MonthlyCashflowItem(
            month=month,
            inflow=round(inflow_by_month.get(month, 0.0), 2),
            outflow=round(outflow_by_month.get(month, 0.0), 2),
            net=round(inflow_by_month.get(month, 0.0) - outflow_by_month.get(month, 0.0), 2),
        )
        for month in all_months
    ]

    project_name_by_id = {project.project_id: project.project_name for project in project_rows}
    outflow_by_project_month: dict[tuple[int, str], float] = defaultdict(float)
    outflow_project_amounts = union_all(
        select(
            MaterialLog.project_id.label("project_id"),
            material_month_expr.label("month"),
            (MaterialLog.quantity * MaterialLog.unit_cost * (1 + func.coalesce(MaterialLog.gst_percent, 0) / 100) + MaterialLog.transport_cost).label("amount"),
        ).where(MaterialLog.deleted_at == None, MaterialLog.project_id.in_(active_project_ids)),
        select(LaborLog.project_id.label("project_id"), labour_month_expr.label("month"), labour_amount_expr.label("amount")).where(
            LaborLog.deleted_at == None,
            LaborLog.project_id.in_(active_project_ids),
        ),
        select(ExpenseLog.project_id.label("project_id"), expense_month_expr.label("month"), ExpenseLog.amount.label("amount")).where(
            ExpenseLog.deleted_at == None,
            ExpenseLog.project_id.in_(active_project_ids),
        ),
        select(
            SiteExpense.project_id.label("project_id"),
            site_expense_month_expr.label("month"),
            SiteExpense.amount.label("amount"),
        ).where(SiteExpense.allocation == "project", SiteExpense.project_id.in_(active_project_ids)),
    ).subquery()
    outflow_project_month_rows = (
        db.query(
            outflow_project_amounts.c.project_id,
            outflow_project_amounts.c.month,
            func.coalesce(func.sum(outflow_project_amounts.c.amount), 0),
        )
        .group_by(outflow_project_amounts.c.project_id, outflow_project_amounts.c.month)
        .all()
    )
    for project_id, month, amount in outflow_project_month_rows:
        if month:
            outflow_by_project_month[(project_id, month.strftime("%Y-%m"))] += _to_float(amount)

    inflow_by_project_month: dict[tuple[int, str], float] = defaultdict(float)
    inflow_project_amounts = union_all(
        select(PaymentLog.project_id.label("project_id"), payment_month_expr.label("month"), PaymentLog.amount.label("amount")).where(
            PaymentLog.status == PaymentStatus.RECEIVED,
            PaymentLog.received_date.is_not(None),
            PaymentLog.deleted_at == None,
            PaymentLog.project_id.in_(active_project_ids),
        ),
        select(
            ShareholderPayment.project_id.label("project_id"),
            _month_expr(ShareholderPayment.payment_date).label("month"),
            ShareholderPayment.amount.label("amount"),
        ).where(ShareholderPayment.deleted_at == None, ShareholderPayment.project_id.in_(active_project_ids)),
    ).subquery()
    inflow_project_month_rows = (
        db.query(
            inflow_project_amounts.c.project_id,
            inflow_project_amounts.c.month,
            func.coalesce(func.sum(inflow_project_amounts.c.amount), 0),
        )
        .group_by(inflow_project_amounts.c.project_id, inflow_project_amounts.c.month)
        .all()
    )
    for project_id, month, amount in inflow_project_month_rows:
        if month:
            inflow_by_project_month[(project_id, month.strftime("%Y-%m"))] += _to_float(amount)

    project_month_keys = sorted(set(outflow_by_project_month.keys()) | set(inflow_by_project_month.keys()))
    monthly_cashflow_by_project = [
        ProjectMonthlyCashflowItem(
            project_id=project_id,
            project_name=project_name_by_id.get(project_id, f"Project #{project_id}"),
            month=month,
            inflow=round(inflow_by_project_month.get((project_id, month), 0.0), 2),
            outflow=round(outflow_by_project_month.get((project_id, month), 0.0), 2),
            net=round(
                inflow_by_project_month.get((project_id, month), 0.0)
                - outflow_by_project_month.get((project_id, month), 0.0),
                2,
            ),
        )
        for project_id, month in project_month_keys
    ]

    cost_breakdown = [
        CostBreakdownItem(
            category=label,
            amount=round(amount, 2),
            share_pct=round((amount / cost_grand_total * 100) if cost_grand_total > 0 else 0.0, 2),
        )
        for label, amount in (
            ("Materials", material_total),
            ("Labour", labour_total),
            ("Expenses", expense_total),
        )
    ]

    today = date.today()
    overdue_aging_raw: dict[str, dict[str, float | int]] = {
        "0-30 days": {"count": 0, "amount": 0.0},
        "31-60 days": {"count": 0, "amount": 0.0},
        "61-90 days": {"count": 0, "amount": 0.0},
        "90+ days": {"count": 0, "amount": 0.0},
    }
    overdue_rows: list[OverduePaymentItem] = []
    overdue_payment_rows = (
        db.query(
            PaymentLog.id,
            PaymentLog.project_id,
            Project.project_name,
            PaymentLog.payment_type,
            PaymentLog.due_date,
            PaymentLog.amount,
            PaymentLog.status,
        )
        .join(Project, Project.id == PaymentLog.project_id)
        .filter(
            PaymentLog.deleted_at == None,
            Project.deleted_at == None,
            PaymentLog.due_date.is_not(None),
            PaymentLog.received_date.is_(None),
            PaymentLog.due_date < today,
        )
        .order_by(PaymentLog.due_date.asc(), PaymentLog.id.desc())
        .all()
    )
    for payment_id, project_id, project_name, payment_type, due_date, amount, status in overdue_payment_rows:
        if not due_date:
            continue
        days = (today - due_date).days
        amount_value = _to_float(amount)
        if days <= 30:
            bucket = "0-30 days"
        elif days <= 60:
            bucket = "31-60 days"
        elif days <= 90:
            bucket = "61-90 days"
        else:
            bucket = "90+ days"
        overdue_aging_raw[bucket]["count"] = int(overdue_aging_raw[bucket]["count"]) + 1
        overdue_aging_raw[bucket]["amount"] = float(overdue_aging_raw[bucket]["amount"]) + amount_value
        overdue_rows.append(
            OverduePaymentItem(
                payment_id=payment_id,
                project_id=project_id,
                project_name=project_name,
                payment_type=_enum_value(payment_type),
                due_date=due_date.isoformat() if due_date else None,
                amount=round(amount_value, 2),
                status=_enum_value(status),
                days_overdue=days,
            )
        )
    overdue_rows.sort(key=lambda row: row.days_overdue, reverse=True)

    schedule_rows = (
        db.query(
            ShareholderPaymentSchedule.id,
            ShareholderPaymentSchedule.project_id,
            Project.project_name,
            ProjectShareholder.id.label("shareholder_id"),
            ProjectShareholder.name.label("shareholder_name"),
            ShareholderPaymentSchedule.installment_no,
            ShareholderPaymentSchedule.due_date,
            ShareholderPaymentSchedule.amount,
        )
        .join(Project, Project.id == ShareholderPaymentSchedule.project_id)
        .join(ProjectShareholder, ProjectShareholder.id == ShareholderPaymentSchedule.shareholder_id)
        .filter(
            ShareholderPaymentSchedule.deleted_at == None,
            ProjectShareholder.deleted_at == None,
            Project.deleted_at == None,
            ShareholderPaymentSchedule.due_date < today,
        )
        .order_by(
            ShareholderPaymentSchedule.shareholder_id.asc(),
            ShareholderPaymentSchedule.due_date.asc(),
            ShareholderPaymentSchedule.installment_no.asc(),
        )
        .all()
    )
    paid_remaining_by_shareholder = {shareholder_id: _to_float(total) for shareholder_id, total in construction_paid_map.items()}
    for row in schedule_rows:
        amount_value = _to_float(row.amount)
        paid_available = paid_remaining_by_shareholder.get(row.shareholder_id, 0.0)
        paid_amount = min(amount_value, max(paid_available, 0.0))
        paid_remaining_by_shareholder[row.shareholder_id] = max(paid_available - amount_value, 0.0)
        balance_amount = max(amount_value - paid_amount, 0.0)
        if balance_amount <= 0:
            continue
        days = (today - row.due_date).days
        if days <= 30:
            bucket = "0-30 days"
        elif days <= 60:
            bucket = "31-60 days"
        elif days <= 90:
            bucket = "61-90 days"
        else:
            bucket = "90+ days"
        overdue_aging_raw[bucket]["count"] = int(overdue_aging_raw[bucket]["count"]) + 1
        overdue_aging_raw[bucket]["amount"] = float(overdue_aging_raw[bucket]["amount"]) + balance_amount
        overdue_rows.append(
            OverduePaymentItem(
                payment_id=row.id,
                project_id=row.project_id,
                project_name=row.project_name,
                payment_type=f"Client installment {row.installment_no} - {row.shareholder_name}",
                due_date=row.due_date.isoformat(),
                amount=round(balance_amount, 2),
                status="partial_overdue" if paid_amount > 0 else "overdue",
                days_overdue=days,
            )
        )

    overdue_rows.sort(key=lambda row: row.days_overdue, reverse=True)
    overdue_aging = [
        OverdueAgingItem(bucket=bucket, count=int(values["count"]), amount=round(float(values["amount"]), 2))
        for bucket, values in overdue_aging_raw.items()
    ]

    shareholder_rows = (
        db.query(
            ProjectShareholder.id.label("shareholder_id"),
            ProjectShareholder.project_id.label("project_id"),
            Project.project_name.label("project_name"),
            ProjectShareholder.name.label("shareholder_name"),
            ProjectShareholder.company_name.label("company_name"),
            ProjectShareholder.phone.label("phone"),
            ProjectShareholder.address.label("address"),
            ProjectShareholder.due_amount.label("due_amount"),
            func.coalesce(func.sum(ShareholderPayment.amount), 0).label("paid_amount"),
        )
        .join(Project, Project.id == ProjectShareholder.project_id)
        .outerjoin(
            ShareholderPayment,
            and_(
                ShareholderPayment.shareholder_id == ProjectShareholder.id,
                ShareholderPayment.deleted_at == None,
            ),
        )
        .filter(ProjectShareholder.deleted_at == None, Project.deleted_at == None)
        .group_by(
            ProjectShareholder.id,
            ProjectShareholder.project_id,
            Project.project_name,
            ProjectShareholder.name,
            ProjectShareholder.company_name,
            ProjectShareholder.phone,
            ProjectShareholder.address,
            ProjectShareholder.due_amount,
        )
        .all()
    )
    shareholder_risks: list[ShareholderRiskItem] = []
    for row in shareholder_rows:
        due = _to_float(row.due_amount)
        paid = _to_float(construction_paid_map.get(row.shareholder_id, 0.0))
        balance = max(due - paid, 0.0)
        eff = (paid / due * 100) if due > 0 else 0.0
        shareholder_risks.append(
            ShareholderRiskItem(
                shareholder_id=row.shareholder_id,
                project_id=row.project_id,
                project_name=row.project_name,
                shareholder_name=row.shareholder_name,
                company_name=row.company_name,
                phone=row.phone,
                address=row.address,
                due_amount=round(due, 2),
                paid_amount=round(paid, 2),
                balance_amount=round(balance, 2),
                collection_efficiency_pct=round(eff, 2),
            )
        )
    shareholder_risks.sort(key=lambda row: row.balance_amount, reverse=True)

    alerts: list[DashboardAlertItem] = []
    milestone_rows = (
        db.query(ProjectMilestone, Project.project_name)
        .join(Project, Project.id == ProjectMilestone.project_id)
        .filter(
            ProjectMilestone.deleted_at == None,
            ProjectMilestone.status != "completed",
            Project.deleted_at == None,
            Project.status.in_([ProjectStatus.ONGOING, ProjectStatus.UPCOMING]),
        )
        .order_by(ProjectMilestone.milestone_date.asc(), ProjectMilestone.id.asc())
        .all()
    )
    for milestone, project_name in milestone_rows:
        days = (milestone.milestone_date - today).days
        if days < 0:
            alerts.append(
                DashboardAlertItem(
                    severity="high",
                    title=f"Milestone overdue: {milestone.title}",
                    detail=f"{project_name}: due {abs(days)} day(s) ago",
                    project_id=milestone.project_id,
                    route="/milestones",
                )
            )
        elif days == 0:
            alerts.append(
                DashboardAlertItem(
                    severity="high",
                    title=f"Today: {milestone.title}",
                    detail=f"{project_name}: milestone is due today",
                    project_id=milestone.project_id,
                    route="/milestones",
                )
            )
        elif days <= 7:
            alerts.append(
                DashboardAlertItem(
                    severity="medium" if days > 2 else "high",
                    title=f"Milestone approaching: {milestone.title}",
                    detail=f"{project_name}: {days} day(s) remaining",
                    project_id=milestone.project_id,
                    route="/milestones",
                )
            )
    for row in project_health[:]:
        if row.cost_to_quote_pct > 80 and row.collection_efficiency_pct < 50:
            alerts.append(
                DashboardAlertItem(
                    severity="high",
                    title="High spend, low collection",
                    detail=f"{row.project_name}: Cost at {row.cost_to_quote_pct:.1f}% while collection only {row.collection_efficiency_pct:.1f}%",
                    project_id=row.project_id,
                    route=f"/projects?projectId={row.project_id}",
                )
            )
        if row.outstanding > row.total_amount * 0.5:
            alerts.append(
                DashboardAlertItem(
                    severity="medium",
                    title="Outstanding above 50%",
                    detail=f"{row.project_name}: Outstanding {row.outstanding:,.0f} ({(row.outstanding / row.total_amount * 100) if row.total_amount else 0:.1f}%)",
                    project_id=row.project_id,
                    route="/clients",
                )
            )
    if monthly_cashflow:
        latest = monthly_cashflow[-1]
        if latest.net < 0:
            alerts.append(
                DashboardAlertItem(
                    severity="high",
                    title="Negative monthly cashflow",
                    detail=f"{latest.month}: Net cashflow is {latest.net:,.0f}",
                    route="/payments",
                )
            )

    return DashboardResponse(
        cards=[
            DashboardCard(label="Total Active Projects", value=len(active_projects)),
            DashboardCard(label="Portfolio Quoted", value=round(total_quoted, 2)),
            DashboardCard(label="Total Cost", value=round(total_cost, 2)),
            DashboardCard(label="Total Received", value=round(total_received, 2)),
            DashboardCard(label="Outstanding", value=round(total_outstanding, 2)),
            DashboardCard(
                label="Collection Efficiency %",
                value=round((total_received / total_quoted * 100) if total_quoted > 0 else 0.0, 2),
            ),
        ],
        monthly_cashflow=monthly_cashflow,
        monthly_cashflow_by_project=monthly_cashflow_by_project,
        cost_breakdown=cost_breakdown,
        status_distribution=[
            StatusDistributionItem(status=status, count=count)
            for status, count in sorted(status_distribution.items(), key=lambda item: item[0])
        ],
        overdue_aging=overdue_aging,
        overdue_payments=overdue_rows[:15],
        project_health=project_health,
        shareholder_risks=shareholder_risks[:20],
        alerts=alerts[:12],
    )


def build_dashboard_calendar(db: Session, month_str: str | None = None) -> DashboardCalendarResponse:
    # 1. Parse Year & Month
    if not month_str:
        today = date.today()
        year = today.year
        month = today.month
    else:
        try:
            parts = month_str.split("-")
            year = int(parts[0])
            month = int(parts[1])
        except Exception:
            today = date.today()
            year = today.year
            month = today.month

    _, last_day = calendar.monthrange(year, month)
    start_date = date(year, month, 1)
    end_date = date(year, month, last_day)
    resolved_month_str = f"{year:04d}-{month:02d}"

    # 2. Initialize Calendar Days
    days_data = {}
    for d in range(1, last_day + 1):
        date_str = f"{year:04d}-{month:02d}-{d:02d}"
        days_data[date_str] = {
            "date": date_str,
            "spent": 0.0,
            "received": 0.0,
            "transactions": []
        }

    # 3. Query Transactions
    # A. Material logs
    materials = (
        db.query(MaterialLog, Project.project_name)
        .join(Project, Project.id == MaterialLog.project_id)
        .filter(MaterialLog.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(MaterialLog.date >= start_date)
        .filter(MaterialLog.date <= end_date)
        .all()
    )
    for log, project_name in materials:
        qty = float(log.quantity or 0)
        cost = float(log.unit_cost or 0)
        gst = float(log.gst_percent or 0)
        trans = float(log.transport_cost or 0)
        amount = round(qty * cost * (1 + gst / 100) + trans, 2)
        date_key = log.date.strftime("%Y-%m-%d")

        if date_key in days_data:
            detail = f"{qty} {log.unit or ''} @ {cost:,.2f}"
            if log.supplier:
                detail += f" | {log.supplier}"

            days_data[date_key]["spent"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"material-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="spent",
                    type="Material",
                    title=log.material_name or "Material",
                    amount=amount,
                    detail=detail
                )
            )

    # B. Labor logs
    labor = (
        db.query(LaborLog, Project.project_name)
        .join(Project, Project.id == LaborLog.project_id)
        .filter(LaborLog.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(LaborLog.date >= start_date)
        .filter(LaborLog.date <= end_date)
        .all()
    )
    for log, project_name in labor:
        if log.total_wage is not None:
            amount = float(log.total_wage)
        else:
            amount = float((log.labour_count or 0) * (log.wage_per_head or 0) + (log.overtime_cost or 0))
        amount = round(amount, 2)
        date_key = log.date.strftime("%Y-%m-%d")

        if date_key in days_data:
            detail = f"{log.labour_count or 0} head @ {float(log.wage_per_head or 0):,.2f}"
            if log.remarks:
                detail += f" | {log.remarks}"

            days_data[date_key]["spent"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"labour-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="spent",
                    type="Labour",
                    title=log.labour_type or "Labour Logs",
                    amount=amount,
                    detail=detail
                )
            )

    # C. Site Expenses
    expenses = (
        db.query(ExpenseLog, Project.project_name)
        .join(Project, Project.id == ExpenseLog.project_id)
        .filter(ExpenseLog.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(ExpenseLog.date >= start_date)
        .filter(ExpenseLog.date <= end_date)
        .all()
    )
    for log, project_name in expenses:
        amount = round(float(log.amount or 0), 2)
        date_key = log.date.strftime("%Y-%m-%d")

        if date_key in days_data:
            days_data[date_key]["spent"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"expense-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="spent",
                    type="Expense",
                    title=log.category or "Site Expense",
                    amount=amount,
                    detail=log.description or "Site expense log"
                )
            )

    site_expenses = (
        db.query(SiteExpense, Project.project_name)
        .join(Project, Project.id == SiteExpense.project_id)
        .filter(SiteExpense.allocation == "project")
        .filter(Project.deleted_at == None)
        .filter(SiteExpense.date >= start_date)
        .filter(SiteExpense.date <= end_date)
        .all()
    )
    for log, project_name in site_expenses:
        amount = round(float(log.amount or 0), 2)
        date_key = log.date.strftime("%Y-%m-%d")

        if date_key in days_data:
            days_data[date_key]["spent"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"site-expense-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="spent",
                    type="Expense",
                    title=log.item_name or log.category or "Site Expense",
                    amount=amount,
                    detail=log.description or "Site expense"
                )
            )

    # D. Client Receipts (PaymentLog)
    client_receipts = (
        db.query(PaymentLog, Project.project_name)
        .join(Project, Project.id == PaymentLog.project_id)
        .filter(PaymentLog.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(PaymentLog.status == PaymentStatus.RECEIVED)
        .filter(PaymentLog.received_date >= start_date)
        .filter(PaymentLog.received_date <= end_date)
        .all()
    )
    for log, project_name in client_receipts:
        amount = round(float(log.amount or 0), 2)
        if log.received_date:
            date_key = log.received_date.strftime("%Y-%m-%d")
            if date_key in days_data:
                days_data[date_key]["received"] += amount
                days_data[date_key]["transactions"].append(
                    CalendarTransactionItem(
                        id=f"payment-{log.id}",
                        project_id=log.project_id,
                        project_name=project_name,
                        date=date_key,
                        direction="received",
                        type="Client Receipt",
                        title=f"{log.payment_type or 'Client'} payment",
                        amount=amount,
                        detail=log.payment_mode or log.notes or "Client payment received"
                    )
                )

    # E. Shareholder Receipts (ShareholderPayment)
    shareholder_receipts = (
        db.query(ShareholderPayment, Project.project_name, ProjectShareholder.name)
        .join(Project, Project.id == ShareholderPayment.project_id)
        .join(ProjectShareholder, ProjectShareholder.id == ShareholderPayment.shareholder_id)
        .filter(ShareholderPayment.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(ProjectShareholder.deleted_at == None)
        .filter(ShareholderPayment.payment_date >= start_date)
        .filter(ShareholderPayment.payment_date <= end_date)
        .all()
    )
    for log, project_name, shareholder_name in shareholder_receipts:
        amount = round(float(log.amount or 0), 2)
        date_key = log.payment_date.strftime("%Y-%m-%d")

        if date_key in days_data:
            days_data[date_key]["received"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"shareholder-payment-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="received",
                    type="Shareholder Receipt",
                    title=shareholder_name or "Shareholder Payment",
                    amount=amount,
                    detail=log.payment_mode or log.notes or "JV shareholder payment"
                )
            )

    # F. Vendor Payments (VendorTransaction)
    vendor_payments = (
        db.query(VendorTransaction, Project.project_name, VendorMaster.name)
        .join(Project, Project.id == VendorTransaction.project_id)
        .join(VendorMaster, VendorMaster.id == VendorTransaction.vendor_id)
        .filter(VendorTransaction.deleted_at == None)
        .filter(Project.deleted_at == None)
        .filter(VendorTransaction.payment_date >= start_date)
        .filter(VendorTransaction.payment_date <= end_date)
        .all()
    )
    for log, project_name, vendor_name in vendor_payments:
        amount = round(float(log.amount or 0) + float(log.round_off or 0), 2)
        date_key = log.payment_date.strftime("%Y-%m-%d")

        if date_key in days_data:
            days_data[date_key]["spent"] += amount
            days_data[date_key]["transactions"].append(
                CalendarTransactionItem(
                    id=f"vendor-payment-{log.id}",
                    project_id=log.project_id,
                    project_name=project_name,
                    date=date_key,
                    direction="spent",
                    type="Vendor Payment",
                    title=vendor_name or "Vendor Payment",
                    amount=amount,
                    detail=log.payment_mode or log.notes or "Vendor payment"
                )
            )

    # 4. Formulate Response Days and Totals
    days_list = []
    total_spent = 0.0
    total_received = 0.0

    for d in sorted(days_data.keys()):
        day = days_data[d]
        # Round day spent and received
        day["spent"] = round(day["spent"], 2)
        day["received"] = round(day["received"], 2)
        # Sort day transactions by type and amount
        day["transactions"].sort(key=lambda t: (t.direction, t.type, -t.amount))

        total_spent += day["spent"]
        total_received += day["received"]

        days_list.append(
            CalendarDaySummary(
                date=day["date"],
                spent=day["spent"],
                received=day["received"],
                transactions=day["transactions"]
            )
        )

    totals = {
        "spent": round(total_spent, 2),
        "received": round(total_received, 2),
        "balance": round(total_received - total_spent, 2)
    }

    return DashboardCalendarResponse(
        month=resolved_month_str,
        days=days_list,
        totals=totals
    )

