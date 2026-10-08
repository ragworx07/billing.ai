from sqlalchemy.orm import Session

from src.data.models.postgres.expense_log import ExpenseLog


class ExpenseRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, project_id: int | None = None) -> list[ExpenseLog]:
        query = self.db.query(ExpenseLog).filter(ExpenseLog.deleted_at == None)
        if project_id:
            query = query.filter(ExpenseLog.project_id == project_id)
        return query.order_by(ExpenseLog.date.desc()).all()

    def get_by_id(self, expense_id: int) -> ExpenseLog | None:
        expense = self.db.get(ExpenseLog, expense_id)
        if expense and expense.deleted_at is not None:
            return None
        return expense

    def create(self, expense: ExpenseLog) -> ExpenseLog:
        self.db.add(expense)
        self.db.commit()
        self.db.refresh(expense)
        return expense

    def update(self, expense: ExpenseLog, payload: dict) -> ExpenseLog:
        for key, value in payload.items():
            setattr(expense, key, value)
        self.db.add(expense)
        self.db.commit()
        self.db.refresh(expense)
        return expense

    def delete(self, expense: ExpenseLog) -> None:
        from datetime import datetime
        expense.deleted_at = datetime.utcnow()
        self.db.add(expense)
        self.db.commit()
