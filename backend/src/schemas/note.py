from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.schemas.common import ORMModel


class NoteAttachment(BaseModel):
    id: str
    name: str
    type: str
    size: int
    data_url: str = Field(default="", alias="dataUrl")
    storage_bucket: str | None = Field(default=None, alias="storageBucket")
    storage_path: str | None = Field(default=None, alias="storagePath")

    model_config = ConfigDict(populate_by_name=True)


class NoteRecord(BaseModel):
    id: str
    order: int
    x: int
    y: int
    topic: str
    important_info: str = Field(alias="importantInfo")
    reminder_when: datetime | None = Field(default=None, alias="reminderWhen")
    details: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    reminder_label: str = Field(alias="reminderLabel")
    color: str
    priority: str
    attachments: list[NoteAttachment] = Field(default_factory=list)
    archived_at: datetime | None = Field(default=None, alias="archivedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @field_validator("reminder_when", "archived_at", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value


class StoredNotes(BaseModel):
    active: list[NoteRecord] = Field(default_factory=list)
    archived: list[NoteRecord] = Field(default_factory=list)


class NotePayload(StoredNotes):
    model_config = ConfigDict(populate_by_name=True)


class NoteResponse(StoredNotes, ORMModel):
    pass
