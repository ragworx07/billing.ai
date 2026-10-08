import enum
from sqlalchemy import Enum


class UserRole(str, enum.Enum):
    OWNER = "owner"
    ADMINISTRATOR = "administrator"
    CLIENT_MANAGER = "client_manager"
    PROJECT_MANAGER = "project_manager"
    PROJECT_COORDINATOR = "project_coordinator"
    # Kept for existing accounts created before named access categories were added.
    SUPERVISOR = "supervisor"
    ACCOUNTANT = "accountant"


class ProjectStatus(str, enum.Enum):
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "present"
    ABSENT = "absent"
    HALF_DAY = "half_day"


class PaymentType(str, enum.Enum):
    ADVANCE = "advance"
    RUNNING = "running"
    FINAL = "final"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    RECEIVED = "received"
    OVERDUE = "overdue"


def sql_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda enum_values: [item.value for item in enum_values],
    )
