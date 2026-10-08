from sqlalchemy.orm import Session

from src.core.exceptions.exceptions import recorded


def get_or_404(db: Session, model, object_id: int):
    obj = db.get(model, object_id)
    if not obj or getattr(obj, "deleted_at", None) is not None:
        raise recorded.record_not_found(model.__name__)
    return obj
