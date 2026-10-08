from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from src.data.clients.base_class import Base


class ExpenseMaster(Base):
    __tablename__ = 'expense_master'

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
