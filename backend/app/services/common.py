"""Small shared helpers: geodesy, settings store, audit log."""
from __future__ import annotations

import math
from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from ..models import AuditLog, Setting, User

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Settings (stored as JSON rows so admins can tune them at runtime)
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    "weights": {
        "demand": 0.35,
        "vulnerability": 0.30,
        "unmetNeed": 0.20,
        "previousCoverage": 0.10,
        "population": 0.05,
    },
    "operations": {
        "tripsPerDay": 5,                 # refills per tanker per day -> daily supply capacity
        "survivalLitresPerPerson": 3,     # Sphere/WHO drinking+cooking minimum guaranteed before anything else
        "minCoveragePct": 50,             # policy guarantee: no community below this % of demand (when supply allows)
        "protectVulnerabilityAbove": 80,  # communities held harmless during disruptions
        "dieselPricePerLitre": 92.0,      # INR
        "tankerKmPerLitre": 4.0,
        "co2KgPerLitreDiesel": 2.68,
        "fallbackSpeedKmh": 22.0,         # used only if OSRM is unreachable
        "roadCircuityFactor": 1.35,       # haversine -> road distance when OSRM is unreachable
        "geofenceRadiusM": 150,
        "varianceTolerancePct": 5,
        "duplicateSimilarity": 0.55,
    },
}


def get_setting(db: Session, key: str) -> dict[str, Any]:
    row = db.get(Setting, key)
    merged = deepcopy(DEFAULT_SETTINGS.get(key, {}))
    if row:
        merged.update(row.value or {})
    return merged


def put_setting(db: Session, key: str, value: dict[str, Any]) -> dict[str, Any]:
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.flush()
    return get_setting(db, key)


def audit(db: Session, user: User | None, action: str, entity: str, entity_id: Any, details: dict | None = None) -> None:
    db.add(AuditLog(
        user_email=user.email if user else "system",
        action=action,
        entity=entity,
        entity_id=str(entity_id),
        details=details or {},
    ))
