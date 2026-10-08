from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class ShareholderPayment(TimestampMixin, Base):
    __tablename__ = "shareholder_payments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    shareholder_id: Mapped[int] = mapped_column(
        ForeignKey("project_shareholders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_mode: Mapped[str | None] = mapped_column(String(50))
    purpose: Mapped[str] = mapped_column(String(30), default="construction", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project")
    shareholder = relationship("ProjectShareholder")
