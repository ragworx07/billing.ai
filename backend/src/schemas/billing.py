from datetime import date, datetime
from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class BillItemBase(BaseModel):
    description: str
    hsn_code: str | None = "995411"
    cgst_rate: float = Field(default=2.5, ge=0)
    sgst_rate: float = Field(default=2.5, ge=0)
    cgst_amount: float = Field(default=0, ge=0)
    sgst_amount: float = Field(default=0, ge=0)
    quantity: float = Field(default=1, gt=0)
    rate: float = Field(default=0, ge=0)
    amount: float = Field(default=0, ge=0)


class BillItemResponse(BillItemBase, ORMModel):
    id: int
    bill_id: int


class BillBase(BaseModel):
    project_id: int | None = None
    custom_project_name: str | None = None
    shareholder_id: int | None = None
    bill_date: date
    due_date: date
    client_name: str
    company_name: str | None = None
    billing_address: str | None = None
    billing_city: str | None = None
    billing_pincode: str | None = None
    seal_type: str = "developers"
    subtotal: float = Field(default=0, ge=0)
    cgst_amount: float = Field(default=0, ge=0)
    sgst_amount: float = Field(default=0, ge=0)
    tax_amount: float = Field(default=0, ge=0)
    discount_amount: float = Field(default=0, ge=0)
    total_amount: float = Field(default=0, ge=0)
    notes: str | None = None
    signature_image: str | None = None
    gst_only: bool = False


class BillCreate(BillBase):
    bill_number: str | None = Field(default=None, max_length=50)
    items: list[BillItemBase] = Field(default_factory=list)


class BillUpdate(BillBase):
    bill_number: str | None = Field(default=None, max_length=50)
    items: list[BillItemBase] = Field(default_factory=list)


class NextBillNumberResponse(BaseModel):
    bill_number: str


class BillRecordPaymentRequest(BaseModel):
    payment_date: date
    amount: float = Field(gt=0)
    payment_mode: str = "cash"
    notes: str | None = None


class BillResponse(BillBase, ORMModel):
    id: int
    bill_number: str
    paid_amount: float = 0
    balance_amount: float = 0
    status: str = "unpaid"
    created_at: datetime
    project_name: str | None = None
    items: list[BillItemResponse] = Field(default_factory=list)
