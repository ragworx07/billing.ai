from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base


class MaterialLog(Base):
    __tablename__ = "material_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendor_master.id", ondelete="SET NULL"), nullable=True, index=True)
    material_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    unit_cost: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    supplier: Mapped[str | None] = mapped_column(String(120))
    work_remarks: Mapped[str | None] = mapped_column(String(255))
    total_cft: Mapped[float | None] = mapped_column(Numeric(12, 2))
    rate_per_cft: Mapped[float | None] = mapped_column(Numeric(12, 2))
    no_of_loads: Mapped[float | None] = mapped_column(Numeric(10, 2))
    gst_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    template_meta: Mapped[dict | None] = mapped_column(JSON)
    transport_cost: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    bill_url: Mapped[str | None] = mapped_column(String(500))
    bill_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project", back_populates="material_logs")
    vendor = relationship("VendorMaster")
