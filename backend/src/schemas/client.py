from datetime import datetime

from pydantic import BaseModel, EmailStr

from src.schemas.common import ORMModel


class ClientBase(BaseModel):
    name: str
    company_name: str
    phone: str
    alternate_phone: str | None = None
    email: EmailStr | None = None
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    pincode: str
    gst_number: str | None = None




class ClientResponse(ClientBase, ORMModel):
    id: int
    created_at: datetime
