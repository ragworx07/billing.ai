from fastapi import APIRouter, Depends, File, UploadFile, status

from src.api.rest.dependencies import get_current_user, get_material_service, require_roles
from src.core.services.material_service import MaterialService
from src.data.models.postgres.user import User
from src.schemas.material import MaterialLogBase, MaterialLogResponse
from src.core.services.storage_service import storage_service
from src.core.permissions import PROJECT_MATERIAL_EXPENSE_ROLES

router = APIRouter()


@router.get("/", response_model=list[MaterialLogResponse])
async def list_materials(
    project_id: int | None = None,
    service: MaterialService = Depends(get_material_service),
    _: User = Depends(get_current_user),
):
    return await service.list_materials(project_id)


@router.post("/", response_model=MaterialLogResponse, status_code=status.HTTP_201_CREATED)
async def create_material(
    payload: MaterialLogBase,
    service: MaterialService = Depends(get_material_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    return await service.create_material(user, payload)


@router.put("/{material_id}", response_model=MaterialLogResponse)
async def update_material(
    material_id: int,
    payload: MaterialLogBase,
    service: MaterialService = Depends(get_material_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    return await service.update_material(user, material_id, payload)


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: int,
    service: MaterialService = Depends(get_material_service),
    user: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES)),
):
    await service.delete_material(user, material_id)


@router.post("/upload")
async def upload_material_bill(file: UploadFile = File(...), _: User = Depends(require_roles(*PROJECT_MATERIAL_EXPENSE_ROLES))):
    return {"url": await storage_service.upload_bill(file, "materials")}
