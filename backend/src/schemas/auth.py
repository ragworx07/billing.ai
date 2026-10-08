from pydantic import BaseModel, ConfigDict, EmailStr

from src.data.models.postgres.enums import UserRole

class UserSummary(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str | None = None

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSummary


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
