from fastapi import Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from src.api.middleware.auth_response import auth_logout_response
from src.config import config
from src.utils.auth_utils import is_valid_token

EXEMPT_PATHS = {
    f"{config.API_V1_STR}/auth/login",
    f"{config.API_V1_STR}/auth/signup",
    f"{config.API_V1_STR}/auth/bootstrap-owner",
    f"{config.API_V1_STR}/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}


def _is_exempt(path: str) -> bool:
    if path in EXEMPT_PATHS:
        return True
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi"):
        return True
    return False


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS" or _is_exempt(request.url.path):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return auth_logout_response("Missing Bearer token", code="missing_token")

        token = auth_header.split(" ", 1)[1].strip()
        if not token:
            return auth_logout_response("Invalid Bearer token", code="invalid_token")

        if not is_valid_token(token):
            return auth_logout_response("Invalid or expired token", code="token_expired_or_invalid")

        return await call_next(request)
