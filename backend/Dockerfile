FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# System deps: SQLite is bundled with python:3.12-slim; we only need
# build-essential transiently for any wheels that need compiling. We use
# --no-install-recommends to keep the image lean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

COPY app /srv/app

# Non-root user for safety; DB is read-only anyway but defense in depth.
RUN useradd --system --uid 1001 --home /srv --shell /usr/sbin/nologin app \
 && chown -R app:app /srv
USER app

ENV DB_PATH=/data/USA_Ham_Callbooks.sqlite \
    UVICORN_WORKERS=2

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
