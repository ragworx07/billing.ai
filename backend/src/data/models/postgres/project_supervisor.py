from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.data.clients.base_class import Base


class ProjectSupervisor(Base):
    __tablename__ = "project_supervisors"
    __table_args__ = (UniqueConstraint("project_id", "supervisor_id", name="uq_project_supervisor"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    supervisor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
