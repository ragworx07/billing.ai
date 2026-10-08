from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base


class LaborLog(Base):
    __tablename__ = "labor_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendor_master.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    labour_type: Mapped[str] = mapped_column(String(120), nullable=False)
    labour_count: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    wage_per_head: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    overtime_cost: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    total_wage: Mapped[float | None] = mapped_column(Numeric(12, 2))
    remarks: Mapped[str | None] = mapped_column(String(255))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project", back_populates="labor_logs")
    vendor = relationship("VendorMaster")
