from sqlalchemy.orm import Session

from src.core.exceptions.exceptions import auth, recorded
from src.core.services.audit_service import log_action
from src.core.permissions import is_project_operator
from src.data.models.postgres.enums import ProjectStatus, UserRole
from src.data.models.postgres.expense_log import ExpenseLog
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.data.repositories.expense_repository import ExpenseRepository
from src.data.repositories.project_repository import ProjectRepository
from src.schemas.expense import ExpenseLogBase


class ExpenseService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.expense_repo = ExpenseRepository(db)
        self.project_repo = ProjectRepository(db)

    async def list_expenses(self, project_id: int | None = None) -> list[ExpenseLog]:
        return self.expense_repo.list(project_id)

    async def create_expense(self, user: User, payload: ExpenseLogBase) -> ExpenseLog:
        project = self.project_repo.get_by_id(payload.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        expense = ExpenseLog(**payload.model_dump())
        expense = self.expense_repo.create(expense)
        self._mark_project_ongoing(project)
        log_action(self.db, user, "create", "expense_logs", expense.id)
        return expense

    async def update_expense(self, user: User, expense_id: int, payload: ExpenseLogBase) -> ExpenseLog:
        expense = self.expense_repo.get_by_id(expense_id)
        if not expense:
            raise recorded.expense_not_found()

        project = self.project_repo.get_by_id(payload.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        expense = self.expense_repo.update(expense, payload.model_dump())
        log_action(self.db, user, "update", "expense_logs", expense.id)
        return expense

    async def delete_expense(self, user: User, expense_id: int) -> None:
        expense = self.expense_repo.get_by_id(expense_id)
        if not expense:
            raise recorded.expense_not_found()

        project = self.project_repo.get_by_id(expense.project_id)
        if not project:
            raise recorded.project_not_found()
        if not self._allowed(project, user):
            raise auth.unauthorized_project_access()

        self.expense_repo.delete(expense)
        log_action(self.db, user, "delete", "expense_logs", expense_id)

    def _allowed(self, project, user: User) -> bool:
        return not is_project_operator(user) or project.supervisor_id == user.id or any(s.id == user.id for s in project.supervisors)

    def _mark_project_ongoing(self, project: Project) -> None:
        if project.status == ProjectStatus.UPCOMING:
            project.status = ProjectStatus.ONGOING
            self.db.add(project)
            self.db.commit()
