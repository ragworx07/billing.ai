from datetime import date

from pydantic import BaseModel, Field, model_validator

from src.data.models.postgres.enums import PaymentStatus, PaymentType
from src.schemas.common import ORMModel


class PaymentLogBase(BaseModel):
    project_id: int
    payment_type: PaymentType
    amount: float = Field(gt=0)
    payment_mode: str | None = None
    due_date: date | None = None
    received_date: date | None = None
    status: PaymentStatus = PaymentStatus.PENDING
    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.received_date and self.due_date and self.received_date < self.due_date and self.status == PaymentStatus.OVERDUE:
            raise ValueError("status cannot be overdue if received before due date")
        return self



class PaymentLogResponse(PaymentLogBase, ORMModel):
    id: int
