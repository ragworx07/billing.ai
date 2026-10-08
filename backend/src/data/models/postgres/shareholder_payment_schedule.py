from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class ShareholderPaymentSchedule(TimestampMixin, Base):
    __tablename__ = "shareholder_payment_schedules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    shareholder_id: Mapped[int] = mapped_column(
        ForeignKey("project_shareholders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    installment_no: Mapped[int] = mapped_column(nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    percentage: Mapped[float] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    remarks: Mapped[str | None] = mapped_column(String(255))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project")
    shareholder = relationship("ProjectShareholder")
