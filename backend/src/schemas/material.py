from datetime import date

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class MaterialLogBase(BaseModel):
    project_id: int
    vendor_id: int | None = None
    material_name: str
    quantity: float = Field(gt=0)
    unit: str
    unit_cost: float = Field(ge=0)
    supplier: str | None = None
    work_remarks: str | None = None
    total_cft: float | None = Field(default=None, ge=0)
    rate_per_cft: float | None = Field(default=None, ge=0)
    no_of_loads: float | None = Field(default=None, ge=0)
    gst_percent: float | None = Field(default=None, ge=0)
    template_meta: dict | None = None
    transport_cost: float = Field(default=0, ge=0)
    bill_url: str | None = None
    bill_no: str | None = None
    date: date


class MaterialLogResponse(MaterialLogBase, ORMModel):
    id: int
