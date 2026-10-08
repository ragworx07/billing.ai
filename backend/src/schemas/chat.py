from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


ChatIntent = Literal[
    "material_usage_report",
    "project_summary",
    "pending_payments",
    "labour_attendance",
    "inventory_stock",
    "site_expenses",
    "office_expenses",
    "customer_details",
    "invoice_reports",
    "vendor_summary",
    "navigation_guidance",
    "workflow_help",
    "general_inquiry",
    "sql_query",
    "clarification",
    "help",
]

ChatResponseType = Literal["table", "chart", "card", "text", "summary", "clarification"]
DateRangeValue = Literal["today", "this_week", "this_month", "last_month", "this_year", "all_time", "custom"]
GroupByValue = Literal["auto", "date", "month", "material", "vendor", "supplier"]


class AIChatAction(BaseModel):
    label: str
    url: str
    type: Literal["navigate", "external", "copy"] = "navigate"
    variant: Literal["primary", "secondary", "outline"] = "primary"
    description: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AIChatClarification(BaseModel):
    """A single follow-up question asked when a required detail is missing."""

    question: str
    field: str | None = None
    options: list[str] = Field(default_factory=list)
    allow_free_text: bool = True

    @field_validator("options", mode="before")
    @classmethod
    def clean_options(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return []
        seen: list[str] = []
        for item in value:
            label = str(item).strip()
            if label and label not in seen:
                seen.append(label)
        return seen[:8]


class SQLPlan(BaseModel):
    """What the analyst model decided to do with the question."""

    action: Literal["sql", "clarify", "answer"] = "sql"
    sql: str | None = None
    clarification: AIChatClarification | None = None
    answer: str | None = None
    nav_target: str | None = None
    title: str | None = None
    summary: str | None = None
    output: Literal["table", "chart", "card"] = "table"
    chart_type: Literal["bar", "line", "pie"] | None = None
    x_key: str | None = None
    y_keys: list[str] | None = None

    @field_validator("sql", "answer", "nav_target", "title", "summary", "x_key", mode="before")
    @classmethod
    def clean_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip() or None
        return value

    # Models routinely emit "" or a stray label for the enum-like fields. Coerce instead
    # of failing the whole plan over a cosmetic field.
    @field_validator("action", mode="before")
    @classmethod
    def clean_action(cls, value: Any) -> Any:
        text = str(value or "").strip().lower()
        return text if text in ("sql", "clarify", "answer") else "sql"

    @field_validator("output", mode="before")
    @classmethod
    def clean_output(cls, value: Any) -> Any:
        text = str(value or "").strip().lower()
        return text if text in ("table", "chart", "card") else "table"

    @field_validator("chart_type", mode="before")
    @classmethod
    def clean_chart_type(cls, value: Any) -> Any:
        text = str(value or "").strip().lower()
        return text if text in ("bar", "line", "pie") else None

    @field_validator("y_keys", mode="before")
    @classmethod
    def clean_y_keys(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return None
        keys = [str(item).strip() for item in value if str(item).strip()]
        return keys or None

    @model_validator(mode="after")
    def require_payload(self) -> "SQLPlan":
        if self.action == "sql" and not self.sql:
            raise ValueError("action 'sql' requires a sql statement")
        if self.action == "clarify" and (not self.clarification or not self.clarification.question):
            raise ValueError("action 'clarify' requires a clarification question")
        if self.action == "answer" and not self.answer:
            raise ValueError("action 'answer' requires answer text")
        return self


class ChatIntentExtraction(BaseModel):
    intent: ChatIntent = "help"
    project_name: str | None = None
    material_name: str | None = None
    customer_name: str | None = None
    expense_category: str | None = None
    labour_type: str | None = None
    vendor_name: str | None = None
    supplier_name: str | None = None
    target_action: str | None = None
    group_by: GroupByValue = "auto"
    date_range: DateRangeValue = "all_time"
    start_date: str | None = None
    end_date: str | None = None
    output_type: ChatResponseType = "text"
    limit: int = Field(default=50, ge=1, le=200)

    @field_validator(
        "project_name",
        "material_name",
        "customer_name",
        "expense_category",
        "labour_type",
        "vendor_name",
        "supplier_name",
        "target_action",
        "start_date",
        "end_date",
        mode="before",
    )
    @classmethod
    def clean_blank_strings(cls, value: Any) -> Any:
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or None
        return value

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_iso_dates(cls, value: str | None) -> str | None:
        if value is None:
            return None
        date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def normalize_custom_dates(self) -> "ChatIntentExtraction":
        if self.date_range == "custom" and (not self.start_date or not self.end_date):
            self.date_range = "all_time"
            self.start_date = None
            self.end_date = None
        return self


class AIChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)
    pending_clarification: AIChatClarification | None = None


class AIChatResponse(BaseModel):
    type: ChatResponseType
    title: str
    summary: str | None = None
    columns: list[str] | None = None
    rows: list[list[Any]] | None = None
    cards: list[dict[str, Any]] | None = None
    chart_type: Literal["bar", "line", "pie"] | None = None
    x_key: str | None = None
    y_keys: list[str] | None = None
    data: list[dict[str, Any]] | None = None
    text: str | None = None
    intent: ChatIntent | None = None
    filters: dict[str, Any] = Field(default_factory=dict)
    actions: list[AIChatAction] = Field(default_factory=list)
    sample_prompts: list[str] | None = None
    clarification: AIChatClarification | None = None
    sql: str | None = None


class AIChatSamplesResponse(BaseModel):
    sample_prompts: list[str]


class AIChatHealthCheckItem(BaseModel):
    name: str
    ok: bool
    detail: str


class AIChatHealthResponse(BaseModel):
    ok: bool
    groq_configured: bool
    model: str
    checks: list[AIChatHealthCheckItem]

