from typing import Optional

from pydantic import BaseModel, ConfigDict


class VendorMasterCreate(BaseModel):
    name: str
    party_type: str = "material_vendor"
    work_field: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    active: bool = True


class VendorMasterUpdate(BaseModel):
    name: Optional[str] = None
    party_type: Optional[str] = None
    work_field: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None


class VendorMasterResponse(BaseModel):
    id: int
    name: str
    party_type: str = "material_vendor"
    work_field: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    active: bool

    model_config = ConfigDict(from_attributes=True)


class VendorPaymentHistoryItem(BaseModel):
    id: int
    source: str
    project_id: int
    project_name: str
    payment_date: str
    work_detail: str
    quantity: Optional[float] = None
    rate: Optional[float] = None
    amount: float
    payment_mode: Optional[str] = None
    notes: Optional[str] = None


class VendorRecordBookItem(VendorPaymentHistoryItem):
    vendor_id: int
    vendor_name: str
    party_type: str = "material_vendor"
