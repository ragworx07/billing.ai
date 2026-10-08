from __future__ import annotations

import os

import uvicorn
from src.main import app


def main() -> None:
    host = os.getenv("APP_HOST", "127.0.0.1")
    port = int(os.getenv("APP_PORT", "8000"))
    log_level = os.getenv("APP_LOG_LEVEL", "info")

    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
        workers=1,
        log_level=log_level,
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
