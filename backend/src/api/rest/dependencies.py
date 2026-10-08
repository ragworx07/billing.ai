from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from src.config import config
from src.core.exceptions.exceptions import AuthException
from src.core.services.auth_service import AuthService
from src.core.services.expense_service import ExpenseService
from src.core.services.notes_service import NotesService
from src.core.services.material_service import MaterialService
from src.data.clients.session import get_db
from src.data.models.postgres.enums import UserRole
from src.data.models.postgres.user import User
from src.utils.auth_utils import get_subject_from_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{config.API_V1_STR}/auth/login")


async def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    try:
        user_id = get_subject_from_token(token)
    except AuthException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.get(User, user_id)
    if not user or not user.is_active or user.role is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_roles(*roles: UserRole | str):
    def role_dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return current_user

    return role_dependency


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


def get_expense_service(db: Session = Depends(get_db)) -> ExpenseService:
    return ExpenseService(db)


def get_material_service(db: Session = Depends(get_db)) -> MaterialService:
    return MaterialService(db)


def get_notes_service(db: Session = Depends(get_db)) -> NotesService:
    return NotesService(db)
