import logging
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from src.core.permissions import ADMIN_ROLES
from src.core.services.ai_service import AIService
from src.core.services.db_query_service import DBQueryService
from src.core.services.sql_guard import (
    MAX_ROWS,
    SQLValidationError,
    build_scoped_sql,
    execute_select,
    validate_select,
)
from src.data.models.postgres.enums import UserRole
from src.data.models.postgres.project import Project
from src.data.models.postgres.user import User
from src.schemas.chat import (
    AIChatClarification,
    AIChatResponse,
    ChatIntentExtraction,
    ChatMessage,
    SQLPlan,
)

logger = logging.getLogger(__name__)

FULL_ACCESS_ROLES = (*ADMIN_ROLES, UserRole.CLIENT_MANAGER, UserRole.ACCOUNTANT)

ALLOWED_ROLES = (
    *ADMIN_ROLES,
    UserRole.CLIENT_MANAGER,
    UserRole.PROJECT_MANAGER,
    UserRole.PROJECT_COORDINATOR,
    UserRole.ACCOUNTANT,
    UserRole.SUPERVISOR,
)

MAX_SQL_ROUNDS = 3


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _short_error(exc: Exception) -> str:
    message = str(getattr(exc, "orig", exc)).strip().replace("\n", " ")
    return message[:400]


class ChatQueryService:
    """Answers questions by generating one guarded read-only SQL query per turn.

    The analyst model receives the whole database schema and returns either a SELECT
    with a chart specification, a single follow-up question when a required detail is
    missing, or plain guidance for "where do I do X" questions. Deterministic intent
    handlers remain as the fallback when the model is unreachable.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.ai_service = AIService()
        self.db_query_service = DBQueryService(db)

    async def ask(
        self,
        question: str,
        current_user: User,
        history: list[ChatMessage] | None = None,
        pending_clarification: AIChatClarification | None = None,
    ) -> AIChatResponse:
        if current_user.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")

        project_ids = self.db_query_service._accessible_project_ids(current_user)
        project_names = [
            name
            for (name,) in self.db.query(Project.project_name)
            .filter(Project.id.in_(project_ids), Project.deleted_at == None)
            .order_by(Project.project_name.asc())
            .all()
        ]
        full_access = current_user.role in FULL_ACCESS_ROLES

        context: dict[str, Any] = {
            "available_projects": project_names,
            "user_role": getattr(current_user.role, "value", str(current_user.role)),
            "project_scope": "every project" if full_access else "only the projects assigned to this user",
            "max_rows": MAX_ROWS,
        }
        if pending_clarification:
            context["answering_question"] = {
                "question": pending_clarification.question,
                "field": pending_clarification.field,
                "options_offered": pending_clarification.options,
            }

        plan = await self.ai_service.generate_sql_plan(question, history, context)
        if plan is None:
            return await self._legacy_answer(question, current_user, history)

        if plan.action == "sql":
            plan, columns, rows, executed_sql = await self._resolve_sql(
                plan=plan,
                question=question,
                history=history,
                context=context,
                project_ids=project_ids,
                full_access=full_access,
            )
            if plan.action == "sql":
                if rows:
                    return self._build_data_response(plan, columns or [], rows, executed_sql)
                return self._no_data_clarification(project_names, executed_sql)

        if plan.action == "clarify":
            return self._clarification_response(plan, project_names)

        return self._guidance_response(plan, question, current_user)

    async def _resolve_sql(
        self,
        plan: SQLPlan,
        question: str,
        history: list[ChatMessage] | None,
        context: dict[str, Any],
        project_ids: list[int],
        full_access: bool,
    ) -> tuple[SQLPlan, list[str] | None, list[list[Any]] | None, str | None]:
        """Run the plan's SQL, feeding failures and empty results back to the model."""
        feedback: dict[str, str] | None = None

        for round_index in range(MAX_SQL_ROUNDS):
            if feedback is not None:
                retry = await self.ai_service.generate_sql_plan(
                    question, history, context, previous_attempt=feedback
                )
                if retry is None:
                    return plan, None, None, None
                plan = retry
                if plan.action != "sql":
                    return plan, None, None, None

            try:
                safe_sql = validate_select(plan.sql or "", restricted=not full_access)
                scoped_sql = build_scoped_sql(
                    safe_sql,
                    accessible_project_ids=project_ids,
                    full_access=full_access,
                )
                columns, rows = execute_select(self.db, scoped_sql)
            except (SQLValidationError, SQLAlchemyError) as exc:
                logger.warning("AI SQL round %s rejected: %s", round_index + 1, _short_error(exc))
                feedback = {"sql": plan.sql or "", "error": _short_error(exc)}
                continue

            if rows:
                return plan, columns, rows, safe_sql

            logger.info("AI SQL round %s returned no rows", round_index + 1)
            feedback = {
                "sql": safe_sql,
                "error": "The query is valid but returned 0 rows.",
                "hint": (
                    "Either widen the filters (drop the date restriction or the name match) and return "
                    "corrected SQL, or use action 'clarify' to ask the user for the one detail that "
                    "would let you find data."
                ),
            }

        return plan, None, None, None

    def _build_data_response(
        self,
        plan: SQLPlan,
        columns: list[str],
        rows: list[list[Any]],
        executed_sql: str | None,
    ) -> AIChatResponse:
        data = [dict(zip(columns, row)) for row in rows]
        numeric_columns = [
            column
            for index, column in enumerate(columns)
            if any(_is_number(row[index]) for row in rows)
            and all(row[index] is None or _is_number(row[index]) for row in rows)
        ]
        label_columns = [column for column in columns if column not in numeric_columns]

        x_key = plan.x_key if plan.x_key in columns else None
        if x_key is None or x_key in numeric_columns:
            x_key = label_columns[0] if label_columns else columns[0]

        y_keys = [key for key in (plan.y_keys or []) if key in numeric_columns and key != x_key]
        if not y_keys:
            y_keys = [column for column in numeric_columns if column != x_key]

        title = plan.title or "Query Result"
        summary = plan.summary or self._auto_summary(rows, columns, y_keys)

        wants_chart = plan.output == "chart"
        can_chart = bool(y_keys) and len(rows) >= 2 and x_key not in y_keys
        if wants_chart and can_chart:
            chart_type = plan.chart_type or ("line" if x_key in ("month", "date", "day", "week") else "bar")
            return AIChatResponse(
                type="chart",
                title=title,
                summary=summary,
                chart_type=chart_type,
                x_key=x_key,
                y_keys=y_keys[:4],
                data=data,
                columns=columns,
                rows=rows,
                intent="sql_query",
                sql=executed_sql,
            )

        single_value = len(rows) == 1 and len(numeric_columns) >= 1
        if (plan.output == "card" or (wants_chart and not can_chart)) and single_value:
            return AIChatResponse(
                type="card",
                title=title,
                summary=summary,
                cards=[
                    {"label": column.replace("_", " ").title(), "value": data[0][column]}
                    for column in columns
                    if data[0].get(column) is not None
                ][:4],
                intent="sql_query",
                sql=executed_sql,
            )

        return AIChatResponse(
            type="table",
            title=title,
            summary=summary,
            columns=columns,
            rows=rows,
            intent="sql_query",
            sql=executed_sql,
        )

    def _auto_summary(self, rows: list[list[Any]], columns: list[str], y_keys: list[str]) -> str:
        parts = [f"{len(rows)} row(s)"]
        if y_keys:
            index = columns.index(y_keys[0])
            total = sum(row[index] for row in rows if _is_number(row[index]))
            parts.append(f"total {y_keys[0].replace('_', ' ')}: {total:,.2f}")
        return ". ".join(parts) + "."

    def _clarification_response(self, plan: SQLPlan, project_names: list[str]) -> AIChatResponse:
        clarification = plan.clarification or AIChatClarification(question="Could you add a little more detail?")
        if not clarification.options and clarification.field and "project" in clarification.field.lower():
            clarification.options = project_names[:6]
        return AIChatResponse(
            type="clarification",
            title=plan.title or "One quick question",
            summary=plan.summary,
            text=clarification.question,
            clarification=clarification,
            intent="clarification",
        )

    def _no_data_clarification(self, project_names: list[str], executed_sql: str | None) -> AIChatResponse:
        options = [*project_names[:5], "All projects", "All time"]
        return AIChatResponse(
            type="clarification",
            title="No matching records yet",
            text=(
                "I could not find any records for that. Which project or period should I look at instead?"
            ),
            clarification=AIChatClarification(
                question="Which project or period should I look at instead?",
                field="project_or_period",
                options=options,
            ),
            intent="clarification",
            sql=executed_sql,
        )

    def _guidance_response(self, plan: SQLPlan, question: str, current_user: User) -> AIChatResponse:
        extraction = ChatIntentExtraction(
            intent="navigation_guidance",
            target_action=plan.nav_target or "general",
            output_type="text",
        )
        guidance = self.db_query_service.navigation_guidance(extraction, current_user)
        return AIChatResponse(
            type="text",
            title=plan.title or guidance.title,
            text=plan.answer or guidance.text,
            actions=guidance.actions,
            intent="navigation_guidance",
        )

    async def _legacy_answer(
        self,
        question: str,
        current_user: User,
        history: list[ChatMessage] | None,
    ) -> AIChatResponse:
        """Deterministic keyword handlers, used when the analyst model is unavailable."""
        extraction = await self.ai_service.extract_intent(question=question, history=history)
        logger.info("AI Search fell back to intent handler: %s", extraction.intent)
        return self.db_query_service.run(extraction, current_user)
