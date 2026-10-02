"""WebSocket fan-out of live events (tanker positions, new complaints, plan changes).

Sync route handlers run in a worker thread, so ``publish`` hands events to the event loop
thread-safely.  Single-process only; use Redis pub/sub when running multiple workers.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def _broadcast(self, message: str) -> None:
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    def publish(self, event: str, data: Any = None) -> None:
        if not self._loop or not self._clients:
            return
        message = json.dumps({"event": event, "data": data}, default=str)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self._loop:
            self._loop.create_task(self._broadcast(message))
        else:
            asyncio.run_coroutine_threadsafe(self._broadcast(message), self._loop)


hub = Hub()
