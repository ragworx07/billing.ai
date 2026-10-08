from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class LabourInchargeLimit(TimestampMixin, Base):
    __tablename__ = "labour_incharge_limits"
    __table_args__ = (
        UniqueConstraint("project_id", "vendor_id", name="uq_labour_incharge_limits_project_vendor"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendor_master.id", ondelete="CASCADE"), nullable=False, index=True)
    limit_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    project = relationship("Project")
    vendor = relationship("VendorMaster")
