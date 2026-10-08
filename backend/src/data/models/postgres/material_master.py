from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from src.data.clients.base_class import Base


class MaterialMaster(Base):
    __tablename__ = 'material_master'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    supplier: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    default_unit_cost: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    has_bundle_conversion: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_bundle_weight: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
