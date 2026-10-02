# Build context: repository root (needs both backend/ and ml/).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY ml/pyproject.toml ml/requirements.txt ml/
COPY ml/jalsetu_ml ml/jalsetu_ml
COPY backend/requirements.txt backend/
RUN cd backend && pip install -r requirements.txt

COPY ml ml
COPY backend backend

RUN useradd --create-home jalsetu && mkdir -p /app/backend/uploads /app/ml/artifacts && chown -R jalsetu /app
USER jalsetu
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "python -m scripts.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
