from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class SiteExpense(TimestampMixin, Base):
    __tablename__ = "site_expenses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    item_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    rate: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    description: Mapped[str | None] = mapped_column(Text)
    bill_url: Mapped[str | None] = mapped_column(String(500))
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    week_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allocation: Mapped[str] = mapped_column(String(20), nullable=False, default="other", server_default="other")
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    created_by = relationship("User")
    project = relationship("Project")
