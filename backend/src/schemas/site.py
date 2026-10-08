from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from src.schemas.common import ORMModel

SiteExpenseAllocation = Literal["project", "office", "other"]


class SiteExpenseBase(BaseModel):
    item_name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    rate: float = Field(gt=0)
    quantity: float = Field(gt=0)
    description: str | None = None
    bill_url: str | None = None
    date: date
    allocation: SiteExpenseAllocation = "other"
    project_id: int | None = None

    @model_validator(mode="after")
    def validate_allocation(self):
        if self.allocation == "project" and not self.project_id:
            raise ValueError("project_id is required when allocation is 'project'")
        if self.allocation != "project":
            self.project_id = None
        return self


class SiteExpenseResponse(ORMModel):
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
    allocation: SiteExpenseAllocation = "other"
    project_id: int | None = None
    created_at: datetime


class SiteWeekCloseRequest(BaseModel):
    week_start: date


class SiteWeekCloseResponse(BaseModel):
    week_start: date
    closed_count: int
    total_amount: float
    closed_at: datetime


class SiteSettlementBase(BaseModel):
    amount: float = Field(gt=0)
    date: date
    payment_mode: str | None = None
    notes: str | None = None


class SiteSettlementResponse(SiteSettlementBase, ORMModel):
    id: int
    created_by_id: int | None = None
    created_at: datetime
