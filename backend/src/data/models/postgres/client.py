from datetime import datetime
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin



class Client(TimestampMixin, Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    company_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    alternate_phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    address_line1: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    pincode: Mapped[str] = mapped_column(String(12), nullable=False)
    gst_number: Mapped[str | None] = mapped_column(String(30))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    projects = relationship("Project", back_populates="client")

    @property
    def address(self) -> str:
        return self.address_line1

    @address.setter
    def address(self, value: str) -> None:
        self.address_line1 = value

    @property
    def pan_no(self) -> str | None:
        return self.company_name

    @pan_no.setter
    def pan_no(self, value: str | None) -> None:
        if value is not None or self.company_name is None:
            self.company_name = value

