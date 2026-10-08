from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from src.data.clients.base_class import Base


class VendorMaster(Base):
    __tablename__ = 'vendor_master'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    party_type: Mapped[str] = mapped_column(String(30), nullable=False, default="material_vendor")
    work_field: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    address: Mapped[str] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
