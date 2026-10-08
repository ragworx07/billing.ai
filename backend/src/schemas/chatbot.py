from pydantic import BaseModel, Field

from src.schemas.chat import AIChatClarification, ChatMessage


class ChatbotQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)
    pending_clarification: AIChatClarification | None = None


class ChatbotQueryResponse(BaseModel):
    answer: str
    options: list[str] = Field(default_factory=list)
