# syntax=docker/dockerfile:1
# The knowledge-state service. docker-compose.yml builds and runs it next to
# the app and Postgres; it creates its own `knowledge` schema on startup.

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /bin/uv
WORKDIR /srv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH=/srv/.venv/bin:$PATH

# Dependencies first, cached until pyproject.toml or uv.lock change.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY knowledge ./knowledge
RUN uv sync --frozen --no-dev

USER nobody
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)"
CMD ["uvicorn", "knowledge.api:app", "--host", "0.0.0.0", "--port", "8000"]
