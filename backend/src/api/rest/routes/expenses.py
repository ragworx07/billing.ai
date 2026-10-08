from fastapi import APIRouter, Depends, File, UploadFile, status

from src.api.rest.dependencies import get_current_user, get_expense_service, require_roles
from src.core.services.expense_service import ExpenseService
from src.data.models.postgres.user import User
from src.schemas.expense import ExpenseLogBase, ExpenseLogResponse
from src.core.services.storage_service import storage_service
from src.core.permissions import PROJECT_MATERIAL_EXPENSE_ROLES

router = APIRouter()


@router.get("/", response_model=list[ExpenseLogResponse])
async def list_expenses(
    project_id: int | None = None,
    service: ExpenseService = Depends(get_expense_service),
    _: User = Depends(get_current_user),
):
    return await service.list_expenses(project_id)


@router.post("/", response_model=ExpenseLogResponse, status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseLogBase,
    service: ExpenseService = Depends(get_expense_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    return await service.create_expense(user, payload)


@router.put("/{expense_id}", response_model=ExpenseLogResponse)
async def update_expense(
    expense_id: int,
    payload: ExpenseLogBase,
    service: ExpenseService = Depends(get_expense_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    return await service.update_expense(user, expense_id, payload)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    expense_id: int,
    service: ExpenseService = Depends(get_expense_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    await service.delete_expense(user, expense_id)


@router.post("/upload")
async def upload_expense_bill(file: UploadFile = File(...), _: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES))):
    return {"url": await storage_service.upload_bill(file, "expenses")}
