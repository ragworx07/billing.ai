from datetime import date

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class ExpenseLogBase(BaseModel):
    project_id: int
    category: str
    amount: float = Field(gt=0)
    description: str | None = None
    bill_url: str | None = None
    date: date



class ExpenseLogResponse(ExpenseLogBase, ORMModel):
    id: int
