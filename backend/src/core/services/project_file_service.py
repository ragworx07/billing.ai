from __future__ import annotations

from urllib.parse import quote

from fastapi import HTTPException, UploadFile, status

from src.core.services.storage_service import storage_service
from src.core.services.audit_service import log_action
from src.data.models.postgres.enums import UserRole
from src.core.permissions import ADMIN_ROLES
from src.data.models.postgres.project import Project
from src.data.models.postgres.project_file import ProjectFile
from src.data.models.postgres.project_file_folder import ProjectFileFolder
from src.data.models.postgres.user import User
from src.data.repositories.project_file_repository import ProjectFileRepository
from src.core.permissions import is_project_operator
from src.schemas.project_file import ProjectFileBoardResponse, ProjectFileFolderCreate, ProjectFileFolderUpdate, ProjectFileUpdate


class ProjectFileService:
    def __init__(self, repo: ProjectFileRepository) -> None:
        self.repo = repo

    def _require_project(self, project_id: int) -> Project:
        project = self.repo.get_project(project_id)
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        return project

    @staticmethod
    def _can_read(project: Project, user: User) -> bool:
        if user.role in (*ADMIN_ROLES, UserRole.CLIENT_MANAGER, UserRole.ACCOUNTANT):
            return True
        if is_project_operator(user):
            return project.supervisor_id == user.id or any(supervisor.id == user.id for supervisor in project.supervisors)
        return False

    @staticmethod
    def _can_write(project: Project, user: User) -> bool:
        if user.role in (*ADMIN_ROLES, UserRole.CLIENT_MANAGER):
            return True
        if is_project_operator(user):
            return project.supervisor_id == user.id or any(supervisor.id == user.id for supervisor in project.supervisors)
        return False

    def _require_read(self, project_id: int, user: User) -> Project:
        project = self._require_project(project_id)
        if not self._can_read(project, user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return project

    def _require_write(self, project_id: int, user: User) -> Project:
        project = self._require_project(project_id)
        if not self._can_write(project, user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return project

    def _require_folder(self, project_id: int, folder_id: int) -> ProjectFileFolder:
        folder = self.repo.get_folder(folder_id)
        if not folder or folder.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        return folder

    def _require_file(self, project_id: int, file_id: int) -> ProjectFile:
        project_file = self.repo.get_file(file_id)
        if not project_file or project_file.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return project_file

    def _validate_parent(self, project_id: int, parent_id: int | None) -> None:
        if parent_id is not None:
            self._require_folder(project_id, parent_id)

    def list_board(self, project_id: int, user: User) -> ProjectFileBoardResponse:
        self._require_read(project_id, user)
        return ProjectFileBoardResponse(
            folders=self.repo.list_folders(project_id),
            files=self.repo.list_files(project_id),
        )

    def create_folder(self, project_id: int, payload: ProjectFileFolderCreate, user: User) -> ProjectFileFolder:
        self._require_write(project_id, user)
        self._validate_parent(project_id, payload.parent_id)
        folder = ProjectFileFolder(
            project_id=project_id,
            parent_id=payload.parent_id,
            name=payload.name.strip(),
            created_by_id=user.id,
        )
        folder = self.repo.create_folder(folder)
        log_action(self.repo.db, user, "create", "project_file_folders", folder.id)
        return folder

    def rename_folder(self, project_id: int, folder_id: int, payload: ProjectFileFolderUpdate, user: User) -> ProjectFileFolder:
        self._require_write(project_id, user)
        folder = self._require_folder(project_id, folder_id)
        folder = self.repo.update_folder_name(folder, payload.name.strip())
        log_action(self.repo.db, user, "update", "project_file_folders", folder.id)
        return folder

    def delete_folder(self, project_id: int, folder_id: int, user: User) -> None:
        self._require_write(project_id, user)
        folder = self._require_folder(project_id, folder_id)
        folder_ids = self.repo.descendant_folder_ids(project_id, folder_id)
        files = self.repo.files_in_folders(project_id, folder_ids)
        bucket_paths: dict[str, list[str]] = {}
        for file_row in files:
            bucket_paths.setdefault(file_row.storage_bucket, []).append(file_row.storage_path)
        for bucket, paths in bucket_paths.items():
            storage_service.delete_project_files(bucket, paths)
        self.repo.delete_folder_tree(folder)
        log_action(self.repo.db, user, "delete", "project_file_folders", folder_id)

    async def upload_file(self, project_id: int, folder_id: int | None, file: UploadFile, user: User) -> ProjectFile:
        self._require_write(project_id, user)
        self._validate_parent(project_id, folder_id)
        upload = await storage_service.upload_project_file(project_id, folder_id, file)
        project_file = ProjectFile(
            project_id=project_id,
            folder_id=folder_id,
            original_filename=str(upload["original_filename"]),
            stored_filename=str(upload["stored_filename"]),
            storage_bucket=str(upload["bucket"]),
            storage_path=str(upload["storage_path"]),
            content_type=str(upload["content_type"]),
            original_size=int(upload["original_size"]),
            compressed_size=int(upload["compressed_size"]),
            uploaded_by_id=user.id,
        )
        project_file = self.repo.create_file(project_file)
        log_action(self.repo.db, user, "create", "project_files", project_file.id)
        return project_file

    def rename_file(self, project_id: int, file_id: int, payload: ProjectFileUpdate, user: User) -> ProjectFile:
        self._require_write(project_id, user)
        project_file = self._require_file(project_id, file_id)
        project_file = self.repo.update_file_name(project_file, payload.name.strip())
        log_action(self.repo.db, user, "update", "project_files", project_file.id)
        return project_file

    def delete_file(self, project_id: int, file_id: int, user: User) -> None:
        self._require_write(project_id, user)
        project_file = self._require_file(project_id, file_id)
        storage_service.delete_project_files(project_file.storage_bucket, [project_file.storage_path])
        self.repo.delete_file(project_file)
        log_action(self.repo.db, user, "delete", "project_files", file_id)

    def download_file(self, project_id: int, file_id: int, user: User) -> tuple[ProjectFile, bytes, dict[str, str]]:
        self._require_read(project_id, user)
        project_file = self._require_file(project_id, file_id)
        _, content = storage_service.download_project_file(project_file.storage_bucket, project_file.storage_path)
        quoted_name = quote(project_file.original_filename)
        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted_name}",
            "X-Compressed-Size": str(project_file.compressed_size),
            "X-Original-Size": str(project_file.original_size),
        }
        return project_file, content, headers

    def view_file(self, project_id: int, file_id: int, user: User) -> tuple[ProjectFile, bytes, dict[str, str]]:
        self._require_read(project_id, user)
        project_file = self._require_file(project_id, file_id)
        _, content = storage_service.download_project_file(project_file.storage_bucket, project_file.storage_path)
        quoted_name = quote(project_file.original_filename)
        headers = {
            "Content-Disposition": f"inline; filename*=UTF-8''{quoted_name}",
            "X-Compressed-Size": str(project_file.compressed_size),
            "X-Original-Size": str(project_file.original_size),
        }
        return project_file, content, headers
