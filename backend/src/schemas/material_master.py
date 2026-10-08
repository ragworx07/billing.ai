from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class MaterialMasterBase(BaseModel):
    name: str
    supplier: str
    unit: str
    default_unit_cost: float = Field(ge=0)
    active: bool = True
    has_bundle_conversion: bool = False
    default_bundle_weight: float | None = Field(default=None, ge=0)




class MaterialMasterResponse(MaterialMasterBase, ORMModel):
    id: int
