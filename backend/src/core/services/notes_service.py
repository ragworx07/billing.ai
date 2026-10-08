import base64
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.core.services.storage_service import storage_service
from src.data.models.postgres.note import Note
from src.data.models.postgres.user import User
from src.data.repositories.notes_repository import NotesRepository
from src.schemas.note import NoteAttachment, NotePayload, NoteResponse, NoteRecord


class NotesService:
    MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

    def __init__(self, db: Session) -> None:
        self.notes_repo = NotesRepository(db)

    async def get_board(self, user: User) -> NoteResponse:
        notes = self.notes_repo.list_for_user(user.id)
        self._migrate_legacy_attachments(user, notes)
        active: list[NoteRecord] = []
        archived: list[NoteRecord] = []
        for note in notes:
            note_payload = self._to_record(note)
            if note.archived_at:
                archived.append(note_payload)
            else:
                active.append(note_payload)
        return NoteResponse(active=active, archived=archived)

    async def replace_board(self, user: User, payload: NotePayload) -> NoteResponse:
        existing_notes = self.notes_repo.map_for_user(user.id)
        existing_storage_paths = self._storage_paths(existing_notes.values())
        incoming_ids: set[str] = set()
        incoming_storage_paths: set[tuple[str, str]] = set()
        notes_to_save: list[Note] = []
        now = datetime.now(timezone.utc)

        for note_data in payload.active + payload.archived:
            note = existing_notes.get(note_data.id)
            if not note:
                note = Note(id=note_data.id, user_id=user.id)

            note.user_id = user.id
            note.sort_order = note_data.order
            note.x = note_data.x
            note.y = note_data.y
            note.topic = note_data.topic
            note.important_info = note_data.important_info
            note.reminder_when = note_data.reminder_when
            note.details = self._strip_attachment_frames(note_data.details)
            note.reminder_label = note_data.reminder_label
            note.color = note_data.color
            note.priority = note_data.priority
            stored_attachments: list[dict] = []
            for attachment in note_data.attachments:
                stored = self._store_attachment(user.id, attachment)
                stored_attachments.append(stored)
                if stored.get("storage_bucket") and stored.get("storage_path"):
                    incoming_storage_paths.add((str(stored["storage_bucket"]), str(stored["storage_path"])))
            note.attachments = stored_attachments
            note.archived_at = note_data.archived_at
            note.created_at = note_data.created_at or getattr(note, "created_at", now)
            note.updated_at = note_data.updated_at or now

            notes_to_save.append(note)
            incoming_ids.add(note.id)

        self.notes_repo.save_all_for_user(user.id, notes_to_save, incoming_ids)
        removed_storage_paths = existing_storage_paths - incoming_storage_paths
        if removed_storage_paths:
            try:
                storage_service.delete_note_files(removed_storage_paths)
            except Exception:
                # The note save is authoritative. Orphan cleanup can be retried separately.
                pass
        return await self.get_board(user)

    async def upload_attachment(self, user: User, file: UploadFile) -> NoteAttachment:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment is empty")
        if len(content) > self.MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Note attachments must be 6 MB or smaller")

        attachment_id = f"attachment-{uuid4().hex}"
        content_type = file.content_type or "application/octet-stream"
        upload = storage_service.upload_note_attachment_bytes(
            user.id,
            attachment_id,
            file.filename or "Attachment",
            content_type,
            content,
        )
        return NoteAttachment(
            id=attachment_id,
            name=file.filename or "Attachment",
            type=content_type,
            size=len(content),
            dataUrl=str(upload["data_url"]),
            storageBucket=str(upload["bucket"]),
            storagePath=str(upload["storage_path"]),
        )

    def _to_record(self, note: Note) -> NoteRecord:
        attachments: list[NoteAttachment] = []
        for raw_attachment in note.attachments or []:
            attachment = NoteAttachment.model_validate(raw_attachment)
            if attachment.storage_bucket and attachment.storage_path:
                attachment.data_url = storage_service.note_attachment_url(
                    attachment.storage_bucket,
                    attachment.storage_path,
                    attachment.type,
                )
            attachments.append(attachment)
        return NoteRecord(
            id=note.id,
            order=note.sort_order,
            x=note.x,
            y=note.y,
            topic=note.topic,
            important_info=note.important_info,
            reminder_when=note.reminder_when,
            details=note.details,
            created_at=note.created_at,
            updated_at=note.updated_at,
            reminder_label=note.reminder_label,
            color=note.color,
            priority=note.priority,
            attachments=attachments,
            archived_at=note.archived_at,
        )

    @staticmethod
    def _strip_attachment_frames(details: str) -> str:
        cleaned = re.sub(
            r'<figure\b[^>]*data-attachment-id=["\'][^"\']+["\'][^>]*>.*?</figure>',
            "",
            details,
            flags=re.IGNORECASE | re.DOTALL,
        ).strip()
        return cleaned or "<p><br></p>"

    @staticmethod
    def _storage_paths(notes) -> set[tuple[str, str]]:
        paths: set[tuple[str, str]] = set()
        for note in notes:
            for raw_attachment in note.attachments or []:
                attachment = NoteAttachment.model_validate(raw_attachment)
                if attachment.storage_bucket and attachment.storage_path:
                    paths.add((attachment.storage_bucket, attachment.storage_path))
        return paths

    def _store_attachment(self, user_id: int, attachment: NoteAttachment) -> dict:
        if attachment.storage_bucket and attachment.storage_path:
            stored = attachment.model_dump(by_alias=False)
            stored["data_url"] = ""
            return stored

        if attachment.data_url.startswith("data:") and ";base64," in attachment.data_url:
            header, encoded = attachment.data_url.split(",", 1)
            content = base64.b64decode(encoded)
            if len(content) > self.MAX_ATTACHMENT_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"{attachment.name} exceeds the 6 MB note attachment limit")
            content_type = header.removeprefix("data:").split(";", 1)[0] or attachment.type
            upload = storage_service.upload_note_attachment_bytes(
                user_id,
                attachment.id,
                attachment.name,
                content_type,
                content,
            )
            return {
                "id": attachment.id,
                "name": attachment.name,
                "type": content_type,
                "size": len(content),
                "data_url": "",
                "storage_bucket": str(upload["bucket"]),
                "storage_path": str(upload["storage_path"]),
            }

        return attachment.model_dump(by_alias=False)

    def _migrate_legacy_attachments(self, user: User, notes: list[Note]) -> None:
        changed = False
        for note in notes:
            next_attachments: list[dict] = []
            note_changed = False
            for raw_attachment in note.attachments or []:
                attachment = NoteAttachment.model_validate(raw_attachment)
                stored = self._store_attachment(user.id, attachment)
                next_attachments.append(stored)
                if stored != raw_attachment:
                    note_changed = True
            stripped_details = self._strip_attachment_frames(note.details)
            if stripped_details != note.details:
                note.details = stripped_details
                note_changed = True
            if note_changed:
                note.attachments = next_attachments
                self.notes_repo.db.add(note)
                changed = True
        if changed:
            self.notes_repo.db.commit()
