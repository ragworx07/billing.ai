from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class LabourInchargeLimitUpsert(BaseModel):
    limit_amount: float = Field(gt=0)


class LabourInchargeLimitResponse(ORMModel):
    id: int
    project_id: int
    vendor_id: int
    limit_amount: float
    created_at: datetime
    updated_at: datetime
