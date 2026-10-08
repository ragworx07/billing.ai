from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base
from src.data.models.postgres.enums import PaymentStatus, PaymentType, sql_enum


class PaymentLog(Base):
    __tablename__ = "payment_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    payment_type: Mapped[PaymentType] = mapped_column(
        sql_enum(PaymentType, "payment_type"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_mode: Mapped[str | None] = mapped_column(String(50))
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    received_date: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[PaymentStatus] = mapped_column(
        sql_enum(PaymentStatus, "payment_status"), default=PaymentStatus.PENDING, nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(String(500))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project", back_populates="payment_logs")
