from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, get_db, require_roles
from src.core.permissions import ADMIN_ROLES
from src.core.services.audit_service import (
    CUSTOM_ROLES_RECORD_ID,
    ROLE_PERMISSIONS_RECORD_ID,
    log_action,
    summarize_custom_role_changes,
    summarize_permission_changes,
)
from src.data.models.postgres.system_setting import SystemSetting
from src.data.models.postgres.user import User

router = APIRouter()


class PermissionsSettingsPayload(BaseModel):
    role_permissions: dict[str, list[str]] | None = None
    custom_user_roles: list[dict] | None = None


class PermissionsSettingsResponse(BaseModel):
    role_permissions: dict[str, list[str]]
    custom_user_roles: list[dict]


@router.get("/permissions", response_model=PermissionsSettingsResponse)
async def get_permissions_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    perms_setting = db.query(SystemSetting).filter(SystemSetting.key == "role_permissions").first()
    roles_setting = db.query(SystemSetting).filter(SystemSetting.key == "custom_user_roles").first()

    role_permissions = perms_setting.value if perms_setting and isinstance(perms_setting.value, dict) else {}
    custom_user_roles = roles_setting.value if roles_setting and isinstance(roles_setting.value, list) else []

    return PermissionsSettingsResponse(
        role_permissions=role_permissions,
        custom_user_roles=custom_user_roles,
    )


@router.put("/permissions", response_model=PermissionsSettingsResponse)
async def update_permissions_settings(
    payload: PermissionsSettingsPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    permission_details = None
    custom_role_details = None

    if payload.role_permissions is not None:
        perms_setting = db.query(SystemSetting).filter(SystemSetting.key == "role_permissions").first()
        previous = {
            str(role): [str(key) for key in (keys or [])]
            for role, keys in (perms_setting.value.items() if perms_setting and isinstance(perms_setting.value, dict) else [])
        }
        if not perms_setting:
            perms_setting = SystemSetting(key="role_permissions", value=payload.role_permissions)
            db.add(perms_setting)
        else:
            perms_setting.value = payload.role_permissions
        permission_details = summarize_permission_changes(previous, payload.role_permissions)

    if payload.custom_user_roles is not None:
        roles_setting = db.query(SystemSetting).filter(SystemSetting.key == "custom_user_roles").first()
        previous_roles = list(roles_setting.value) if roles_setting and isinstance(roles_setting.value, list) else []
        if not roles_setting:
            roles_setting = SystemSetting(key="custom_user_roles", value=payload.custom_user_roles)
            db.add(roles_setting)
        else:
            roles_setting.value = payload.custom_user_roles
        custom_role_details = summarize_custom_role_changes(previous_roles, payload.custom_user_roles)

    db.commit()

    if permission_details:
        log_action(db, user, "update", "role_permissions", ROLE_PERMISSIONS_RECORD_ID, details=permission_details)
    if custom_role_details:
        log_action(db, user, "update", "custom_user_roles", CUSTOM_ROLES_RECORD_ID, details=custom_role_details)

    return await get_permissions_settings(db=db, _=user)
