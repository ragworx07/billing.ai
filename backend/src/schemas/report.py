from datetime import date

from pydantic import BaseModel

from src.schemas.common import ORMModel


class WorkReportBase(BaseModel):
    project_id: int
    report_date: date
    work_done: str
    issues: str | None = None
    next_plan: str | None = None



class WorkReportResponse(WorkReportBase, ORMModel):
    id: int
