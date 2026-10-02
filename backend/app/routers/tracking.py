"""Telemetry ingestion and live vehicle queries."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..domain import TRIP_OPEN
from ..models import Anomaly, Tanker, Telemetry, Trip, User, utcnow
from ..schemas import AckIn, TelemetryIn
from ..security import actor_from, require
from ..services import tracking
from ..services.common import audit, get_setting
from ..services.realtime import hub
from .trips import anomaly_view

router = APIRouter(tags=["tracking"])
settings = get_settings()

_rate: dict[str, deque] = defaultdict(deque)
MAX_REQ_PER_10S = 20


def _parse(s: str) -> datetime:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Invalid deviceTime: {s!r}") from None
    return (dt.astimezone(timezone.utc) if dt.tzinfo else dt).replace(tzinfo=None)


@router.post("/tracking/telemetry")
def post_telemetry(body: TelemetryIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    q, now = _rate[body.vehicle_id], time.time()
    while q and now - q[0] > 10:
        q.popleft()
    if len(q) >= MAX_REQ_PER_10S:
        raise HTTPException(429, "Telemetry rate limit exceeded; batch points instead")
    q.append(now)
    fixes = [tracking.Fix(p.lat, p.lng, _parse(p.device_time), p.accuracy_m, p.speed_kmh, p.heading) for p in body.points]
    device_id = body.device_id or request.headers.get("x-device-id")
    res = tracking.ingest(db, user, body.vehicle_id, body.trip_id, body.source, device_id, fixes)
    return {"accepted": res.accepted, "duplicates": res.duplicates, "flagged": res.flagged, "rejected": res.rejected,
            "arrivedAt": res.arrived_stop, "tripStatus": res.trip_status, "serverTime": tracking.iso(utcnow())}


def _view(db: Session, t: Tanker, ops: dict) -> dict:
    return tracking.vehicle_view(t, ops, tracking.active_trip(db, t.id, TRIP_OPEN))


@router.get("/tracking/vehicles")
def vehicles(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    ops = get_setting(db, "operations")
    return {"serverTime": tracking.iso(utcnow()), "thresholds": {"liveSeconds": ops["liveSeconds"], "offlineSeconds": ops["offlineSeconds"]},
            "vehicles": [_view(db, t, ops) for t in db.scalars(select(Tanker).order_by(Tanker.id))]}


@router.get("/tracking/vehicles/{vehicle_id}/latest")
def latest(vehicle_id: str, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    t = db.get(Tanker, vehicle_id)
    if not t:
        raise HTTPException(404, "Unknown vehicle")
    return _view(db, t, get_setting(db, "operations"))


@router.get("/tracking/vehicles/{vehicle_id}/history")
def history(vehicle_id: str, trip: str | None = None, since: str | None = Query(None, alias="from"), until: str | None = Query(None, alias="to"),
            limit: int = 2000, include_rejected: bool = False, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(Telemetry).where(Telemetry.vehicle_id == vehicle_id)
    if trip:
        q = q.where(Telemetry.trip_id == int(trip.split("-")[-1]) - (3000 if trip.upper().startswith("TR-") else 0))
    if since:
        q = q.where(Telemetry.device_time >= _parse(since))
    if until:
        q = q.where(Telemetry.device_time <= _parse(until))
    if not include_rejected:
        q = q.where(Telemetry.accepted.is_(True))
    rows = list(db.scalars(q.order_by(Telemetry.device_time.desc()).limit(min(max(limit, 1), 10_000))))[::-1]
    return [{"lat": r.lat, "lng": r.lng, "accuracyM": r.accuracy_m, "speedKmh": r.speed_kmh, "heading": r.heading,
             "deviceTime": tracking.iso(r.device_time), "receivedAt": tracking.iso(r.received_at), "source": r.source,
             "accepted": r.accepted, "flags": r.flags} for r in rows]


_eta_cache: dict[str, tuple[float, dict]] = {}


@router.get("/tracking/vehicles/{vehicle_id}/eta")
def eta(vehicle_id: str, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """ESTIMATED drive time from the last real fix to the current destination (OSRM). Never extrapolated."""
    t = db.get(Tanker, vehicle_id)
    if not t:
        raise HTTPException(404, "Unknown vehicle")
    ops = get_setting(db, "operations")
    trip = tracking.active_trip(db, t.id)
    stop = tracking.current_stop(trip) if trip else None
    state, _age = tracking.tracking_state(t, ops)
    if stop is None or t.lat is None:
        return {"available": False, "reason": "No active destination or no GPS position"}
    if state == "offline":
        return {"available": False, "reason": "Vehicle offline; ETA not computed from a stale position"}
    key = f"{t.id}:{t.last_device_time}:{stop.id}"
    hit = _eta_cache.get(t.id)
    if hit and hit[1].get("key") == key and time.time() - hit[0] < 60:
        return hit[1]
    try:
        r = httpx.get(f"{settings.osrm_url}/route/v1/driving/{t.lng:.6f},{t.lat:.6f};{stop.community.lng:.6f},{stop.community.lat:.6f}",
                      params={"overview": "false"}, timeout=settings.routing_timeout_s)
        r.raise_for_status()
        route = r.json()["routes"][0]
        out = {"available": True, "kind": "ESTIMATED", "method": "OSRM road-network drive time from last GPS fix",
               "durationMin": round(route["duration"] / 60, 1), "roadDistanceKm": round(route["distance"] / 1000, 2),
               "fromFixTime": tracking.iso(t.last_device_time), "destination": stop.community.name, "key": key}
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        out = {"available": False, "reason": "Routing service unavailable"}
    _eta_cache[t.id] = (time.time(), out)
    return out


@router.get("/anomalies")
def anomalies(status: str = "open", limit: int = 200, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(Anomaly).order_by(Anomaly.detected_at.desc()).limit(min(max(limit, 1), 1000))
    if status != "all":
        q = q.where(Anomaly.status == status)
    return [anomaly_view(a) for a in db.scalars(q)]


@router.post("/anomalies/{anomaly_id}/acknowledge")
def acknowledge(anomaly_id: int, body: AckIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("acknowledge"))):
    a = db.get(Anomaly, anomaly_id)
    if not a:
        raise HTTPException(404, "Anomaly not found")
    before = {"status": a.status}
    if a.status == "open":
        a.status = "acknowledged"
    a.acknowledged_by, a.acknowledged_at, a.note = user.name, utcnow(), body.note
    audit(db, actor_from(request, user), "anomaly.acknowledge", "anomaly", a.id, {"kind": a.kind, "note": body.note}, before=before, after={"status": a.status})
    db.commit()
    hub.publish("anomalies.changed")
    return anomaly_view(a)
