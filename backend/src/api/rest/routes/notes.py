from fastapi import APIRouter, Depends, File, UploadFile, status

from src.api.rest.dependencies import get_current_user, get_notes_service
from src.core.services.notes_service import NotesService
from src.data.models.postgres.user import User
from src.schemas.note import NoteAttachment, NotePayload, NoteResponse

router = APIRouter()


@router.get("/board", response_model=NoteResponse)
async def get_notes_board(
    service: NotesService = Depends(get_notes_service),
    user: User = Depends(get_current_user),
):
    return await service.get_board(user)


@router.put("/board", response_model=NoteResponse)
async def save_notes_board(
    payload: NotePayload,
    service: NotesService = Depends(get_notes_service),
    user: User = Depends(get_current_user),
):
    return await service.replace_board(user, payload)


@router.post("/attachments", response_model=NoteAttachment, status_code=status.HTTP_201_CREATED)
async def upload_note_attachment(
    file: UploadFile = File(...),
    service: NotesService = Depends(get_notes_service),
    user: User = Depends(get_current_user),
):
    return await service.upload_attachment(user, file)
