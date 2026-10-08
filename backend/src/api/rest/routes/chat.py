import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user
from src.config import config
from src.core.services.ai_service import AIService
from src.core.services.chat_query_service import ChatQueryService
from src.core.services import schema_catalog
from src.core.services.db_query_service import DBQueryService
from src.core.services.sql_guard import SQLValidationError, validate_select
from src.data.clients.session import get_db
from src.data.models.postgres.user import User
from src.prompts.system_prompt import SAMPLE_PROMPTS
from src.schemas.chat import (
    AIChatHealthCheckItem,
    AIChatHealthResponse,
    AIChatRequest,
    AIChatResponse,
    AIChatSamplesResponse,
    ChatIntentExtraction,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["ai-search"])


@router.get("/sample-prompts", response_model=AIChatSamplesResponse)
async def get_sample_prompts() -> AIChatSamplesResponse:
    return AIChatSamplesResponse(sample_prompts=SAMPLE_PROMPTS)


@router.get("/health", response_model=AIChatHealthResponse)
async def get_ai_search_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AIChatHealthResponse:
    checks: list[AIChatHealthCheckItem] = []

    groq_configured = bool(config.GROQ_API_KEY)
    checks.append(
        AIChatHealthCheckItem(
            name="groq_configuration",
            ok=groq_configured,
            detail="Groq API key is configured." if groq_configured else "GROQ_API_KEY is missing; fallback classifier will be used.",
        )
    )

    try:
        db.execute(text("SELECT 1")).scalar()
        checks.append(AIChatHealthCheckItem(name="database_read", ok=True, detail="Database read connection is working."))
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="database_read", ok=False, detail=str(exc)))

    try:
        extraction = ChatIntentExtraction(
            intent="material_usage_report",
            project_name="Health Check",
            material_name="cement",
            date_range="this_month",
            output_type="table",
        )
        checks.append(
            AIChatHealthCheckItem(
                name="schema_validation",
                ok=extraction.intent == "material_usage_report",
                detail="Intent JSON schema validation is working.",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="schema_validation", ok=False, detail=str(exc)))

    try:
        registry = DBQueryService(db).intent_registry
        required_intents = {
            "material_usage_report",
            "project_summary",
            "pending_payments",
            "labour_attendance",
            "inventory_stock",
            "site_expenses",
            "customer_details",
            "invoice_reports",
            "help",
        }
        missing = sorted(required_intents.difference(registry.keys()))
        checks.append(
            AIChatHealthCheckItem(
                name="intent_registry",
                ok=not missing,
                detail="All predefined query handlers are registered." if not missing else f"Missing handlers: {', '.join(missing)}",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="intent_registry", ok=False, detail=str(exc)))

    try:
        tables = schema_catalog.schema_tables()
        column_count = sum(len(table.columns) for table in tables.values())
        checks.append(
            AIChatHealthCheckItem(
                name="schema_catalog",
                ok=len(tables) > 0,
                detail=f"AI can read {len(tables)} table(s) and {column_count} column(s).",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="schema_catalog", ok=False, detail=str(exc)))

    try:
        validate_select("SELECT project_name FROM projects ORDER BY project_name LIMIT 5")
        blocked = False
        try:
            validate_select("SELECT * FROM projects; DROP TABLE projects")
        except SQLValidationError:
            blocked = True
        checks.append(
            AIChatHealthCheckItem(
                name="sql_guard",
                ok=blocked,
                detail="Read-only SQL guard accepts SELECT and blocks write statements."
                if blocked
                else "SQL guard failed to block a write statement.",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="sql_guard", ok=False, detail=str(exc)))

    try:
        service = AIService()
        checks.append(
            AIChatHealthCheckItem(
                name="ai_service",
                ok=bool(service.model and service.base_url),
                detail=f"AI service initialized with model {service.model}.",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="ai_service", ok=False, detail=str(exc)))

    try:
        accessible_ids = DBQueryService(db)._accessible_project_ids(current_user)
        checks.append(
            AIChatHealthCheckItem(
                name="rbac_access",
                ok=True,
                detail=f"Current user can read {len(accessible_ids)} project(s) through AI Search.",
            )
        )
    except Exception as exc:
        checks.append(AIChatHealthCheckItem(name="rbac_access", ok=False, detail=str(exc)))

    return AIChatHealthResponse(
        ok=all(check.ok for check in checks if check.name != "groq_configuration"),
        groq_configured=groq_configured,
        model=config.GROQ_MODEL,
        checks=checks,
    )


@router.post("/query", response_model=AIChatResponse)
async def query_ai_search(
    payload: AIChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AIChatResponse:
    service = ChatQueryService(db)
    return await service.ask(
        payload.question,
        current_user,
        payload.history,
        payload.pending_clarification,
    )


@router.post("/stream")
async def stream_ai_search(
    payload: AIChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    async def event_stream():
        yield "event: status\ndata: Processing your question\n\n"
        try:
            service = ChatQueryService(db)
            response = await service.ask(
                payload.question,
                current_user,
                payload.history,
                payload.pending_clarification,
            )
            yield f"event: result\ndata: {response.model_dump_json()}\n\n"
        except Exception as exc:
            logger.exception("AI Search stream failed")
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

