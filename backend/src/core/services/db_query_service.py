from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
import re
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.core.services.calculation_service import (
    calculate_labour_cost,
    calculate_material_cost,
    calculate_other_expenses,
    calculate_outstanding,
    calculate_project_total_amount,
    calculate_total_cost,
    calculate_total_received,
    shareholder_charge_paid_maps,
)
from src.data.models.postgres.bill import Bill
from src.data.models.postgres.enums import PaymentStatus, UserRole
from src.core.permissions import ADMIN_ROLES
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.labor_log import LaborLog
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.material_master import MaterialMaster
from src.data.models.postgres.office_expense import OfficeExpense
from src.data.models.postgres.payment_log import PaymentLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_shareholder import ProjectShareholder
from src.data.models.postgres.shareholder_payment import ShareholderPayment
from src.data.models.postgres.vendor_master import VendorMaster
from src.data.models.postgres.vendor_transaction import VendorTransaction
from src.data.models.postgres.user import User
from src.prompts.system_prompt import SAMPLE_PROMPTS
from src.schemas.chat import AIChatAction, AIChatResponse, ChatIntentExtraction
from src.core.permissions import is_project_operator


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _enum_value(value: Any) -> str:
    return getattr(value, "value", str(value))


def _slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    return re.sub(r"[\s_-]+", "-", s).strip("-") or "project"


class DBQueryService:
    """Read-only, allow-listed query service for AI Search & Navigation Assistant.

    Every handler uses SQLAlchemy ORM queries and receives a validated intent
    object. The LLM output is never executed as SQL.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.intent_registry: dict[str, Callable[[ChatIntentExtraction, User], AIChatResponse]] = {
            "material_usage_report": self.material_usage_report,
            "project_summary": self.project_summary,
            "pending_payments": self.pending_payments,
            "labour_attendance": self.labour_attendance,
            "inventory_stock": self.inventory_stock,
            "site_expenses": self.site_expenses,
            "office_expenses": self.office_expenses,
            "customer_details": self.customer_details,
            "invoice_reports": self.invoice_reports,
            "vendor_summary": self.vendor_summary,
            "navigation_guidance": self.navigation_guidance,
            "workflow_help": self.workflow_help,
            "general_inquiry": self.general_inquiry,
            "help": self.help_response,
        }

    def run(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        if user.role not in (*ADMIN_ROLES, UserRole.CLIENT_MANAGER, UserRole.PROJECT_MANAGER, UserRole.PROJECT_COORDINATOR, UserRole.ACCOUNTANT, UserRole.SUPERVISOR):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        handler = self.intent_registry.get(extraction.intent, self.help_response)
        response = handler(extraction, user)
        response.intent = extraction.intent
        response.filters = extraction.model_dump(exclude_none=True)
        return response

    def _accessible_project_ids(self, user: User) -> list[int]:
        projects = self.db.query(Project).filter(Project.deleted_at == None).all()
        if user.role in (*ADMIN_ROLES, UserRole.CLIENT_MANAGER, UserRole.ACCOUNTANT):
            return [project.id for project in projects]
        if is_project_operator(user):
            return [
                project.id
                for project in projects
                if project.supervisor_id == user.id or any(supervisor.id == user.id for supervisor in project.supervisors)
            ]
        return []

    def _resolve_project(self, project_name: str | None, user: User) -> Project | None:
        if not project_name:
            return None
        project_ids = self._accessible_project_ids(user)
        if not project_ids:
            return None
        query = self.db.query(Project).filter(Project.id.in_(project_ids))
        exact = query.filter(func.lower(Project.project_name) == project_name.lower()).first()
        if exact:
            return exact
        return query.filter(Project.project_name.ilike(f"%{project_name}%")).first()

    def _date_bounds(self, extraction: ChatIntentExtraction) -> tuple[date | None, date | None]:
        today = date.today()
        if extraction.date_range == "today":
            return today, today
        if extraction.date_range == "this_week":
            start = today - timedelta(days=today.weekday())
            return start, start + timedelta(days=6)
        if extraction.date_range == "this_month":
            return today.replace(day=1), today
        if extraction.date_range == "last_month":
            first_this_month = today.replace(day=1)
            last_month_end = first_this_month - timedelta(days=1)
            return last_month_end.replace(day=1), last_month_end
        if extraction.date_range == "this_year":
            return today.replace(month=1, day=1), today
        if extraction.date_range == "custom" and extraction.start_date and extraction.end_date:
            return date.fromisoformat(extraction.start_date), date.fromisoformat(extraction.end_date)
        return None, None

    def _apply_project_and_dates(self, query: Any, model: Any, extraction: ChatIntentExtraction, user: User) -> Any:
        project_ids = self._accessible_project_ids(user)
        if not project_ids:
            return query.filter(model.project_id == -1)
        query = query.filter(model.project_id.in_(project_ids), model.deleted_at == None)
        project = self._resolve_project(extraction.project_name, user)
        if project:
            query = query.filter(model.project_id == project.id)
        start, end = self._date_bounds(extraction)
        if start:
            query = query.filter(model.date >= start)
        if end:
            query = query.filter(model.date <= end)
        return query

    def material_usage_report(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(MaterialLog, Project).join(Project, MaterialLog.project_id == Project.id)
        query = self._apply_project_and_dates(query, MaterialLog, extraction, user)
        if extraction.material_name:
            query = query.filter(MaterialLog.material_name.ilike(f"%{extraction.material_name}%"))
        if extraction.supplier_name:
            query = query.filter(MaterialLog.supplier.ilike(f"%{extraction.supplier_name}%"))
        rows = query.order_by(MaterialLog.date.desc(), MaterialLog.id.desc()).limit(extraction.limit).all()
        table_rows: list[list[Any]] = []
        chart_by_date: dict[str, float] = defaultdict(float)
        chart_by_month: dict[str, float] = defaultdict(float)
        total_amount = 0.0
        qty_by_unit: dict[str, float] = defaultdict(float)
        qty_by_month: dict[str, float] = defaultdict(float)
        for item, project in rows:
            amount = _to_float(item.quantity) * _to_float(item.unit_cost) * (1 + _to_float(item.gst_percent) / 100) + _to_float(item.transport_cost)
            total_amount += amount
            qty_by_unit[item.unit] += _to_float(item.quantity)
            date_key = item.date.isoformat()
            month_key = item.date.strftime("%Y-%m")
            chart_by_date[date_key] += amount
            chart_by_month[month_key] += amount
            qty_by_month[month_key] += _to_float(item.quantity)
            table_rows.append([
                date_key,
                project.project_name,
                item.material_name,
                item.supplier or "-",
                _to_float(item.quantity),
                item.unit,
                _to_float(item.unit_cost),
                round(amount, 2),
            ])
        qty_summary = ", ".join(f"{round(qty, 2):g} {unit}" for unit, qty in qty_by_unit.items()) or "0"
        title = f"{extraction.material_name.title()} Usage" if extraction.material_name else "Material Usage Report"
        summary_prefix = (
            f"Supplier: {extraction.supplier_name}. " if extraction.supplier_name else ""
        )
        if extraction.group_by == "month":
            if extraction.output_type == "table":
                month_rows = [
                    [month, round(qty_by_month[month], 2), round(chart_by_month[month], 2)]
                    for month in sorted(chart_by_month.keys())
                ]
                return AIChatResponse(
                    type="table",
                    title=f"{title} Monthwise",
                    summary=f"{summary_prefix}Total material value: Rs {total_amount:,.2f}. Quantity: {qty_summary}.",
                    columns=["Month", "Total Quantity", "Total Amount"],
                    rows=month_rows,
                )
            return AIChatResponse(
                type="chart",
                title=f"{title} Monthwise",
                summary=f"{summary_prefix}Total material value: Rs {total_amount:,.2f}. Quantity: {qty_summary}.",
                chart_type="bar",
                x_key="month",
                y_keys=["amount"],
                data=[{"month": key, "amount": round(value, 2)} for key, value in sorted(chart_by_month.items())],
            )
        if extraction.output_type == "chart":
            return AIChatResponse(
                type="chart",
                title=title,
                summary=f"{summary_prefix}Total material value: Rs {total_amount:,.2f}. Quantity: {qty_summary}.",
                chart_type="bar",
                x_key="date",
                y_keys=["amount"],
                data=[{"date": key, "amount": round(value, 2)} for key, value in sorted(chart_by_date.items())],
            )
        return AIChatResponse(
            type="table",
            title=title,
            summary=f"{summary_prefix}Total material value: Rs {total_amount:,.2f}. Quantity: {qty_summary}.",
            columns=["Date", "Project", "Material", "Vendor", "Quantity", "Unit", "Rate", "Amount"],
            rows=table_rows,
        )

    def project_summary(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        project_ids = self._accessible_project_ids(user)
        project = self._resolve_project(extraction.project_name, user)
        query = self.db.query(Project).filter(Project.id.in_(project_ids))
        if project:
            query = query.filter(Project.id == project.id)
        projects = query.order_by(Project.project_name.asc()).limit(extraction.limit).all()
        rows: list[list[Any]] = []
        cards: list[dict[str, Any]] = []
        for item in projects:
            material = calculate_material_cost(self.db, item.id)
            labour = calculate_labour_cost(self.db, item.id)
            expenses = calculate_other_expenses(self.db, item.id)
            total_cost = calculate_total_cost(self.db, item.id)
            total_amount = calculate_project_total_amount(self.db, item.id)
            received = calculate_total_received(self.db, item.id)
            outstanding = calculate_outstanding(self.db, item.id)
            rows.append([
                item.project_name,
                item.location,
                _enum_value(item.status),
                total_amount,
                material,
                labour,
                expenses,
                total_cost,
                received,
                outstanding,
            ])
            cards.extend(
                [
                    {"label": "Total Amount", "value": total_amount, "tone": "blue"},
                    {"label": "Total Cost", "value": total_cost, "tone": "amber"},
                    {"label": "Received", "value": received, "tone": "green"},
                    {"label": "Outstanding", "value": outstanding, "tone": "red"},
                ]
            )
        if project and extraction.output_type in ("card", "summary"):
            return AIChatResponse(
                type="card",
                title=f"{project.project_name} Summary",
                summary=f"Status: {_enum_value(project.status)}. Location: {project.location}.",
                cards=cards[:4],
            )
        return AIChatResponse(
            type="table",
            title="Project Summary",
            summary=f"{len(rows)} project(s) matched your filters.",
            columns=[
                "Project",
                "Location",
                "Status",
                "Total Amount",
                "Materials",
                "Labour",
                "Expenses",
                "Total Cost",
                "Received",
                "Outstanding",
            ],
            rows=rows,
        )

    def pending_payments(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(PaymentLog, Project).join(Project, PaymentLog.project_id == Project.id)
        project_ids = self._accessible_project_ids(user)
        query = query.filter(PaymentLog.project_id.in_(project_ids), PaymentLog.status != PaymentStatus.RECEIVED, PaymentLog.deleted_at == None, Project.deleted_at == None)
        project = self._resolve_project(extraction.project_name, user)
        if project:
            query = query.filter(PaymentLog.project_id == project.id)
        rows = query.order_by(PaymentLog.due_date.asc().nullslast()).limit(extraction.limit).all()
        table_rows = [
            [
                payment.id,
                project.project_name,
                _enum_value(payment.payment_type),
                payment.due_date.isoformat() if payment.due_date else "-",
                _enum_value(payment.status),
                _to_float(payment.amount),
                payment.notes or "-",
            ]
            for payment, project in rows
        ]
        total = sum(row[5] for row in table_rows)
        return AIChatResponse(
            type="table",
            title="Pending Payments",
            summary=f"Pending payment value: Rs {total:,.2f}.",
            columns=["Payment ID", "Project", "Type", "Due Date", "Status", "Amount", "Notes"],
            rows=table_rows,
        )

    def labour_attendance(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(LaborLog, Project).join(Project, LaborLog.project_id == Project.id)
        query = self._apply_project_and_dates(query, LaborLog, extraction, user)
        if extraction.labour_type:
            query = query.filter(LaborLog.labour_type.ilike(f"%{extraction.labour_type}%"))
        rows = query.order_by(LaborLog.date.desc(), LaborLog.id.desc()).limit(extraction.limit).all()
        table_rows: list[list[Any]] = []
        chart_by_date: dict[str, float] = defaultdict(float)
        total = 0.0
        for item, project in rows:
            amount = _to_float(item.total_wage)
            if amount <= 0:
                amount = _to_float(item.labour_count) * (_to_float(item.wage_per_head) + _to_float(item.overtime_cost))
            total += amount
            date_key = item.date.isoformat()
            chart_by_date[date_key] += amount
            table_rows.append([
                date_key,
                project.project_name,
                item.labour_type,
                _to_float(item.labour_count),
                _to_float(item.wage_per_head),
                _to_float(item.overtime_cost),
                round(amount, 2),
                item.remarks or "-",
            ])
        if extraction.output_type == "chart":
            return AIChatResponse(
                type="chart",
                title="Labour Cost Trend",
                summary=f"Total labour cost: Rs {total:,.2f}.",
                chart_type="bar",
                x_key="date",
                y_keys=["amount"],
                data=[{"date": key, "amount": round(value, 2)} for key, value in sorted(chart_by_date.items())],
            )
        return AIChatResponse(
            type="table",
            title="Labour Usage",
            summary=f"Total labour cost: Rs {total:,.2f}.",
            columns=["Date", "Project", "Labour Type", "Count", "Wage/Head", "OT/Head", "Amount", "Remarks"],
            rows=table_rows,
        )

    def inventory_stock(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(MaterialMaster).filter(MaterialMaster.active == True)
        if extraction.material_name:
            query = query.filter(MaterialMaster.name.ilike(f"%{extraction.material_name}%"))
        rows = query.order_by(MaterialMaster.name.asc(), MaterialMaster.supplier.asc()).limit(extraction.limit).all()
        table_rows = [
            [item.id, item.name, item.supplier, item.unit, _to_float(item.default_unit_cost), "Active" if item.active else "Inactive"]
            for item in rows
        ]
        return AIChatResponse(
            type="table",
            title="Material Master / Inventory Catalog",
            summary="Stock quantity is not tracked separately yet; this shows approved materials, vendors, units, and default rates.",
            columns=["Material ID", "Material", "Vendor", "Unit", "Cost/Unit", "Status"],
            rows=table_rows,
        )

    def site_expenses(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(ExpenseLog, Project).join(Project, ExpenseLog.project_id == Project.id)
        query = self._apply_project_and_dates(query, ExpenseLog, extraction, user)
        if extraction.expense_category:
            query = query.filter(ExpenseLog.category.ilike(f"%{extraction.expense_category}%"))
        rows = query.order_by(ExpenseLog.date.desc(), ExpenseLog.id.desc()).limit(extraction.limit).all()
        table_rows: list[list[Any]] = []
        chart_by_category: dict[str, float] = defaultdict(float)
        total = 0.0
        for expense, project in rows:
            amount = _to_float(expense.amount)
            total += amount
            chart_by_category[expense.category] += amount
            table_rows.append([
                expense.date.isoformat(),
                project.project_name,
                expense.category,
                amount,
                expense.description or "-",
            ])
        if extraction.output_type == "chart":
            return AIChatResponse(
                type="chart",
                title="Site Expenses",
                summary=f"Total expenses: Rs {total:,.2f}.",
                chart_type="bar",
                x_key="category",
                y_keys=["amount"],
                data=[{"category": key, "amount": round(value, 2)} for key, value in chart_by_category.items()],
            )
        return AIChatResponse(
            type="table",
            title="Site Expenses",
            summary=f"Total expenses: Rs {total:,.2f}.",
            columns=["Date", "Project", "Category", "Amount", "Description"],
            rows=table_rows,
        )

    def customer_details(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        project_ids = self._accessible_project_ids(user)
        query = self.db.query(ProjectShareholder, Project).join(Project, ProjectShareholder.project_id == Project.id)
        query = query.filter(ProjectShareholder.project_id.in_(project_ids), ProjectShareholder.deleted_at == None, Project.deleted_at == None)
        project = self._resolve_project(extraction.project_name, user)
        if project:
            query = query.filter(ProjectShareholder.project_id == project.id)
        if extraction.customer_name:
            query = query.filter(ProjectShareholder.name.ilike(f"%{extraction.customer_name}%"))
        rows = query.order_by(Project.project_name.asc(), ProjectShareholder.name.asc()).limit(extraction.limit).all()
        construction_paid, _, _, _ = shareholder_charge_paid_maps(
            self.db.query(ShareholderPayment).filter(
                ShareholderPayment.deleted_at == None,
                ShareholderPayment.project_id.in_(project_ids),
            ).all(),
            self.db.query(Bill).filter(Bill.deleted_at == None, Bill.project_id.in_(project_ids)).all(),
        )
        table_rows: list[list[Any]] = []
        for shareholder, project in rows:
            due = _to_float(shareholder.due_amount)
            paid_amount = _to_float(construction_paid.get(shareholder.id, 0.0))
            table_rows.append([
                project.project_name,
                shareholder.name,
                shareholder.company_name or "-",
                shareholder.phone,
                shareholder.address or "-",
                "Existing" if shareholder.is_existing_shareholder else "New Share",
                shareholder.due_amount,
                round(due, 2),
                round(paid_amount, 2),
                round(due - paid_amount, 2),
            ])
        if not table_rows and project:
            total_declared = project.existing_shareholders_count + project.new_shareholders_count
            return AIChatResponse(
                type="card",
                title=f"Shareholders - {project.project_name}",
                summary=(
                    f"No individual shareholder records are saved yet for {project.project_name}. "
                    f"Project setup currently shows Existing Shareholders: {project.existing_shareholders_count}, "
                    f"New Shares: {project.new_shareholders_count}, Total Shares: {total_declared}."
                ),
                cards=[
                    {"label": "Existing Shareholders", "value": project.existing_shareholders_count, "tone": "blue"},
                    {"label": "New Shares", "value": project.new_shareholders_count, "tone": "amber"},
                    {"label": "Total Shares", "value": total_declared, "tone": "green"},
                    {"label": "Total Amount", "value": round(calculate_project_total_amount(self.db, project.id), 2), "tone": "slate"},
                ],
            )
        if not table_rows:
            return AIChatResponse(
                type="text",
                title="Shareholders",
                text="No shareholder records were found in your accessible projects. Add shareholders inside a project to view client-wise due and payment details.",
            )
        return AIChatResponse(
            type="table",
            title="JV Client / Shareholder Details",
            summary=f"{len(table_rows)} shareholder record(s) matched your filters.",
            columns=["Project", "Name", "Company", "Phone", "Address", "Type", "Shares", "Due", "Paid", "Balance"],
            rows=table_rows,
        )

    def invoice_reports(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(PaymentLog, Project).join(Project, PaymentLog.project_id == Project.id)
        project_ids = self._accessible_project_ids(user)
        query = query.filter(PaymentLog.project_id.in_(project_ids), PaymentLog.deleted_at == None, Project.deleted_at == None)
        project = self._resolve_project(extraction.project_name, user)
        if project:
            query = query.filter(PaymentLog.project_id == project.id)
        rows = query.order_by(PaymentLog.id.desc()).limit(extraction.limit).all()
        table_rows = [
            [
                payment.id,
                project.project_name,
                _enum_value(payment.payment_type),
                payment.due_date.isoformat() if payment.due_date else "-",
                payment.received_date.isoformat() if payment.received_date else "-",
                _enum_value(payment.status),
                _to_float(payment.amount),
                payment.notes or "-",
            ]
            for payment, project in rows
        ]
        total = sum(row[6] for row in table_rows)
        return AIChatResponse(
            type="table",
            title="Invoice / Payment Report",
            summary=f"Total listed payment value: Rs {total:,.2f}.",
            columns=["ID", "Project", "Type", "Due Date", "Received Date", "Status", "Amount", "Notes"],
            rows=table_rows,
            actions=[
                AIChatAction(label="🧾 Open GST Invoices →", url="/gst-invoices", variant="primary"),
                AIChatAction(label="💳 Open Payments →", url="/payments", variant="secondary"),
            ],
        )

    def navigation_guidance(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        project_ids = self._accessible_project_ids(user)
        accessible_projects = (
            self.db.query(Project)
            .filter(Project.id.in_(project_ids), Project.deleted_at == None)
            .order_by(Project.project_name.asc())
            .all()
        )
        resolved_project = self._resolve_project(extraction.project_name, user)
        action_type = (extraction.target_action or "").lower()

        actions: list[AIChatAction] = []
        text_lines: list[str] = []

        # If a specific project was identified:
        if resolved_project:
            p_slug = _slugify(resolved_project.project_name)
            p_name = resolved_project.project_name
            p_id = resolved_project.id

            if any(k in action_type for k in ("material", "product", "item", "steel", "cement", "sand")):
                text_lines.append(f"**Materials for {p_name}** are logged and managed under the **Materials** tab.")
                text_lines.append(f"Click below to navigate directly to the Materials tab for **{p_name}**:")
                actions.append(AIChatAction(label=f"🏢 {p_name} Materials →", url=f"/projects/{p_id}/{p_slug}/materials", variant="primary"))
                actions.append(AIChatAction(label="📦 Master Material Catalog →", url="/materials", variant="secondary"))
            elif any(k in action_type for k in ("labour", "labor", "worker", "wage", "attendance", "mason")):
                text_lines.append(f"**Labour & Daily Wages for {p_name}** are logged under the **Labour** tab.")
                text_lines.append(f"Click below to navigate directly to the Labour tab for **{p_name}**:")
                actions.append(AIChatAction(label=f"👷 {p_name} Labour Tab →", url=f"/projects/{p_id}/{p_slug}/labour", variant="primary"))
                actions.append(AIChatAction(label="👥 Workers Directory →", url="/workers", variant="secondary"))
            elif any(k in action_type for k in ("expense", "petty", "approval", "spend")):
                text_lines.append(f"**Site Expenses for {p_name}** are tracked in the **Site Expenses** tab.")
                text_lines.append(f"Click below to open the Site Expenses tab for **{p_name}**:")
                actions.append(AIChatAction(label=f"💰 {p_name} Expenses →", url=f"/projects/{p_id}/{p_slug}/expenses", variant="primary"))
                actions.append(AIChatAction(label="📋 Global Site Expenses →", url="/site-expenses", variant="secondary"))
            elif any(k in action_type for k in ("file", "document", "drawing", "plan", "upload", "photo")):
                text_lines.append(f"**Drawings & Documents for {p_name}** are stored under the **Files** tab.")
                actions.append(AIChatAction(label=f"📁 {p_name} Files & Folders →", url=f"/projects/{p_id}/{p_slug}/files", variant="primary"))
            elif any(k in action_type for k in ("transaction", "statement", "ledger", "jv", "shareholder", "client")):
                text_lines.append(f"**Financial Statement & Transactions for {p_name}** can be viewed under the **Transactions** tab.")
                actions.append(AIChatAction(label=f"📑 {p_name} Transactions →", url=f"/projects/{p_id}/{p_slug}/transactions", variant="primary"))
                actions.append(AIChatAction(label="🖨️ Printable Statement →", url=f"/projects/{p_id}/statement-document", variant="secondary"))
            else:
                text_lines.append(f"Here are the quick navigation shortcuts for **{p_name}**:")
                actions.append(AIChatAction(label=f"🏢 {p_name} Materials →", url=f"/projects/{p_id}/{p_slug}/materials", variant="primary"))
                actions.append(AIChatAction(label=f"👷 {p_name} Labour →", url=f"/projects/{p_id}/{p_slug}/labour", variant="secondary"))
                actions.append(AIChatAction(label=f"💰 {p_name} Expenses →", url=f"/projects/{p_id}/{p_slug}/expenses", variant="secondary"))
                actions.append(AIChatAction(label=f"📁 {p_name} Files →", url=f"/projects/{p_id}/{p_slug}/files", variant="outline"))
                actions.append(AIChatAction(label=f"📊 {p_name} Analytics →", url=f"/projects/{p_id}/analytics", variant="outline"))

            return AIChatResponse(
                type="text",
                title=f"Navigation for {p_name}",
                text="\n\n".join(text_lines),
                actions=actions,
            )

        # If no specific project was specified, ask user and list accessible projects:
        if any(k in action_type for k in ("material", "product", "item", "steel", "cement")):
            text_lines.append("### 📦 Logging Project Materials")
            text_lines.append("Materials (such as Steel, Cement, Sand, Bricks) are logged directly inside each project's workspace under the **Materials** tab.")
            text_lines.append("Which project would you like to enter materials for? Select one below to go straight to its entry table:")
            for p in accessible_projects[:6]:
                p_slug = _slugify(p.project_name)
                actions.append(AIChatAction(label=f"🏢 {p.project_name} Materials →", url=f"/projects/{p.id}/{p_slug}/materials", variant="primary"))
            actions.append(AIChatAction(label="📦 Master Material Catalog →", url="/materials", variant="secondary"))
        elif any(k in action_type for k in ("labour", "labor", "worker", "wage", "attendance")):
            text_lines.append("### 👷 Recording Labour & Wages")
            text_lines.append("Labour entries and worker wages are logged under each project's **Labour** tab.")
            text_lines.append("Which project are you recording labour for?")
            for p in accessible_projects[:6]:
                p_slug = _slugify(p.project_name)
                actions.append(AIChatAction(label=f"👷 {p.project_name} Labour →", url=f"/projects/{p.id}/{p_slug}/labour", variant="primary"))
            actions.append(AIChatAction(label="👥 Manage Workers →", url="/workers", variant="secondary"))
        elif any(k in action_type for k in ("expense", "petty", "approval")):
            text_lines.append("### 💰 Recording Expenses")
            text_lines.append("You can record site expenses per project or view global site expenses across all sites:")
            actions.append(AIChatAction(label="📋 Global Site Expenses →", url="/site-expenses", variant="primary"))
            actions.append(AIChatAction(label="🏢 Office Expenses →", url="/office", variant="secondary"))
            for p in accessible_projects[:4]:
                p_slug = _slugify(p.project_name)
                actions.append(AIChatAction(label=f"🏢 {p.project_name} Expenses →", url=f"/projects/{p.id}/{p_slug}/expenses", variant="outline"))
        elif any(k in action_type for k in ("vendor", "supplier", "bill")):
            text_lines.append("### 🚚 Vendor Management")
            text_lines.append("View vendors, payment balances, and payment histories in the Vendor Master module:")
            actions.append(AIChatAction(label="🚚 Open Vendors Directory →", url="/vendors", variant="primary"))
            actions.append(AIChatAction(label="💳 Payments Overview →", url="/payments", variant="secondary"))
        elif any(k in action_type for k in ("invoice", "gst")):
            text_lines.append("### 🧾 GST Invoices")
            text_lines.append("Create GST tax invoices, track billed demand, and collect against each invoice:")
            actions.append(AIChatAction(label="🧾 GST Invoices →", url="/gst-invoices", variant="primary"))
            actions.append(AIChatAction(label="💳 Payment Receipts →", url="/payments", variant="secondary"))
        elif any(k in action_type for k in ("client", "shareholder", "jv")):
            text_lines.append("### 👥 Clients & JV Partners")
            text_lines.append("Manage clients and shareholder payment schedules:")
            actions.append(AIChatAction(label="👥 Clients & Shareholders →", url="/clients", variant="primary"))
        else:
            text_lines.append("### 🧭 Application Navigation")
            text_lines.append("Here are quick shortcuts to the main modules in KKR Construction Suite:")
            actions.append(AIChatAction(label="🏢 Projects List →", url="/projects", variant="primary"))
            actions.append(AIChatAction(label="🧾 GST Invoices →", url="/gst-invoices", variant="secondary"))
            actions.append(AIChatAction(label="💳 Payments →", url="/payments", variant="secondary"))
            actions.append(AIChatAction(label="🚚 Vendors & Payments →", url="/vendors", variant="secondary"))
            actions.append(AIChatAction(label="💰 Site Expenses →", url="/site-expenses", variant="secondary"))
            actions.append(AIChatAction(label="📦 Material Catalog →", url="/materials", variant="outline"))
            actions.append(AIChatAction(label="📊 Profit & Loss →", url="/profit-loss", variant="outline"))

        return AIChatResponse(
            type="text",
            title="Navigation Guidance",
            text="\n\n".join(text_lines),
            actions=actions,
        )

    def vendor_summary(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(VendorMaster).order_by(VendorMaster.name.asc())
        if extraction.vendor_name:
            query = query.filter(VendorMaster.name.ilike(f"%{extraction.vendor_name}%"))
        vendors = query.limit(extraction.limit).all()

        table_rows: list[list[Any]] = []
        for v in vendors:
            txn_count = (
                self.db.query(VendorTransaction)
                .filter(VendorTransaction.vendor_id == v.id, VendorTransaction.deleted_at == None)
                .count()
            )
            mat_count = (
                self.db.query(MaterialLog)
                .filter(MaterialLog.vendor_id == v.id, MaterialLog.deleted_at == None)
                .count()
            )
            table_rows.append([
                v.name,
                (v.party_type or "").replace("_", " ").title() or "-",
                v.work_field or "-",
                v.phone or "-",
                mat_count,
                txn_count,
                "Active" if v.active else "Inactive",
            ])

        actions = [
            AIChatAction(label="🚚 Open Vendors Page →", url="/vendors", variant="primary"),
            AIChatAction(label="💳 Payments →", url="/payments", variant="secondary"),
            AIChatAction(label="🧾 GST Invoices →", url="/gst-invoices", variant="secondary"),
        ]

        return AIChatResponse(
            type="table",
            title="Vendor Master & Directory",
            summary=f"Found {len(table_rows)} vendor(s). Click below to view transaction histories or record vendor payments.",
            columns=["Vendor Name", "Party Type", "Work Field", "Phone", "Material Logs", "Transactions", "Status"],
            rows=table_rows,
            actions=actions,
        )

    def office_expenses(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        query = self.db.query(OfficeExpense).order_by(OfficeExpense.date.desc())
        start, end = self._date_bounds(extraction)
        if start:
            query = query.filter(OfficeExpense.date >= start.isoformat())
        if end:
            query = query.filter(OfficeExpense.date <= end.isoformat())
        rows = query.limit(extraction.limit).all()

        table_rows = [
            [
                item.date,
                item.category,
                item.expense_type,
                _to_float(item.amount),
                item.paid_by_name or "-",
                item.description or "-",
            ]
            for item in rows
        ]
        total_amount = sum(row[3] for row in table_rows)
        actions = [AIChatAction(label="🏢 Go to Office Expenses →", url="/office", variant="primary")]

        return AIChatResponse(
            type="table",
            title="Office Expenses & Overheads",
            summary=f"Total listed office expenses: Rs {total_amount:,.2f}.",
            columns=["Date", "Category", "Type", "Amount", "Paid By", "Description"],
            rows=table_rows,
            actions=actions,
        )

    def workflow_help(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        return self.navigation_guidance(extraction, user)

    def general_inquiry(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        return self.navigation_guidance(extraction, user)

    def help_response(self, extraction: ChatIntentExtraction, user: User) -> AIChatResponse:
        project_ids = self._accessible_project_ids(user)
        accessible_projects = self.db.query(Project).filter(Project.id.in_(project_ids), Project.deleted_at == None).all()
        actions = [
            AIChatAction(label="🏢 View Projects →", url="/projects", variant="primary"),
            AIChatAction(label="🚚 Vendors & Payments →", url="/vendors", variant="secondary"),
            AIChatAction(label="💰 Site Expenses →", url="/site-expenses", variant="secondary"),
            AIChatAction(label="📊 Profit & Loss →", url="/profit-loss", variant="outline"),
        ]
        return AIChatResponse(
            type="text",
            title="KKR AI Assistant",
            text=(
                "### 👋 How can I help you today?\n\n"
                "I am your real-time assistant for KKR Construction Suite. You can ask me:\n\n"
                "- **Navigation & Logging**: *\"Where should I enter project materials?\"*, *\"How do I log labour attendance?\"*\n"
                "- **Project Summaries**: *\"Show summary for KKR Grand Residence\"*, *\"Compare project budgets\"*\n"
                "- **Materials & Stock**: *\"Give me cement consumption this month\"*, *\"List steel master rates\"*\n"
                "- **Labour & Wages**: *\"Show worker wages by date\"*, *\"What is total labour spend?\"*\n"
                "- **Finances & Vendors**: *\"Which vendor payments are pending?\"*, *\"List site expenses\"*\n"
            ),
            sample_prompts=SAMPLE_PROMPTS,
            actions=actions,
        )

