from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class JVShareholderPaymentBase(BaseModel):
    shareholder_id: int
    payment_date: date
    amount: float = Field(gt=0)
    payment_mode: str | None = None
    purpose: str = "construction"
    notes: str | None = None


class JVShareholderPaymentCreate(JVShareholderPaymentBase):
    purpose: Literal["construction", "gst", "registration", "legal", "gst_invoice"] = "construction"


class JVShareholderPaymentResponse(JVShareholderPaymentBase, ORMModel):
    id: int
    project_id: int


class JVPaymentScheduleBase(BaseModel):
    installment_no: int = Field(gt=0)
    amount: float = Field(gt=0)
    percentage: float = Field(ge=0)
    due_date: date
    remarks: str | None = None


class JVPaymentScheduleSaveRequest(BaseModel):
    installments: list[JVPaymentScheduleBase] = Field(min_length=1)


class JVPaymentScheduleResponse(JVPaymentScheduleBase, ORMModel):
    id: int
    project_id: int
    shareholder_id: int
    paid_amount: float = 0
    balance_amount: float = 0
    status: str = "pending"
    days_overdue: int = 0


class JVShareholderLedgerItem(BaseModel):
    shareholder_id: int
    name: str
    company_name: str | None = None
    pan_no: str | None = None
    address: str | None = None
    city: str | None = None
    pincode: str | None = None
    is_existing_shareholder: bool
    existing_area: float = 0
    existing_uds: float = 0
    free_cost_area: float = 0
    new_area: float = 0
    new_uds: float = 0
    additional_sqft: float = 0
    rate_per_sqft: float = 0
    round_off: float = 0
    client_subtotal: float = 0
    legal_charges: float = 0
    due_amount: float
    due_percentage: float
    paid_amount: float
    balance_amount: float
    gst_payable: float = 0
    gst_paid: float = 0
    gst_balance: float = 0
    registration_payable: float = 0
    registration_paid: float = 0
    registration_balance: float = 0
    legal_payable: float = 0
    legal_paid: float = 0
    legal_balance: float = 0


class JVProjectSummaryItem(BaseModel):
    project_id: int
    project_name: str
    location: str
    client_name: str
    construction_rate_per_sqft: float = 0
    total_budget: float = 0
    total_due: float
    total_paid: float
    total_balance: float


class JVShareholderPaymentEntry(BaseModel):
    id: int
    project_id: int
    project_name: str
    client_name: str
    shareholder_id: int
    shareholder_name: str
    company_name: str | None = None
    pan_no: str | None = None
    payment_date: date
    amount: float
    payment_mode: str | None = None
    purpose: str | None = None
    notes: str | None = None


class JVGovernmentCharges(BaseModel):
    composite_value_per_sqft: float = 0
    land_factor: float = Field(default=1, ge=0, le=2)
    gst_percent: float = Field(default=5, ge=0)
    registration_value_percent: float = Field(default=4, ge=0)
    construction_cost_per_sqft: float = 0
    new_gst_percent: float = Field(default=5, ge=0)
    new_reg_upto_50l_percent: float = Field(default=6, ge=0)
    new_reg_upto_3cr_percent: float = Field(default=7, ge=0)
    new_reg_above_3cr_percent: float = Field(default=9, ge=0)
    new_legal_charges: float = Field(default=0, ge=0)


class JVProjectLedgerResponse(BaseModel):
    project_id: int
    project_name: str
    construction_rate_per_sqft: float = 0
    total_due: float
    total_paid: float
    total_balance: float
    total_gst_payable: float = 0
    total_gst_paid: float = 0
    total_gst_balance: float = 0
    total_registration_payable: float = 0
    total_registration_paid: float = 0
    total_registration_balance: float = 0
    total_legal_payable: float = 0
    total_legal_paid: float = 0
    total_legal_balance: float = 0
    government_charges: JVGovernmentCharges = Field(default_factory=JVGovernmentCharges)
    shareholders: list[JVShareholderLedgerItem]
    payments: list[JVShareholderPaymentResponse]
    payment_schedules: list[JVPaymentScheduleResponse]
