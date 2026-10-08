from datetime import date, datetime

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class MilestoneBase(BaseModel):
    project_id: int
    title: str = Field(min_length=1, max_length=160)
    milestone_date: date
    details: str | None = None


class MilestoneCreate(MilestoneBase):
    pass


class MilestoneUpdate(BaseModel):
    project_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    milestone_date: date | None = None
    details: str | None = None
    status: str | None = None


class MilestoneExtend(BaseModel):
    milestone_date: date
    details: str | None = None


class MilestoneResponse(ORMModel):
    id: int
    project_id: int
    project_name: str | None = None
    project_status: str | None = None
    project_location: str | None = None
    title: str
    milestone_date: date
    details: str | None = None
    status: str
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
