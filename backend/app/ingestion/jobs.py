"""Background jobs.

Single-process deployments (local / presentation): the API runs ``loop()`` itself (RUN_BACKGROUND_JOBS=true).
Multi-process deployments: run ``python -m app.ingestion worker`` as its own container and set
RUN_BACKGROUND_JOBS=false on the API. The tracking sweep must run in exactly one place.
"""
from __future__ import annotations

import asyncio
import logging
import time

from ..config import get_settings
from ..db import SessionLocal
from ..models import DispatchProposal, utcnow
from ..services import dispatch, tracking
from ..services.common import get_setting
from .probes import probe_imd, probe_static
from .sachet import run_sachet

log = logging.getLogger("jalsetu.jobs")
settings = get_settings()

TRACKING_SWEEP_S = 5


def _safe(fn) -> None:
    try:
        with SessionLocal() as db:
            fn(db)
    except Exception:  # noqa: BLE001
        log.exception("background job %s failed", getattr(fn, "__name__", fn))


def tick(state: dict) -> None:
    now = time.time()
    _safe(tracking.sweep)
    if now - state.get("probes", 0) >= 3600:
        state["probes"] = now
        _safe(probe_static)
        _safe(probe_imd)
    if now - state.get("sachet", 0) >= settings.sachet_poll_seconds:
        state["sachet"] = now
        _safe(run_sachet)
    if now - state.get("dispatch_cfg", 0) >= 60:
        state["dispatch_cfg"] = now
        _safe(lambda db: state.update(cfg=get_setting(db, "dispatch")))
    cfg = state.get("cfg") or {}
    every = cfg.get("crisisRefreshMinutes", 0) * 60
    if every and now - state.get("crisis", now - every + 120) >= every:  # first run ~2 min after start
        state["crisis"] = now
        _safe(_crisis)
    every = cfg.get("autoProposeMinutes", 0) * 60
    if every and now - state.get("propose", now - every + 180) >= every:
        state["propose"] = now
        _safe(_propose)


def _crisis(db) -> None:
    from .crisis import run_crisis
    run_crisis(db)


def _propose(db) -> None:
    """Re-propose unless a fresh batch is still waiting for a dispatcher."""
    ttl = get_setting(db, "dispatch")["proposalTtlMinutes"] * 60
    newest = db.query(DispatchProposal).filter(DispatchProposal.status == "Proposed").order_by(DispatchProposal.created_at.desc()).first()
    if newest and (utcnow() - newest.created_at).total_seconds() < ttl:
        return
    dispatch.propose(db, None)


async def loop() -> None:
    state: dict = {}
    await asyncio.sleep(2)
    while True:
        await asyncio.to_thread(tick, state)
        await asyncio.sleep(TRACKING_SWEEP_S)


def run_forever() -> None:
    state: dict = {}
    while True:
        tick(state)
        time.sleep(TRACKING_SWEEP_S)
