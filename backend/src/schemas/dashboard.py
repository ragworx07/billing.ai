from pydantic import BaseModel


class DashboardCard(BaseModel):
    label: str
    value: float | int


class MonthlyCashflowItem(BaseModel):
    month: str
    inflow: float
    outflow: float
    net: float


class ProjectMonthlyCashflowItem(MonthlyCashflowItem):
    project_id: int
    project_name: str


class CostBreakdownItem(BaseModel):
    category: str
    amount: float
    share_pct: float


class StatusDistributionItem(BaseModel):
    status: str
    count: int


class OverdueAgingItem(BaseModel):
    bucket: str
    count: int
    amount: float


class OverduePaymentItem(BaseModel):
    payment_id: int
    project_id: int
    project_name: str
    payment_type: str
    due_date: str | None
    amount: float
    status: str
    days_overdue: int


class ProjectHealthItem(BaseModel):
    project_id: int
    project_name: str
    status: str
    construction_sqft: float
    construction_rate_per_sqft: float
    estimated_cost: float
    total_amount: float
    total_cost: float
    total_received: float
    outstanding: float
    profit_projection: float
    profit_margin_pct: float
    collection_efficiency_pct: float
    cost_to_quote_pct: float


class ShareholderRiskItem(BaseModel):
    shareholder_id: int
    project_id: int
    project_name: str
    shareholder_name: str
    company_name: str | None = None
    phone: str | None = None
    address: str | None = None
    due_amount: float
    paid_amount: float
    balance_amount: float
    collection_efficiency_pct: float


class DashboardAlertItem(BaseModel):
    severity: str
    title: str
    detail: str
    project_id: int | None = None
    route: str | None = None


class DashboardResponse(BaseModel):
    cards: list[DashboardCard]
    monthly_cashflow: list[MonthlyCashflowItem]
    monthly_cashflow_by_project: list[ProjectMonthlyCashflowItem]
    cost_breakdown: list[CostBreakdownItem]
    status_distribution: list[StatusDistributionItem]
    overdue_aging: list[OverdueAgingItem]
    overdue_payments: list[OverduePaymentItem]
    project_health: list[ProjectHealthItem]
    shareholder_risks: list[ShareholderRiskItem]
    alerts: list[DashboardAlertItem]


class CalendarTransactionItem(BaseModel):
    id: str
    project_id: int
    project_name: str
    date: str
    direction: str  # 'spent' | 'received'
    type: str       # 'Material' | 'Labour' | 'Expense' | 'Client Receipt' | 'Shareholder Receipt' | 'Vendor Payment'
    title: str
    amount: float
    detail: str


class CalendarDaySummary(BaseModel):
    date: str
    spent: float
    received: float
    transactions: list[CalendarTransactionItem]


class DashboardCalendarResponse(BaseModel):
    month: str
    days: list[CalendarDaySummary]
    totals: dict

