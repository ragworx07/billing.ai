from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.core.exceptions.exceptions import auth, recorded
from src.data.models.postgres.enums import UserRole
from src.data.repositories.auth_repository import AuthRepository
from src.data.models.postgres.user import User
from src.schemas.auth import LoginRequest, Token, UserSummary
from src.schemas.user import OwnerBootstrapRequest, PasswordResetRequest, PublicSignupRequest, UserCreate
from src.utils.auth_utils import create_access_token, get_password_hash, verify_password


class AuthService:
    def __init__(self, db: Session) -> None:
        self.repo = AuthRepository(db)

    async def register_user(self, payload: UserCreate) -> User:
        existing = self.repo.get_by_email(payload.email)
        if existing:
            raise auth.email_already_registered()
        user = User(
            name=payload.name,
            email=payload.email,
            password_hash=get_password_hash(payload.password),
            role=payload.role,
            phone=payload.phone,
        )
        return self.repo.create(user)

    async def signup_user(self, payload: PublicSignupRequest) -> User:
        existing = self.repo.get_by_email(payload.email)
        if existing:
            raise auth.email_already_registered()
        user = User(
            name=payload.name,
            email=payload.email,
            password_hash=get_password_hash(payload.password),
            role=None,
            phone=payload.phone,
        )
        return self.repo.create(user)

    async def bootstrap_owner(self, payload: OwnerBootstrapRequest) -> User:
        existing_owner = self.repo.get_owner()
        if existing_owner:
            raise auth.owner_already_exists()
        existing = self.repo.get_by_email(payload.email)
        if existing:
            raise auth.email_already_registered()
        user = User(
            name=payload.name,
            email=payload.email,
            password_hash=get_password_hash(payload.password),
            role=UserRole.OWNER,
            phone=payload.phone,
        )
        return self.repo.create(user)

    async def login_user(self, payload: LoginRequest) -> Token:
        clean_email = payload.email.strip() if payload.email else ""
        user = self.repo.get_by_email(clean_email)
        if not user or not verify_password(payload.password, user.password_hash):
            raise auth.invalid_credentials()
        if not user.is_active:
            raise auth.account_revoked()
        if user.role is None:
            raise auth.pending_approval()
        token = create_access_token(user.id)
        return Token(access_token=token, user=UserSummary.model_validate(user))

    async def list_pending_users(self) -> list[User]:
        return self.repo.list_pending_users()

    async def list_users(self, role: str | None = None) -> list[User]:
        return self.repo.list_users(role)

    async def assign_user_role(self, user_id: int, role: str) -> User:
        user = self.repo.get_by_id(user_id)
        if not user:
            raise recorded.user_not_found()
        return self.repo.update_role(user, role)

    async def reset_password(self, user_id: int, payload: PasswordResetRequest) -> User:
        user = self.repo.get_by_id(user_id)
        if not user:
            raise recorded.user_not_found()
        user.password_hash = get_password_hash(payload.password)
        return self.repo.save(user)

    async def set_access(self, user_id: int, is_active: bool) -> User:
        user = self.repo.get_by_id(user_id)
        if not user:
            raise recorded.user_not_found()
        user.is_active = is_active
        return self.repo.save(user)

    async def delete_user(self, user_id: int, current_user_id: int, delete_logs: bool = False) -> None:
        user = self.repo.get_by_id(user_id)
        if not user:
            raise recorded.user_not_found()
        if user.id == current_user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account.")
        if user.role == UserRole.OWNER:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The owner account cannot be deleted.")
        self.repo.delete(user, delete_logs=delete_logs)
