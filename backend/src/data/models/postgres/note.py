from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class Note(TimestampMixin, Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    important_info: Mapped[str] = mapped_column(String(255), nullable=False)
    reminder_when: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details: Mapped[str] = mapped_column(Text, nullable=False)
    reminder_label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    color: Mapped[str] = mapped_column(String(32), nullable=False, default="amber")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    attachments: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user = relationship("User")
