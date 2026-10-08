from datetime import date, datetime

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class OfficeExpenseBase(BaseModel):
    item_name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    rate: float = Field(gt=0)
    quantity: float = Field(gt=0)
    description: str | None = None
    bill_url: str | None = None
    date: date


class OfficeExpenseResponse(ORMModel):
    id: int
    item_name: str | None = None
    category: str
    amount: float
    rate: float | None = None
    quantity: float | None = None
    description: str | None = None
    bill_url: str | None = None
    date: date
    week_start: date
    closed_at: datetime | None = None
    created_at: datetime


class OfficeWeekCloseRequest(BaseModel):
    week_start: date


class OfficeWeekCloseResponse(BaseModel):
    week_start: date
    closed_count: int
    total_amount: float
    closed_at: datetime


class OfficeSettlementBase(BaseModel):
    amount: float = Field(gt=0)
    date: date
    payment_mode: str | None = None
    notes: str | None = None


class OfficeSettlementResponse(OfficeSettlementBase, ORMModel):
    id: int
    created_by_id: int | None = None
    created_at: datetime

