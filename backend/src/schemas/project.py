from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from src.data.models.postgres.enums import ProjectStatus
from src.schemas.common import ORMModel


class ProjectBase(BaseModel):
    client_id: int | None = None
    project_name: str
    description: str | None = None
    profile_image_url: str | None = None
    location: str
    start_date: date
    expected_end_date: date | None = None
    estimated_cost: float = Field(default=0, ge=0)
    construction_sqft: float = Field(default=0, ge=0)
    construction_rate_per_sqft: float = Field(default=4500, ge=0)
    status: ProjectStatus = ProjectStatus.UPCOMING
    existing_shareholders_count: int = Field(default=0, ge=0)
    new_shareholders_count: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.expected_end_date and self.expected_end_date < self.start_date:
            raise ValueError("expected_end_date cannot be before start_date")
        return self




class ProjectResponse(ProjectBase, ORMModel):
    id: int
    total_amount: float = 0
    created_at: datetime


class ProjectShareholderBase(BaseModel):
    name: str
    company_name: str | None = None
    pan_no: str | None = None
    phone: str
    address: str | None = None
    city: str | None = None
    pincode: str | None = None
    is_existing_shareholder: bool = True
    existing_area: float = Field(default=0, ge=0)
    existing_uds: float = Field(default=0, ge=0)
    free_cost_area: float = Field(default=0, ge=0)
    new_area: float = Field(default=0, ge=0)
    new_uds: float = Field(default=0, ge=0)
    additional_sqft: float = Field(default=0, ge=0)
    rate_per_sqft: float = Field(default=0, ge=0)
    round_off: float = 0
    legal_charges: float = Field(default=0, ge=0)
    due_amount: float = Field(default=0)


class ProjectShareholderUpdate(ProjectShareholderBase):
    pass


class ProjectShareholderResponse(ProjectShareholderBase, ORMModel):
    id: int
    project_id: int


class ProjectMetrics(BaseModel):
    material_cost: float
    labour_cost: float
    other_expenses: float
    total_cost: float
    total_received: float
    outstanding: float
    profit: float
    profit_percentage: float


class ProjectTimelineEvent(BaseModel):
    date: str
    type: str
    title: str
    detail: str
    amount: float | None = None


class ProjectStatementResponse(BaseModel):
    project: ProjectResponse
    timeline: list[ProjectTimelineEvent]
    metrics: ProjectMetrics


class KKRMaterialSummaryItem(BaseModel):
    material_name: str
    supplier: str | None = None
    unit_rate: float
    quantity: float
    unit: str
    total_price: float


class KKRMaterialSummaryResponse(BaseModel):
    project_id: int
    grand_total: float
    items: list[KKRMaterialSummaryItem]
