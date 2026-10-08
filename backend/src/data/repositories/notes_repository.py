from __future__ import annotations

from sqlalchemy.orm import Session

from src.data.models.postgres.note import Note


class NotesRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_user(self, user_id: int) -> list[Note]:
        return (
            self.db.query(Note)
            .filter(Note.user_id == user_id)
            .order_by(Note.sort_order.asc(), Note.updated_at.desc())
            .all()
        )

    def map_for_user(self, user_id: int) -> dict[str, Note]:
        return {note.id: note for note in self.db.query(Note).filter(Note.user_id == user_id).all()}

    def save_all_for_user(self, user_id: int, notes: list[Note], incoming_ids: set[str]) -> None:
        for note in notes:
            note.user_id = user_id
            self.db.add(note)

        query = self.db.query(Note).filter(Note.user_id == user_id)
        if incoming_ids:
            query = query.filter(~Note.id.in_(incoming_ids))
        query.delete(synchronize_session=False)
        self.db.commit()
