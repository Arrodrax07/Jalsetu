"""Administrative geography lookups (India -> state -> district)."""
from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import GeoDistrict, GeoState
from .geo import contains

_cache: dict[str, tuple[float, list]] = {}
TTL = 600


def _load(db: Session, model) -> list:
    key = model.__tablename__
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    rows = [(r.id, r.state_id if model is GeoDistrict else None, r.bbox, r.geometry)
            for r in db.scalars(select(model).where(model.geometry.is_not(None)))]
    _cache[key] = (time.time(), rows)
    return rows


def invalidate() -> None:
    _cache.clear()


def locate(db: Session, lat: float, lng: float) -> tuple[int | None, int | None]:
    """(state_id, district_id) containing the point, or (None, None) if boundaries are not imported / no match."""
    district = next((d for d in _load(db, GeoDistrict) if contains(d[3], lat, lng, d[2])), None)
    if district:
        return district[1], district[0]
    state = next((s for s in _load(db, GeoState) if contains(s[3], lat, lng, s[2])), None)
    return (state[0] if state else None), None
