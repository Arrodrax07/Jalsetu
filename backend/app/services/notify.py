"""In-app notifications. Channels (SMS / e-mail / push) plug in via ``CHANNELS`` without touching callers."""
from __future__ import annotations

import logging
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Notification
from .realtime import hub

log = logging.getLogger(__name__)

# Extra delivery channels: callables(notification) registered at startup when credentials exist.
CHANNELS: list[Callable[[Notification], None]] = []


def notify(db: Session, kind: str, severity: str, title: str, body: str = "", entity: str = "", entity_id: str = "",
           dedupe_key: str | None = None) -> Notification | None:
    """Create a notification (idempotent on ``dedupe_key``). Caller commits."""
    if dedupe_key and db.scalar(select(Notification.id).where(Notification.dedupe_key == dedupe_key)):
        return None
    n = Notification(kind=kind, severity=severity, title=title[:200], body=body, entity=entity, entity_id=str(entity_id), dedupe_key=dedupe_key)
    try:
        with db.begin_nested():
            db.add(n)
            db.flush()
    except IntegrityError:  # concurrent duplicate
        return None
    hub.publish("notification", {"id": n.id, "kind": kind, "severity": severity, "title": n.title, "body": body,
                                 "entity": entity, "entityId": str(entity_id)})
    for ch in CHANNELS:
        try:
            ch(n)
        except Exception:  # noqa: BLE001 — a failing channel must never break the workflow
            log.exception("notification channel failed")
    return n
