from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin
from src.data.models.postgres.enums import ProjectStatus, sql_enum


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    project_name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_end_date: Mapped[date | None] = mapped_column(Date)
    estimated_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    construction_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    construction_rate_per_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=4500, nullable=False)
    govt_composite_value_per_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    govt_land_factor: Mapped[float] = mapped_column(Numeric(8, 4), default=1, nullable=False)
    govt_gst_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=5, nullable=False)
    govt_registration_value_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=4, nullable=False)
    govt_construction_cost_per_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    govt_new_gst_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=5, nullable=False)
    govt_new_reg_upto_50l_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=6, nullable=False)
    govt_new_reg_upto_3cr_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=7, nullable=False)
    govt_new_reg_above_3cr_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=9, nullable=False)
    govt_new_legal_charges: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    status: Mapped[ProjectStatus] = mapped_column(
        sql_enum(ProjectStatus, "project_status"), default=ProjectStatus.UPCOMING, nullable=False, index=True
    )
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    existing_shareholders_count: Mapped[int] = mapped_column(default=0, nullable=False)
    new_shareholders_count: Mapped[int] = mapped_column(default=0, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    client = relationship("Client", back_populates="projects")
    supervisor = relationship("User", back_populates="supervised_projects")
    supervisors = relationship("User", secondary="project_supervisors", back_populates="assigned_projects")
    attendance_logs = relationship("AttendanceLog", back_populates="project", cascade="all, delete-orphan")
    material_logs = relationship("MaterialLog", back_populates="project", cascade="all, delete-orphan")
    expense_logs = relationship("ExpenseLog", back_populates="project", cascade="all, delete-orphan")
    payment_logs = relationship("PaymentLog", back_populates="project", cascade="all, delete-orphan")
    work_reports = relationship("WorkReport", back_populates="project", cascade="all, delete-orphan")
    labor_logs = relationship("LaborLog", back_populates="project", cascade="all, delete-orphan")
    shareholders = relationship("ProjectShareholder", back_populates="project", cascade="all, delete-orphan")
    file_folders = relationship("ProjectFileFolder", back_populates="project", cascade="all, delete-orphan")
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    milestones = relationship("ProjectMilestone", back_populates="project", cascade="all, delete-orphan")
