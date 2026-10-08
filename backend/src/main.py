from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api.middleware.auth_bearer import BearerAuthMiddleware
from src.api.middleware.exception_handlers import (
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from src.api.rest import api_router
from src.config import config
from src.core.exceptions.exceptions import (
    AppException,
    AuthException,
    OtherAppException,
    RecordedException,
    UnrecordedException,
)
import asyncio
from src.core.services.backup_service import backup_scheduler_worker
from src.data.clients.session import SessionLocal, engine, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(config.LOCAL_STORAGE_DIR).mkdir(parents=True, exist_ok=True)
    init_db()
    scheduler_task = asyncio.create_task(backup_scheduler_worker(SessionLocal))
    yield
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    engine.dispose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS_LIST,
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=config.CORS_ALLOW_METHODS_LIST,
    allow_headers=config.CORS_ALLOW_HEADERS_LIST,
)
app.add_middleware(BearerAuthMiddleware)

app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(AuthException, app_exception_handler)
app.add_exception_handler(RecordedException, app_exception_handler)
app.add_exception_handler(UnrecordedException, app_exception_handler)
app.add_exception_handler(OtherAppException, app_exception_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

app.include_router(api_router, prefix=config.API_V1_STR)
Path(config.LOCAL_STORAGE_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=config.LOCAL_STORAGE_DIR), name="uploads")

__all__ = ["app"]
