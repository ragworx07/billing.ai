from pydantic import BaseModel, Field, field_validator, model_validator
import json

from src.schemas.common import ORMModel


class WorkerBase(BaseModel):
    name: str
    role: str
    daily_wage: float = Field(ge=0)
    wage_options: list[float] = Field(default_factory=list)

    @field_validator("wage_options", mode="before")
    @classmethod
    def _coerce_wage_options_field(cls, value):
        if isinstance(value, list):
            return [float(item) for item in value if item is not None]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [float(item) for item in parsed if item is not None]
            except Exception:
                s = value.strip()
                if s.startswith("[") and s.endswith("]"):
                    inner = s[1:-1].strip()
                    if not inner:
                        return []
                    try:
                        return [float(part.strip()) for part in inner.split(",") if part.strip()]
                    except Exception:
                        return []
        return []

    @model_validator(mode="before")
    def _coerce_wage_options(cls, values: dict):
        # Some DB drivers or legacy rows may store JSON as a string; attempt to coerce.
        w = values.get("wage_options") if isinstance(values, dict) else None
        if isinstance(w, str):
            try:
                parsed = json.loads(w)
                values["wage_options"] = parsed
            except Exception:
                # Fallback: parse simple bracketed numeric lists like "[980.00, 1100.00]"
                s = w.strip()
                if s.startswith("[") and s.endswith("]"):
                    inner = s[1:-1].strip()
                    if inner == "":
                        values["wage_options"] = []
                    else:
                        try:
                            parts = [p.strip() for p in inner.split(",")]
                            values["wage_options"] = [float(p) for p in parts]
                        except Exception:
                            values["wage_options"] = []
        return values


class WorkerResponse(WorkerBase, ORMModel):
    id: int
