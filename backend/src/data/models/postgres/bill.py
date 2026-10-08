from datetime import date, datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class Bill(TimestampMixin, Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bill_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    custom_project_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    shareholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_shareholders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bill_date: Mapped[date] = mapped_column(nullable=False, default=date.today)
    due_date: Mapped[date] = mapped_column(nullable=False, default=date.today)
    client_name: Mapped[str] = mapped_column(String(150), nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(150))
    billing_address: Mapped[str | None] = mapped_column(String(255))
    billing_city: Mapped[str | None] = mapped_column(String(120))
    billing_pincode: Mapped[str | None] = mapped_column(String(12))
    seal_type: Mapped[str] = mapped_column(String(50), default="developers", nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    cgst_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    sgst_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    tax_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    paid_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="unpaid", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    signature_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    gst_only: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project")
    shareholder = relationship("ProjectShareholder")
    items = relationship("BillItem", back_populates="bill", cascade="all, delete-orphan")


class BillItem(Base):
    __tablename__ = "bill_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    hsn_code: Mapped[str | None] = mapped_column(String(50), default="995411")
    cgst_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=2.5, nullable=False)
    sgst_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=2.5, nullable=False)
    cgst_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    sgst_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), default=1, nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    bill = relationship("Bill", back_populates="items")
