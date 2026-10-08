from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.api.middleware.auth_response import auth_logout_response
from src.core.exceptions.exceptions import AppException


async def app_exception_handler(_: Request, exc: AppException):
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        return auth_logout_response(exc.detail, code="auth_required", status_code=exc.status_code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


async def http_exception_handler(_: Request, exc: HTTPException):
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail.strip() else "Unauthorized access"
        return auth_logout_response(detail, code="auth_required", status_code=exc.status_code, headers=exc.headers)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )


async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


async def generic_exception_handler(_: Request, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )
