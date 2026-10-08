from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base


class VendorTransaction(Base):
    __tablename__ = 'vendor_transactions'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey('vendor_master.id', ondelete='RESTRICT'), nullable=False, index=True)
    payment_date: Mapped[datetime] = mapped_column(Date, nullable=False, default=datetime.utcnow)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    round_off: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    payment_mode: Mapped[str] = mapped_column(String(50), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship('Project')
    vendor = relationship('VendorMaster')
