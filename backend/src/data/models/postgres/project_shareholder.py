from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class ProjectShareholder(TimestampMixin, Base):
    __tablename__ = "project_shareholders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(120))
    pincode: Mapped[str | None] = mapped_column(String(12))
    is_existing_shareholder: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    existing_area: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    existing_uds: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    free_cost_area: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    new_area: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    new_uds: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    additional_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    rate_per_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    round_off: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    legal_charges: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    due_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    project = relationship("Project", back_populates="shareholders")

    @property
    def pan_no(self) -> str | None:
        return self.company_name

    @pan_no.setter
    def pan_no(self, value: str | None) -> None:
        if value is not None or self.company_name is None:
            self.company_name = value

