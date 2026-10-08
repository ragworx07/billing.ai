from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_auth_service, get_current_user, get_db, require_roles
from src.core.permissions import ADMIN_ROLES
from src.data.models.postgres.user import User
from src.core.services.audit_service import log_action, role_label
from src.core.services.auth_service import AuthService
from src.schemas.auth import LoginRequest, Token
from src.schemas.user import (
    OwnerBootstrapRequest,
    PasswordResetRequest,
    PublicSignupRequest,
    RoleAssignmentRequest,
    UserCreate,
    UserResponse,
)
router = APIRouter()


def _user_role_text(user: User) -> str:
    if user.role is None:
        return "unassigned"
    value = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role_label(value)


@router.post("/login", response_model=Token)
async def login(
    payload: LoginRequest,
    service: AuthService = Depends(get_auth_service),
):
    return await service.login_user(payload)


@router.post("/bootstrap-owner", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_owner(
    payload: OwnerBootstrapRequest,
    service: AuthService = Depends(get_auth_service),
):
    return await service.bootstrap_owner(payload)


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: PublicSignupRequest,
    service: AuthService = Depends(get_auth_service),
):
    return await service.signup_user(payload)


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    service: AuthService = Depends(get_auth_service),
    actor: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    created = await service.register_user(payload)
    log_action(
        db,
        actor,
        "create",
        "users",
        created.id,
        details=f"Created login {created.name} ({created.email}) as {_user_role_text(created)}",
    )
    return created


@router.get("/pending-users", response_model=list[UserResponse])
async def list_pending_users(
    service: AuthService = Depends(get_auth_service),
    _: User = Depends(require_roles(*ADMIN_ROLES)),
):
    return await service.list_pending_users()


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    role: str | None = None,
    service: AuthService = Depends(get_auth_service),
    _: User = Depends(require_roles(*ADMIN_ROLES)),
):
    return await service.list_users(role)


@router.put("/users/{user_id}/role", response_model=UserResponse)
async def assign_user_role(
    user_id: int,
    payload: RoleAssignmentRequest,
    service: AuthService = Depends(get_auth_service),
    actor: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    existing = service.repo.get_by_id(user_id)
    previous_role = _user_role_text(existing) if existing else "unassigned"
    updated = await service.assign_user_role(user_id, payload.role)
    log_action(
        db,
        actor,
        "update",
        "users",
        updated.id,
        details=f"Changed {updated.name} role from {previous_role} to {_user_role_text(updated)}",
    )
    return updated


@router.post("/users/{user_id}/reset-password", response_model=UserResponse)
async def reset_user_password(
    user_id: int,
    payload: PasswordResetRequest,
    service: AuthService = Depends(get_auth_service),
    actor: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    updated = await service.reset_password(user_id, payload)
    log_action(db, actor, "update", "users", updated.id, details=f"Reset password for {updated.name} ({updated.email})")
    return updated


@router.post("/users/{user_id}/revoke", response_model=UserResponse)
async def revoke_user_access(
    user_id: int,
    service: AuthService = Depends(get_auth_service),
    owner: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    if owner.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The owner cannot revoke their own access")
    updated = await service.set_access(user_id, False)
    log_action(db, owner, "update", "users", updated.id, details=f"Revoked access for {updated.name} ({updated.email})")
    return updated


@router.post("/users/{user_id}/restore", response_model=UserResponse)
async def restore_user_access(
    user_id: int,
    service: AuthService = Depends(get_auth_service),
    actor: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    updated = await service.set_access(user_id, True)
    log_action(db, actor, "update", "users", updated.id, details=f"Restored access for {updated.name} ({updated.email})")
    return updated
@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    delete_logs: bool = Query(False),
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
):
    target = service.repo.get_by_id(user_id)
    target_name = target.name if target else f"#{user_id}"
    target_email = target.email if target else ""
    await service.delete_user(user_id, current_user.id, delete_logs=delete_logs)
    log_action(
        db,
        current_user,
        "delete",
        "users",
        user_id,
        details=f"Deleted login {target_name} ({target_email})" + (" and activity logs" if delete_logs else ""),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
