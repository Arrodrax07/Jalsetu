from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import INSECURE_JWT_SECRETS, get_settings
from .db import SessionLocal, init_db
from .routers import allocation, analytics, auth, communities, complaints, disasters, fleet, intel, ops, requests, schedules, system, tracking, trips
from .security import user_from_token
from .services import ml
from .services.realtime import hub

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("jalsetu")


def _backfill_water_access() -> None:
    """Distance-to-water is part of the priority score; compute it for any community that has none yet."""
    from .services import access

    try:
        with SessionLocal() as db:
            n = access.recompute(db, only_missing=True)
            if n:
                log.info("water access distance computed for %d communities", n)
    except Exception:  # noqa: BLE001
        log.exception("water access backfill failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.jwt_secret in INSECURE_JWT_SECRETS or len(settings.jwt_secret) < 32:
        if settings.is_production:
            raise RuntimeError("Set a strong JWT_SECRET (>= 32 chars) before running in production")
        log.warning("JWT_SECRET is weak or default. Acceptable for local development only.")
    init_db()
    _backfill_water_access()
    hub.bind_loop(asyncio.get_running_loop())
    threading.Thread(target=lambda: (ml.triage(), ml.forecaster()), daemon=True).start()
    task = None
    if settings.run_background_jobs:
        from .ingestion.jobs import loop

        task = asyncio.create_task(loop())
    yield
    if task:
        task.cancel()


app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="Water logistics, disaster intelligence and real-time tanker operations.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


for r in (auth, communities, requests, complaints, allocation, fleet, trips, tracking, disasters, ops, analytics, system, intel, schedules):
    app.include_router(r.router, prefix="/api")


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    token = ws.query_params.get("token", "")
    with SessionLocal() as db:
        user = user_from_token(db, token)
    if user is None or user.role == "driver":
        await ws.close(code=4401)
        return
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)
