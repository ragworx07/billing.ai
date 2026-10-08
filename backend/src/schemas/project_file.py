from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.common import ORMModel


class ProjectFileFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    parent_id: int | None = None


class ProjectFileFolderUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class ProjectFileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectFileFolderResponse(ORMModel):
    id: int
    project_id: int
    parent_id: int | None
    name: str
    created_by_id: int | None
    created_at: datetime
    updated_at: datetime


class ProjectFileResponse(ORMModel):
    id: int
    project_id: int
    folder_id: int | None
    original_filename: str
    stored_filename: str
    content_type: str
    original_size: int
    compressed_size: int
    uploaded_by_id: int | None
    created_at: datetime
    updated_at: datetime


class ProjectFileBoardResponse(BaseModel):
    folders: list[ProjectFileFolderResponse]
    files: list[ProjectFileResponse]
