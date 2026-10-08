from __future__ import annotations

from sqlalchemy.orm import Session

from src.data.models.postgres.project import Project
from src.data.models.postgres.project_file import ProjectFile
from src.data.models.postgres.project_file_folder import ProjectFileFolder


class ProjectFileRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_project(self, project_id: int) -> Project | None:
        return self.db.get(Project, project_id)

    def list_folders(self, project_id: int) -> list[ProjectFileFolder]:
        return (
            self.db.query(ProjectFileFolder)
            .filter(ProjectFileFolder.project_id == project_id)
            .order_by(ProjectFileFolder.name.asc())
            .all()
        )

    def list_files(self, project_id: int) -> list[ProjectFile]:
        return (
            self.db.query(ProjectFile)
            .filter(ProjectFile.project_id == project_id)
            .order_by(ProjectFile.created_at.desc(), ProjectFile.original_filename.asc())
            .all()
        )

    def get_folder(self, folder_id: int) -> ProjectFileFolder | None:
        return self.db.get(ProjectFileFolder, folder_id)

    def get_file(self, file_id: int) -> ProjectFile | None:
        return self.db.get(ProjectFile, file_id)

    def create_folder(self, folder: ProjectFileFolder) -> ProjectFileFolder:
        self.db.add(folder)
        self.db.commit()
        self.db.refresh(folder)
        return folder

    def update_folder_name(self, folder: ProjectFileFolder, name: str) -> ProjectFileFolder:
        folder.name = name
        self.db.add(folder)
        self.db.commit()
        self.db.refresh(folder)
        return folder

    def create_file(self, project_file: ProjectFile) -> ProjectFile:
        self.db.add(project_file)
        self.db.commit()
        self.db.refresh(project_file)
        return project_file

    def update_file_name(self, project_file: ProjectFile, name: str) -> ProjectFile:
        project_file.original_filename = name
        self.db.add(project_file)
        self.db.commit()
        self.db.refresh(project_file)
        return project_file

    def delete_file(self, project_file: ProjectFile) -> None:
        self.db.delete(project_file)
        self.db.commit()

    def descendant_folder_ids(self, project_id: int, folder_id: int) -> set[int]:
        folders = self.list_folders(project_id)
        children_by_parent: dict[int | None, list[int]] = {}
        for folder in folders:
            children_by_parent.setdefault(folder.parent_id, []).append(folder.id)

        result: set[int] = set()
        stack = [folder_id]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(children_by_parent.get(current, []))
        return result

    def files_in_folders(self, project_id: int, folder_ids: set[int]) -> list[ProjectFile]:
        if not folder_ids:
            return []
        return self.db.query(ProjectFile).filter(ProjectFile.project_id == project_id, ProjectFile.folder_id.in_(folder_ids)).all()

    def delete_folder_tree(self, folder: ProjectFileFolder) -> None:
        self.db.delete(folder)
        self.db.commit()
