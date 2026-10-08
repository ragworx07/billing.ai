from collections.abc import Mapping

from fastapi.responses import JSONResponse


def auth_logout_response(
    detail: str,
    *,
    code: str,
    status_code: int = 401,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    response_headers = {"WWW-Authenticate": "Bearer", "X-Auth-Action": "logout"}
    if headers:
        response_headers.update(headers)

    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "code": code, "auth_action": "logout"},
        headers=response_headers,
    )
