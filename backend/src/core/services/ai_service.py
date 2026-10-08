import asyncio
import json
import logging
import re
from typing import Any
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from pydantic import ValidationError

from src.config import config
from src.core.services.schema_catalog import METRIC_GUIDE, schema_prompt
from src.prompts.system_prompt import CHAT_INTENT_SYSTEM_PROMPT, SQL_ANALYST_SYSTEM_PROMPT
from src.schemas.chat import ChatIntentExtraction, ChatMessage, SQLPlan

logger = logging.getLogger(__name__)


class AIService:
    """Groq-backed intent extractor and response formatter for Construction ERP.

    The prompt and request only contain the user's question, conversational history,
    and structured JSON contracts. Database credentials and arbitrary SQL are never sent.
    """

    def __init__(self) -> None:
        self.api_key = config.GROQ_API_KEY
        self.model = config.GROQ_MODEL
        self.base_url = config.GROQ_BASE_URL.rstrip("/")
        self.timeout = config.GROQ_TIMEOUT_SECONDS

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def _chat_completion(self, payload: dict[str, Any], purpose: str, attempts: int = 3) -> str | None:
        """POST to Groq, retrying transient failures and honouring rate-limit backoff."""
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                if response.status_code == 429:
                    wait = self._retry_after_seconds(response.headers.get("retry-after"), attempt)
                    logger.warning("Groq rate limited %s; retrying in %.1fs", purpose, wait)
                    last_error = httpx.HTTPStatusError("429", request=response.request, response=response)
                    await asyncio.sleep(wait)
                    continue
                if response.status_code >= 400:
                    logger.warning(
                        "Groq %s returned %s: %s", purpose, response.status_code, response.text[:300]
                    )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"]
            except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as exc:
                last_error = exc
                logger.warning("Groq %s failed on attempt %s: %s", purpose, attempt + 1, exc)
                await asyncio.sleep(0.4 * (attempt + 1))

        logger.error("Groq %s failed after %s attempts: %s", purpose, attempts, last_error)
        return None

    @staticmethod
    def _retry_after_seconds(header_value: str | None, attempt: int) -> float:
        try:
            if header_value:
                return min(float(header_value), 10.0)
        except ValueError:
            pass
        return min(1.5 * (2**attempt), 8.0)

    async def generate_sql_plan(
        self,
        question: str,
        history: list[ChatMessage] | None = None,
        context: dict[str, Any] | None = None,
        previous_attempt: dict[str, str] | None = None,
    ) -> SQLPlan | None:
        """Ask the model for one read-only SQL query, a chart spec, or a follow-up question.

        Returns None when Groq is unavailable so the caller can fall back to the
        deterministic intent handlers.
        """
        if not self.api_key:
            return None

        system_prompt = "\n\n".join(
            [
                SQL_ANALYST_SYSTEM_PROMPT.strip(),
                "Database schema (PostgreSQL):\n" + schema_prompt(),
                METRIC_GUIDE,
            ]
        )

        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        messages.extend(self._history_messages(history, keep=6, max_chars=600))

        request_payload: dict[str, Any] = {
            "question": question.strip(),
            "context": {**self._today_context(), **(context or {})},
        }
        if previous_attempt:
            request_payload["previous_attempt"] = previous_attempt
            request_payload["instruction"] = (
                "Your previous SQL failed. Read the error, fix the query, and return corrected JSON. "
                "If the question cannot be answered from the schema, use action 'clarify' or 'answer'."
            )
        messages.append({"role": "user", "content": json.dumps(request_payload, default=str)})

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            # Reasoning models spend completion tokens on thinking; too small a budget
            # truncates the JSON and Groq rejects the whole response.
            "max_completion_tokens": 6000,
            "response_format": {"type": "json_object"},
        }

        content = await self._chat_completion(payload, purpose="SQL plan generation")
        if content is None:
            return None
        try:
            return SQLPlan.model_validate(json.loads(content))
        except (json.JSONDecodeError, ValidationError) as exc:
            logger.warning("SQL plan JSON was invalid: %s", exc)
            return None

    def _history_messages(
        self,
        history: list[ChatMessage] | None,
        keep: int,
        max_chars: int,
    ) -> list[dict[str, str]]:
        if not history:
            return []
        messages: list[dict[str, str]] = []
        for item in history[-keep:]:
            if item.role not in ("user", "assistant"):
                continue
            content = item.content.strip()
            if len(content) > max_chars:
                content = content[:max_chars] + "..."
            if content:
                messages.append({"role": item.role, "content": content})
        return messages

    async def extract_intent(
        self,
        question: str,
        history: list[ChatMessage] | None = None,
        available_projects: list[str] | None = None,
    ) -> ChatIntentExtraction:
        cleaned_question = question.strip()
        if not self.api_key:
            logger.info("GROQ_API_KEY is not configured; using deterministic AI Search fallback extractor.")
            return self._fallback_extract(cleaned_question)

        today_context = self._today_context()
        if available_projects:
            today_context["available_projects"] = ", ".join(available_projects)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": CHAT_INTENT_SYSTEM_PROMPT},
        ]
        messages.extend(self._history_messages(history, keep=4, max_chars=400))

        messages.append({
            "role": "user",
            "content": json.dumps(
                {
                    "question": cleaned_question,
                    "context": today_context,
                }
            ),
        })

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }

        content = await self._chat_completion(payload, purpose="intent extraction", attempts=2)
        if content is None:
            return self._fallback_extract(cleaned_question)
        try:
            return self._validate_json_content(content)
        except (json.JSONDecodeError, ValidationError) as exc:
            logger.warning("Intent JSON was invalid: %s", exc)
            return self._fallback_extract(cleaned_question)

    def _validate_json_content(self, content: str) -> ChatIntentExtraction:
        parsed: dict[str, Any] = json.loads(content)
        return ChatIntentExtraction.model_validate(parsed)

    def _today_context(self) -> dict[str, Any]:
        timezone = "Asia/Kolkata"
        now = datetime.now(ZoneInfo(timezone))
        return {
            "today": now.date().isoformat(),
            "timezone": timezone,
            "now_iso": now.isoformat(),
        }

    def _fallback_extract(self, question: str) -> ChatIntentExtraction:
        lowered = question.lower()
        output_type = "chart" if any(word in lowered for word in ["chart", "graph", "trend"]) else "table"
        group_by = "auto"
        if any(word in lowered for word in ["monthwise", "monthly"]):
            group_by = "month"
            if output_type == "table":
                output_type = "chart"
        date_range = "all_time"
        if "today" in lowered:
            date_range = "today"
        elif "this week" in lowered:
            date_range = "this_week"
        elif "this month" in lowered:
            date_range = "this_month"
        elif "last month" in lowered:
            date_range = "last_month"
        elif "this year" in lowered or "yearly" in lowered:
            date_range = "this_year"

        if any(phrase in lowered for phrase in [
            "where should i", "where do i", "how to enter", "how do i add",
            "how to log", "navigate to", "open", "where is", "where are",
            "how to record", "where can i enter", "where to enter",
        ]):
            target = "general"
            if any(k in lowered for k in ["material", "product", "item", "steel", "cement", "sand"]):
                target = "materials"
            elif any(k in lowered for k in ["labour", "labor", "worker", "wage", "attendance", "mason"]):
                target = "labour"
            elif any(k in lowered for k in ["expense", "petty", "approval"]):
                target = "expenses"
            elif any(k in lowered for k in ["file", "document", "drawing", "upload", "photo"]):
                target = "files"
            elif any(k in lowered for k in ["vendor", "supplier"]):
                target = "vendors"
            elif any(k in lowered for k in ["client", "shareholder", "jv"]):
                target = "clients"
            elif any(k in lowered for k in ["payment", "bill"]):
                target = "payments"
            elif any(k in lowered for k in ["project"]):
                target = "projects"

            return ChatIntentExtraction(
                intent="navigation_guidance",
                target_action=target,
                output_type="text",
            )

        intent = "help"
        if any(word in lowered for word in ["material", "cement", "steel", "jelly", "sand", "usage", "product"]):
            intent = "material_usage_report"
        if any(word in lowered for word in ["labour", "labor", "worker", "wage", "ot"]):
            intent = "labour_attendance"
        if any(word in lowered for word in ["site expense", "petty cash", "approval", "document cost"]):
            intent = "site_expenses"
        if any(word in lowered for word in ["office expense", "office rent", "electricity", "overhead"]):
            intent = "office_expenses"
        if any(word in lowered for word in ["vendor", "supplier directory", "vendor balance"]):
            intent = "vendor_summary"
        if any(word in lowered for word in ["payment", "pending", "due", "outstanding"]):
            intent = "pending_payments"
        if any(word in lowered for word in ["shareholder", "customer", "client", "flat owner"]):
            intent = "customer_details"
        if any(word in lowered for word in ["invoice", "bill", "receipt"]):
            intent = "invoice_reports"
        if any(word in lowered for word in ["stock", "inventory", "master", "rate"]):
            intent = "inventory_stock"
        if any(word in lowered for word in ["project summary", "summary", "overall", "dashboard"]):
            intent = "project_summary"

        return ChatIntentExtraction(
            intent=intent,
            project_name=self._extract_after_keyword(question, ["project", "for", "in", "of"]),
            material_name=self._extract_known_material(lowered),
            expense_category=self._extract_after_keyword(question, ["expense", "category"]),
            labour_type=self._extract_after_keyword(question, ["labour", "labor", "worker"]),
            supplier_name=self._extract_after_keyword(question, ["supplier", "from"]),
            group_by=group_by,
            date_range=date_range,
            output_type=output_type,
            limit=50,
        )

    def _extract_known_material(self, lowered: str) -> str | None:
        for name in ["cement", "steel", "jelly", "sand", "brick", "m sand", "paint"]:
            if name in lowered:
                return name
        return None

    def _extract_after_keyword(self, question: str, keywords: list[str]) -> str | None:
        for keyword in keywords:
            match = re.search(rf"\b{re.escape(keyword)}\s+([A-Za-z0-9][A-Za-z0-9 ._-]{{1,60}})", question, re.I)
            if match:
                value = re.split(r"\b(this|last|today|month|week|year|with|where|show|give)\b", match.group(1), flags=re.I)[0]
                return value.strip(" ._-") or None
        return None
