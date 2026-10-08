from sqlalchemy.orm import Session

from src.data.models.postgres.project import Project


class ProjectRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, project_id: int) -> Project | None:
        project = self.db.get(Project, project_id)
        if project is None or project.deleted_at is not None:
            return None
        return project
