from sqlalchemy.orm import Session

from src.core.exceptions.exceptions import auth, recorded
from src.core.services.audit_service import log_action
from src.data.models.postgres.enums import ProjectStatus, UserRole
from src.data.models.postgres.material_log import MaterialLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.core.permissions import is_project_operator
from src.data.repositories.material_repository import MaterialRepository
from src.data.repositories.project_repository import ProjectRepository
from src.schemas.material import MaterialLogBase


class MaterialService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.material_repo = MaterialRepository(db)
        self.project_repo = ProjectRepository(db)

    async def list_materials(self, project_id: int | None = None) -> list[MaterialLog]:
        return self.material_repo.list(project_id)

    async def create_material(self, user: User, payload: MaterialLogBase) -> MaterialLog:
        project = self.project_repo.get_by_id(payload.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        material = MaterialLog(**payload.model_dump())
        material = self.material_repo.create(material)
        self._mark_project_ongoing(project)
        log_action(self.db, user, "create", "material_logs", material.id)
        return material

    async def update_material(self, user: User, material_id: int, payload: MaterialLogBase) -> MaterialLog:
        material = self.material_repo.get_by_id(material_id)
        if not material:
            raise recorded.material_not_found()

        project = self.project_repo.get_by_id(payload.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        material = self.material_repo.update(material, payload.model_dump())
        log_action(self.db, user, "update", "material_logs", material.id)
        return material

    async def delete_material(self, user: User, material_id: int) -> None:
        material = self.material_repo.get_by_id(material_id)
        if not material:
            raise recorded.material_not_found()

        project = self.project_repo.get_by_id(material.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        self.material_repo.delete(material)
        log_action(self.db, user, "delete", "material_logs", material_id)

    def _allowed(self, project, user: User) -> bool:
        return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)

    def _mark_project_ongoing(self, project: Project) -> None:
        if project.status == ProjectStatus.UPCOMING:
            project.status = ProjectStatus.ONGOING
            self.db.add(project)
            self.db.commit()
