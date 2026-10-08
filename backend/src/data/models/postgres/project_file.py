from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.data.clients.base_class import Base, TimestampMixin


class ProjectFile(TimestampMixin, Base):
    __tablename__ = "project_files"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("project_file_folders.id", ondelete="CASCADE"), nullable=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(600), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(160), nullable=False, default="application/octet-stream")
    original_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    compressed_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="files")
    folder = relationship("ProjectFileFolder", back_populates="files")
    uploaded_by = relationship("User")
