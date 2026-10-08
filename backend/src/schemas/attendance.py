from datetime import date

from pydantic import BaseModel, Field

from src.data.models.postgres.enums import AttendanceStatus
from src.schemas.common import ORMModel


class AttendanceLogBase(BaseModel):
    worker_id: int
    project_id: int
    date: date
    status: AttendanceStatus
    work_done: str
    overtime_hours: float = Field(default=0, ge=0)



class AttendanceLogResponse(AttendanceLogBase, ORMModel):
    id: int


class WorkerAttendanceCalendarItem(BaseModel):
    id: int
    date: date
    project_id: int
    project_name: str
    status: AttendanceStatus
    work_done: str
    overtime_hours: float
