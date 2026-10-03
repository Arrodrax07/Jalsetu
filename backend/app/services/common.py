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
        "liveCrisis": 0.25,
        "waterAccess": 0.10,
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
        "tankerShiftHours": 10,           # driving hours a tanker can work per day (impact replay, planning)
        "stopServiceMinutes": 30,         # filling + unloading time per stop
        "geofenceRadiusM": 150,
        "varianceTolerancePct": 5,
        "duplicateSimilarity": 0.55,
        "requestDuplicateHours": 48,      # a new water request for a place with an open request this recent is merged
        # --- live tracking (all derived from real telemetry timestamps) ---
        "liveSeconds": 30,                # LIVE if last fix received within this
        "offlineSeconds": 180,            # STALE between live and this; OFFLINE beyond
        "arrivalConsecutiveFixes": 2,     # fixes inside the geofence needed to declare arrival
        "arrivalMaxAccuracyM": 100,       # fixes less accurate than this never count toward arrival
        "startMaxAccuracyM": 200,         # START TRIP requires a fix at least this accurate
        "maxPlausibleSpeedKmh": 160,      # implied speed above this between fixes = GPS jump
        "lowAccuracyM": 150,              # flag fixes worse than this
        "deviationThresholdM": 300,       # distance from planned route (plus fix accuracy) counted as off-route
        "deviationConsecutiveFixes": 3,
        "prolongedStopMinutes": 10,
        "maxClockSkewSeconds": 120,       # device timestamps further in the future are rejected
        "maxBufferedAgeHours": 24,        # oldest offline-buffered fix accepted
        "requireReceiverName": True,      # delivery verification policy
        "requireProofForVerification": False,
    },
    "dispatch": {                         # auto-dispatch proposals (services.dispatch)
        "maxDistanceKm": 150,             # straight-line reach from a tanker's depot
        "clusterRadiusKm": 15,            # extra stops must be this close to the first stop
        "maxStops": 3,
        "minPriority": 40,
        "autoApproveCritical": False,     # True: proposals whose first stop is Critical become trips immediately
        "autoProposeMinutes": 30,         # background re-proposal interval (0 = only on demand)
        "proposalTtlMinutes": 60,         # background runs leave a fresh batch alone this long
        "crisisRefreshMinutes": 180,      # news + rainfall signals refresh (0 = only on demand)
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


def audit(db: Session, who, action: str, entity: str, entity_id: Any, details: dict | None = None,
          before: dict | None = None, after: dict | None = None) -> None:
    """``who`` is a security.Actor (preferred: carries IP/device) or a User or None (system)."""
    user = getattr(who, "user", who)
    db.add(AuditLog(
        user_email=user.email if user else "system",
        user_role=user.role if user else "system",
        action=action,
        entity=entity,
        entity_id=str(entity_id),
        details=details or {},
        before=before,
        after=after,
        ip=getattr(who, "ip", ""),
        user_agent=getattr(who, "user_agent", ""),
        device_id=getattr(who, "device_id", ""),
    ))


def snapshot(obj, fields: tuple[str, ...]) -> dict:
    """Small JSON-safe before/after snapshot of selected attributes."""
    out = {}
    for f in fields:
        v = getattr(obj, f, None)
        out[f] = v.isoformat() if hasattr(v, "isoformat") else v
    return out
