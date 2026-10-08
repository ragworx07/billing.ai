from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from src.data.models.postgres.enums import UserRole
from src.schemas.common import ORMModel


class UserBase(BaseModel):
    name: str
    email: EmailStr
    role: str | None = None
    phone: str | None = None


class UserCreate(UserBase):
    password: str = Field(min_length=8)
    role: str


class PasswordResetRequest(BaseModel):
    password: str = Field(min_length=8)


class PublicSignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: str | None = None


class OwnerBootstrapRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: str | None = None


class RoleAssignmentRequest(BaseModel):
    role: str


class UserResponse(UserBase, ORMModel):
    id: int
    created_at: datetime
    updated_on: datetime
    is_active: bool
