from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base
from src.data.models.postgres.enums import AttendanceStatus, sql_enum


class AttendanceLog(Base):
    __tablename__ = "attendance_logs"
    __table_args__ = (UniqueConstraint("worker_id", "project_id", "date", name="uq_attendance_worker_project_date"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[AttendanceStatus] = mapped_column(
        sql_enum(AttendanceStatus, "attendance_status"), nullable=False
    )
    work_done: Mapped[str] = mapped_column(String(255), nullable=False, default="General labour")
    overtime_hours: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    worker = relationship("Worker", back_populates="attendance_logs")
    project = relationship("Project", back_populates="attendance_logs")
