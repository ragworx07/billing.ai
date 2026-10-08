from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api.rest.dependencies import get_current_user
from src.core.services.chat_query_service import ChatQueryService
from src.data.clients.session import get_db
from src.data.models.postgres.user import User
from src.schemas.chatbot import ChatbotQueryRequest, ChatbotQueryResponse

router = APIRouter(prefix="/chatbot", tags=["chatbot"])


@router.post("/ask", response_model=ChatbotQueryResponse)
async def ask_chatbot(
    payload: ChatbotQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = ChatQueryService(db)
    response = await service.ask(
        payload.question,
        current_user,
        payload.history,
        payload.pending_clarification,
    )
    answer = response.text or response.summary or response.title
    if response.type in ("table", "chart") and response.rows:
        answer = f"{answer}\n\nOpen AI Search to see the full {response.type}."
    return ChatbotQueryResponse(
        answer=answer,
        options=response.clarification.options if response.clarification else [],
    )

