from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user, get_db
from src.core.services.project_file_service import ProjectFileService
from src.data.models.postgres.user import User
from src.data.repositories.project_file_repository import ProjectFileRepository
from src.schemas.project_file import (
    ProjectFileBoardResponse,
    ProjectFileFolderCreate,
    ProjectFileFolderResponse,
    ProjectFileFolderUpdate,
    ProjectFileResponse,
    ProjectFileUpdate,
)

router = APIRouter()


def get_project_file_service(db: Session = Depends(get_db)) -> ProjectFileService:
    return ProjectFileService(ProjectFileRepository(db))


@router.get("/{project_id}/files", response_model=ProjectFileBoardResponse)
async def list_project_files(
    project_id: int,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    return service.list_board(project_id, user)


@router.post("/{project_id}/file-folders", response_model=ProjectFileFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_project_file_folder(
    project_id: int,
    payload: ProjectFileFolderCreate,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    return service.create_folder(project_id, payload, user)


@router.put("/{project_id}/file-folders/{folder_id}", response_model=ProjectFileFolderResponse)
async def rename_project_file_folder(
    project_id: int,
    folder_id: int,
    payload: ProjectFileFolderUpdate,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    return service.rename_folder(project_id, folder_id, payload, user)


@router.delete("/{project_id}/file-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_file_folder(
    project_id: int,
    folder_id: int,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    service.delete_folder(project_id, folder_id, user)


@router.post("/{project_id}/files", response_model=ProjectFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_project_file(
    project_id: int,
    folder_id: int | None = Form(default=None),
    file: UploadFile = File(...),
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    return await service.upload_file(project_id, folder_id, file, user)


@router.put("/{project_id}/files/{file_id}", response_model=ProjectFileResponse)
async def rename_project_file(
    project_id: int,
    file_id: int,
    payload: ProjectFileUpdate,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    return service.rename_file(project_id, file_id, payload, user)


@router.delete("/{project_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_file(
    project_id: int,
    file_id: int,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    service.delete_file(project_id, file_id, user)


@router.get("/{project_id}/files/{file_id}/download")
async def download_project_file(
    project_id: int,
    file_id: int,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    project_file, content, headers = service.download_file(project_id, file_id, user)
    return Response(content=content, media_type=project_file.content_type, headers=headers)


@router.get("/{project_id}/files/{file_id}/view")
async def view_project_file(
    project_id: int,
    file_id: int,
    service: ProjectFileService = Depends(get_project_file_service),
    user: User = Depends(get_current_user),
):
    project_file, content, headers = service.view_file(project_id, file_id, user)
    return Response(content=content, media_type=project_file.content_type, headers=headers)
