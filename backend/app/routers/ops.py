"""Command-centre support: geography, notifications, system health, ingestion control, overview KPIs."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db
from ..domain import SYNTHETIC, TANKER_AVAILABLE, TANKER_ON_TRIP, TRIP_OPEN
from ..ingestion.base import SOURCES
from ..ingestion.geoboundaries import run_geoboundaries
from ..ingestion.probes import probe_imd, probe_static
from ..ingestion.sachet import run_sachet
from ..models import (
    Anomaly, Community, Complaint, DataSource, Delivery, DisasterEvent, GeoDistrict, GeoState, IngestionRun, Notification,
    NotificationRead, Tanker, Telemetry, Trip, User, WaterRequest, utcnow,
)
from ..security import actor_from, any_user, require
from ..services import geography, ml, tracking
from ..services.common import audit, get_setting
from ..services.geo import contains
from ..services.views import iso

router = APIRouter(tags=["command centre"])
settings = get_settings()
IST = timedelta(hours=5, minutes=30)


def ist_day_start_utc(now: datetime) -> datetime:
    local = now + IST
    return datetime(local.year, local.month, local.day) - IST


# ---------------------------------------------------------------------------
# Geography
# ---------------------------------------------------------------------------
def _fc(rows, kind: str) -> dict:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": r.id, "geometry": r.geometry,
         "properties": {"id": r.id, "name": r.name, "kind": kind, "lgdCode": r.lgd_code, "bbox": r.bbox,
                        "centroid": [r.centroid_lat, r.centroid_lng], "source": r.source, "license": r.license}}
        for r in rows if r.geometry]}


@router.get("/geo/states")
def states(db: Session = Depends(get_db), _: User = Depends(any_user)):
    return _fc(db.scalars(select(GeoState).order_by(GeoState.name)), "state")


@router.get("/geo/states/{state_id}/districts")
def districts(state_id: int, db: Session = Depends(get_db), _: User = Depends(any_user)):
    return _fc(db.scalars(select(GeoDistrict).where(GeoDistrict.state_id == state_id).order_by(GeoDistrict.name)), "district")


@router.get("/geo/locate")
def locate(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180), db: Session = Depends(get_db), _: User = Depends(any_user)):
    sid, did = geography.locate(db, lat, lng)
    s, d = (db.get(GeoState, sid) if sid else None), (db.get(GeoDistrict, did) if did else None)
    return {"state": {"id": s.id, "name": s.name} if s else None, "district": {"id": d.id, "name": d.name, "lgdCode": d.lgd_code} if d else None}


@router.get("/geo/status")
def geo_status(db: Session = Depends(get_db), _: User = Depends(any_user)):
    return {"states": db.scalar(select(func.count(GeoState.id))), "districts": db.scalar(select(func.count(GeoDistrict.id))),
            "districtsWithLgdCode": db.scalar(select(func.count(GeoDistrict.id)).where(GeoDistrict.lgd_code.is_not(None)))}


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@router.get("/notifications")
def notifications(limit: int = 50, unread_only: bool = False, db: Session = Depends(get_db), user: User = Depends(require("view_operations"))):
    read_ids = {nid for (nid,) in db.execute(select(NotificationRead.notification_id).where(NotificationRead.user_id == user.id))}
    rows = db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(min(max(limit, 1), 200)))
    out = [{"id": n.id, "kind": n.kind, "severity": n.severity, "title": n.title, "body": n.body, "entity": n.entity,
            "entityId": n.entity_id, "createdAt": iso(n.created_at), "read": n.id in read_ids} for n in rows]
    if unread_only:
        out = [n for n in out if not n["read"]]
    return {"unread": sum(not n["read"] for n in out), "items": out}


@router.post("/notifications/read")
def mark_read(ids: list[int] | None = None, db: Session = Depends(get_db), user: User = Depends(require("view_operations"))):
    q = select(Notification.id)
    if ids:
        q = q.where(Notification.id.in_(ids))
    have = {nid for (nid,) in db.execute(select(NotificationRead.notification_id).where(NotificationRead.user_id == user.id))}
    for (nid,) in db.execute(q):
        if nid not in have:
            db.add(NotificationRead(notification_id=nid, user_id=user.id))
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# System health
# ---------------------------------------------------------------------------
@router.get("/system/health")
def system_health(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    now = utcnow()
    t0 = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        db_ok, db_ms = True, round((time.perf_counter() - t0) * 1000, 1)
    except Exception:  # noqa: BLE001
        db_ok, db_ms = False, None
    m = ml.status()
    last_fix = db.scalar(select(func.max(Telemetry.received_at)))
    fixes_10m = db.scalar(select(func.count(Telemetry.id)).where(Telemetry.received_at >= now - timedelta(minutes=10)))
    ops = get_setting(db, "operations")
    live = sum(1 for t in db.scalars(select(Tanker)) if tracking.tracking_state(t, ops, now)[0] == "live")
    sources = []
    for key, spec in SOURCES.items():
        row = db.get(DataSource, key)
        sources.append({"key": key, "name": spec.name, "provider": spec.provider, "kind": spec.kind,
                        "status": row.status if row else "unknown", "lastSuccessAt": iso(row.last_success_at) if row else None,
                        "lastAttemptAt": iso(row.last_attempt_at) if row else None, "lastError": row.last_error if row else None,
                        "url": spec.url, "access": spec.access, "auth": spec.auth, "frequency": spec.frequency, "license": spec.license, "env": spec.env})
    return {
        "serverTime": iso(now),
        "database": {"status": "healthy" if db_ok else "down", "latencyMs": db_ms, "engine": db.bind.dialect.name},
        "ml": {"complaintClassifier": "healthy" if m["complaintClassifier"]["loaded"] else "unavailable",
               "demandForecaster": "healthy" if m["demandForecaster"]["loaded"] else "unavailable",
               "errors": {k: v["error"] for k, v in (("complaints", m["complaintClassifier"]), ("demand", m["demandForecaster"])) if v["error"]}},
        "gpsIngestion": {"status": "receiving" if fixes_10m else "idle", "lastFixReceivedAt": iso(last_fix), "fixesLast10Min": fixes_10m, "vehiclesLive": live},
        "backgroundJobs": settings.run_background_jobs,
        "sources": sources,
    }


_running: set[str] = set()


@router.post("/ingestion/{key}/run")
def run_ingestion(key: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require("run_ingestion"))):
    jobs = {"ndma_sachet": run_sachet, "geoboundaries": run_geoboundaries, "probes": lambda s: (probe_static(s), probe_imd(s))}
    if key not in jobs:
        raise HTTPException(404, "Unknown ingestion job")
    if key in _running:
        raise HTTPException(409, "Already running")
    audit(db, actor_from(request, user), "ingestion.run", "data_source", key)
    db.commit()

    def work():
        _running.add(key)
        try:
            with SessionLocal() as s:
                jobs[key](s)
        finally:
            _running.discard(key)

    threading.Thread(target=work, daemon=True).start()
    return {"started": key}


@router.get("/ingestion/runs")
def ingestion_runs(source: str | None = None, limit: int = 50, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(IngestionRun).order_by(IngestionRun.started_at.desc()).limit(min(limit, 500))
    if source:
        q = q.where(IngestionRun.source_key == source)
    return [{"id": r.id, "source": r.source_key, "startedAt": iso(r.started_at), "finishedAt": iso(r.finished_at), "status": r.status,
             "fetched": r.fetched, "created": r.created, "updated": r.updated, "unchanged": r.unchanged, "error": r.error} for r in db.scalars(q)]


# ---------------------------------------------------------------------------
# Overview KPIs (every number is a count of real rows)
# ---------------------------------------------------------------------------
@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    now = utcnow()
    day0 = ist_day_start_utc(now)
    ops = get_setting(db, "operations")
    active_events = list(db.scalars(select(DisasterEvent).where(DisasterEvent.msg_type != "Cancel",
                                                                or_(DisasterEvent.expires_at.is_(None), DisasterEvent.expires_at > now))))
    emergencies = [e for e in active_events if e.severity in ("Extreme", "Severe")]
    communities = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    affected = set()
    for e in active_events:
        for c in communities:
            if c.id in affected:
                continue
            if (e.geometry and contains(e.geometry, c.lat, c.lng, e.bbox)) or (
                    not e.geometry and c.district and c.district.lgd_code and c.district.lgd_code in (e.lgd_district_codes or [])):
                affected.add(c.id)
    tankers = list(db.scalars(select(Tanker)))
    states = [tracking.tracking_state(t, ops, now)[0] for t in tankers]
    sachet = db.get(DataSource, "ndma_sachet")
    return {
        "serverTime": iso(now),
        "istDayStart": iso(day0),
        "activeAlerts": len(active_events),
        "activeEmergencies": len(emergencies),
        "alertFeedStatus": sachet.status if sachet else "unknown",
        "alertFeedLastSuccess": iso(sachet.last_success_at) if sachet else None,
        "activeRequests": db.scalar(select(func.count(WaterRequest.id)).where(WaterRequest.status.in_(("Pending", "Allocated", "Dispatched")))),
        "criticalRequests": db.scalar(select(func.count(WaterRequest.id)).where(WaterRequest.status.in_(("Pending", "Allocated")), WaterRequest.urgency == "Critical")),
        "tankersOnRoad": sum(1 for t in tankers if t.status == TANKER_ON_TRIP),
        "tankersAvailable": sum(1 for t in tankers if t.status == TANKER_AVAILABLE),
        "tankersTotal": len(tankers),
        "vehiclesLive": states.count("live"), "vehiclesStale": states.count("stale"), "vehiclesOffline": states.count("offline"),
        "openTrips": db.scalar(select(func.count(Trip.id)).where(Trip.status.in_(TRIP_OPEN))),
        "deliveriesToday": db.scalar(select(func.count(Delivery.id)).where(Delivery.delivered_at >= day0, Delivery.data_origin != SYNTHETIC)),
        "litresDeliveredToday": db.scalar(select(func.coalesce(func.sum(Delivery.delivered_amount), 0)).where(Delivery.delivered_at >= day0, Delivery.data_origin != SYNTHETIC)),
        "tripsCompletedToday": db.scalar(select(func.count(Trip.id)).where(Trip.completed_at >= day0, Trip.data_origin != SYNTHETIC)),
        "communitiesAffected": len(affected),
        "communitiesTotal": len(communities),
        "openComplaints": db.scalar(select(func.count(Complaint.id)).where(Complaint.status != "Resolved")),
        "openAnomalies": db.scalar(select(func.count(Anomaly.id)).where(Anomaly.status == "open")),
        "pendingVerifications": db.scalar(select(func.count(Delivery.id)).where(Delivery.status.in_(("Pending Verification", "Mismatch", "Under Investigation")))),
    }
