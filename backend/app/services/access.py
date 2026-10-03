"""Water access distance: straight-line km from each community to the nearest place water can come from.

"Nearest place" = any recorded water source (OpenStreetMap water works, reservoirs, wells, filling points...)
or any active tanker depot. Sewage/drain/rainwater sites are not sources of drinking water and are skipped.

A community far from every source has no fallback when tankers are late (residents cannot walk to another
supply), so the priority score gains a ``waterAccess`` factor:  S = 100 * min(1, km / FULL_SCORE_KM).
The distance is straight-line (an underestimate of road distance) and is labelled that way everywhere.
"""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Community, Depot, WaterSource

FULL_SCORE_KM = 30.0  # at or beyond this distance from any source the factor is 100
_NOT_DRINKING = ("sewage", "drain", "waste", "rainwater", "stormwater")


def _points(db: Session) -> list[tuple[float, float, str]]:
    pts = [(d.lat, d.lng, f"depot {d.name}") for d in db.scalars(select(Depot).where(Depot.is_active.is_(True)))]
    for s in db.scalars(select(WaterSource)):
        kind = f"{s.kind} {s.name}".lower()
        if any(w in kind for w in _NOT_DRINKING):
            continue
        pts.append((s.lat, s.lng, f"{s.kind.replace('_', ' ')} {s.name}".strip()))
    return pts


def _nearest(lat: float, lng: float, pts: list[tuple[float, float, str]]) -> tuple[float, str] | None:
    # Equirectangular approximation for the search (fast), haversine for the reported distance.
    best, best_d2 = None, math.inf
    k = math.cos(math.radians(lat))
    for plat, plng, label in pts:
        d2 = (plat - lat) ** 2 + ((plng - lng) * k) ** 2
        if d2 < best_d2:
            best, best_d2 = (plat, plng, label), d2
    if best is None:
        return None
    from .common import haversine_m
    return haversine_m(lat, lng, best[0], best[1]) / 1000, best[2]


def recompute(db: Session, only_missing: bool = False) -> int:
    """Store water_access_km for every community (or only those not computed yet). Returns rows updated."""
    pts = _points(db)
    if not pts:
        return 0
    q = select(Community)
    if only_missing:
        q = q.where(Community.water_access_km.is_(None))
    n = 0
    for c in db.scalars(q):
        hit = _nearest(c.lat, c.lng, pts)
        if hit is None:
            continue
        km, label = hit
        c.water_access_km = round(km, 2)
        c.water_access_note = f"{km:.1f} km (straight line) to {label}"[:200]
        n += 1
    db.commit()
    return n


def subscore(community) -> float:
    km = getattr(community, "water_access_km", None)
    if km is None:
        return 0.0
    return round(100 * min(1.0, km / FULL_SCORE_KM), 1)
