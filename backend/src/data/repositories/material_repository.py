from sqlalchemy.orm import Session

from src.data.models.postgres.material_log import MaterialLog


class MaterialRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, project_id: int | None = None) -> list[MaterialLog]:
        query = self.db.query(MaterialLog).filter(MaterialLog.deleted_at == None)
        if project_id:
            query = query.filter(MaterialLog.project_id == project_id)
        return query.order_by(MaterialLog.date.desc()).all()

    def get_by_id(self, material_id: int) -> MaterialLog | None:
        material = self.db.get(MaterialLog, material_id)
        if material and material.deleted_at is not None:
            return None
        return material

    def create(self, material: MaterialLog) -> MaterialLog:
        self.db.add(material)
        self.db.commit()
        self.db.refresh(material)
        return material

    def update(self, material: MaterialLog, payload: dict) -> MaterialLog:
        for key, value in payload.items():
            setattr(material, key, value)
        self.db.add(material)
        self.db.commit()
        self.db.refresh(material)
        return material

    def delete(self, material: MaterialLog) -> None:
        from datetime import datetime
        material.deleted_at = datetime.utcnow()
        self.db.add(material)
        self.db.commit()
