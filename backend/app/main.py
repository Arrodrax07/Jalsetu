from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import SessionLocal, init_db
from .routers import allocation, analytics, auth, communities, complaints, fleet, requests, system
from .security import user_from_token
from .services import ml
from .services.realtime import hub

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jalsetu")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.environment == "production" and settings.jwt_secret == "change-me-in-production":
        raise RuntimeError("Set JWT_SECRET before running in production")
    init_db()
    hub.bind_loop(asyncio.get_running_loop())
    # Load models off the request path (the embedding model takes a few seconds).
    threading.Thread(target=lambda: (ml.triage(), ml.forecaster()), daemon=True).start()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Equitable municipal water allocation, complaint intelligence, fleet routing and proof-of-delivery.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, communities, requests, complaints, allocation, fleet, analytics, system):
    app.include_router(r.router, prefix="/api")


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    token = ws.query_params.get("token", "")
    with SessionLocal() as db:
        user = user_from_token(db, token)
    if user is None:
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
