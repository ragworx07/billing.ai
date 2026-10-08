from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class VendorTransactionCreate(BaseModel):
    project_id: int
    vendor_id: int
    amount: float
    round_off: float = 0
    payment_date: date
    payment_mode: Optional[str] = None
    notes: Optional[str] = None


class VendorTransactionUpdate(BaseModel):
    amount: Optional[float] = None
    round_off: Optional[float] = None
    payment_date: Optional[date] = None
    payment_mode: Optional[str] = None
    notes: Optional[str] = None


class VendorTransactionResponse(BaseModel):
    id: int
    project_id: int
    vendor_id: int
    amount: float
    round_off: float = 0
    payment_date: date
    payment_mode: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
