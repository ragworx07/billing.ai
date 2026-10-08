from pydantic import BaseModel

from src.schemas.common import ORMModel


class ExpenseMasterBase(BaseModel):
    name: str
    active: bool = True




class ExpenseMasterResponse(ExpenseMasterBase, ORMModel):
    id: int
