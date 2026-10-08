from sqlalchemy import func
from sqlalchemy.orm import Session

from src.data.models.postgres.enums import UserRole
from src.data.models.postgres.user import User


class AuthRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_email(self, email: str) -> User | None:
        if not email:
            return None
        clean_email = email.strip().lower()
        return self.db.query(User).filter(func.lower(User.email) == clean_email).first()

    def get_owner(self) -> User | None:
        return self.db.query(User).filter(User.role == UserRole.OWNER).first()

    def create(self, user: User) -> User:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def list_pending_users(self) -> list[User]:
        return self.db.query(User).filter(User.role.is_(None)).order_by(User.created_at.desc()).all()

    def list_users(self, role: str | None = None) -> list[User]:
        query = self.db.query(User).filter(User.role.is_not(None))
        if role:
            query = query.filter(User.role == role)
        return query.order_by(User.created_at.asc(), User.id.asc()).all()

    def get_by_id(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def update_role(self, user: User, role: str) -> User:
        user.role = role
        user.is_active = True
        return self.save(user)

    def save(self, user: User) -> User:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def delete(self, user: User, delete_logs: bool = False) -> None:
        from src.data.models.postgres.audit_log import AuditLog

        if delete_logs:
            self.db.query(AuditLog).filter(AuditLog.user_id == user.id).delete(synchronize_session=False)
        else:
            self.db.query(AuditLog).filter(AuditLog.user_id == user.id).update(
                {AuditLog.actor_name: user.name, AuditLog.actor_email: user.email},
                synchronize_session=False,
            )
        self.db.delete(user)
        self.db.commit()
