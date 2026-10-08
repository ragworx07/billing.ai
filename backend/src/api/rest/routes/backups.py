from __future__ import annotations

from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, get_db, require_roles
from src.config import config
from src.core.permissions import ADMIN_ROLES
from src.core.services.audit_service import log_action
from src.core.services.backup_service import backup_service
from src.core.services.storage_service import storage_service
from src.data.models.postgres.user import User

router = APIRouter()


class BackupOptionsPayload(BaseModel):
    include_database: bool = True
    include_financials: bool = True
    include_manifest: bool = True
    custom_folder_id: str | None = None


class BackupConfigPayload(BaseModel):
    enabled: bool | None = None
    frequency: str | None = None
    time: str | None = None
    retention: int | None = None
    destination: str | None = None
    gdrive_folder_id: str | None = None
    include_database: bool | None = None
    include_financials: bool | None = None
    include_manifest: bool | None = None


@router.get("/config")
async def get_backup_config(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    current_cfg = backup_service.get_config(db)
    last_status = backup_service.get_last_status(db)
    is_gdrive = storage_service.has_gdrive_storage

    return {
        "config": current_cfg,
        "last_status": last_status,
        "is_gdrive_connected": is_gdrive,
        "default_gdrive_root_id": config.GDRIVE_ROOT_FOLDER_ID,
    }


@router.put("/config")
async def update_backup_config(
    payload: BackupConfigPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    updated = backup_service.update_config(db, payload.model_dump(exclude_unset=True))
    log_action(db, user, "update", "backup_config", 0, details="Updated automated backup settings")
    return {
        "config": updated,
        "message": "Backup configuration updated successfully",
    }


@router.post("/export-local")
async def export_local_backup(
    payload: BackupOptionsPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    try:
        filename, zip_bytes = backup_service.create_backup_archive(
            db,
            include_database=payload.include_database,
            include_financials=payload.include_financials,
            include_manifest=payload.include_manifest,
            creator_name=user.name or user.email,
        )
        log_action(db, user, "export", "backup_local", 0, details=f"Downloaded local backup archive: {filename}")
        
        quoted_name = quote(filename)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_name}",
                "X-Backup-Filename": filename,
                "X-Backup-Size": str(len(zip_bytes)),
            },
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create backup: {str(e)}")


@router.post("/export-gdrive")
async def export_gdrive_backup(
    payload: BackupOptionsPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    if not storage_service.has_gdrive_storage:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected or configured.")
    
    try:
        options = {
            "include_database": payload.include_database,
            "include_financials": payload.include_financials,
            "include_manifest": payload.include_manifest,
        }
        res = backup_service.backup_to_gdrive(
            db,
            custom_folder_id=payload.custom_folder_id,
            options=options,
            creator_name=user.name or user.email,
        )
        log_action(db, user, "export", "backup_gdrive", 0, details=f"Uploaded backup to Google Drive: {res.get('filename')}")
        return res
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to backup to Google Drive: {str(e)}")


@router.get("/history")
async def get_backup_history(
    custom_folder_id: str | None = None,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    if not storage_service.has_gdrive_storage:
        return {"backups": []}
    
    backups = backup_service.list_gdrive_backups(custom_folder_id=custom_folder_id)
    return {"backups": backups}


@router.delete("/history/{file_id}")
async def delete_backup(
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    if not storage_service.has_gdrive_storage:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected.")
    
    success = backup_service.delete_gdrive_backup(file_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete backup from Google Drive.")
    
    log_action(db, user, "delete", "backup_gdrive", 0, details=f"Deleted backup {file_id} from Google Drive")
    return {"message": "Backup deleted successfully"}


@router.get("/download/{file_id}")
async def download_backup_file(
    file_id: str,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    if not storage_service.has_gdrive_storage:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected.")
    
    try:
        filename, content = backup_service.download_gdrive_backup(file_id)
        quoted_name = quote(filename)
        return Response(
            content=content,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_name}",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to download backup: {str(e)}")
