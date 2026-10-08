from datetime import date

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class LaborLogBase(BaseModel):
    project_id: int
    vendor_id: int | None = None
    date: date
    labour_type: str
    labour_count: float = Field(default=0, ge=0)
    wage_per_head: float = Field(default=0, ge=0)
    overtime_cost: float = Field(default=0, ge=0)
    total_wage: float | None = Field(default=None, ge=0)
    remarks: str | None = None


class LaborLogResponse(LaborLogBase, ORMModel):
    id: int
