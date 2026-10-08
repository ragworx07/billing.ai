FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock /app/
RUN python3.13 -m pip install --no-cache-dir uv \
 && uv sync --no-dev --frozen

COPY . /app

EXPOSE 8000

CMD ["sh", "-c", "alembic -c alembic.ini upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8000"]
