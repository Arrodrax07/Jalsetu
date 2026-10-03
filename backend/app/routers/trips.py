"""Route planning, trip lifecycle, driver workflow and proof-of-delivery.

PLANNED -> ASSIGNED -> ACCEPTED -> (driver START, real GPS) EN ROUTE -> (GPS geofence) ARRIVED
-> (driver confirms) DELIVERING -> (driver records POD) DELIVERED -> (operator verifies every stop) COMPLETED
Dispatch never starts a trip; only the driver's START with a fresh, accurate fix does.
"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from ..config import get_settings
from ..db import get_db
from ..domain import (
    SYNTHETIC,
    D_INVESTIGATION, D_MISMATCH, D_PENDING, D_VERIFIED, STOP_ARRIVED, STOP_DELIVERED, STOP_PENDING, STOP_VERIFIED,
    T_ACCEPTED, T_ARRIVED, T_ASSIGNED, T_CANCELLED, T_COMPLETED, T_DELIVERED, T_DELIVERING, T_EN_ROUTE, T_PLANNED,
    TANKER_ASSIGNED, TANKER_AVAILABLE, TANKER_MAINTENANCE, TANKER_ON_TRIP, TRIP_OPEN, TRIP_TRANSITIONS,
)
from ..models import Anomaly, AuditLog, Community, Delivery, Depot, Tanker, Telemetry, Trip, TripStop, User, WaterRequest, utcnow
from ..schemas import AssignDriverIn, CancelIn, DeliveryAction, DispatchIn, RouteOptimizeIn, StartTripIn
from ..security import actor_from, any_user, require
from ..services import tracking
from ..services.common import audit, get_setting, haversine_m, snapshot
from ..services.geo import polyline_length_km
from ..services.notify import notify
from ..services.realtime import hub
from ..services.routing import Point, optimise_route, route_geometry
from ..services.views import community_views, delivery_view, iso

router = APIRouter(tags=["trips & delivery"])
settings = get_settings()

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
IMAGE_MAGIC = {".jpg": (b"\xff\xd8\xff",), ".png": (b"\x89PNG\r\n\x1a\n",), ".webp": (b"RIFF",)}
TRIP_FIELDS = ("status", "driver_user_id", "started_at", "arrived_at", "driver_ended_at", "completed_at", "cancelled_at")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def get_trip(db: Session, ref: str | int) -> Trip:
    try:
        tid = int(str(ref).split("-")[-1])
        tid = tid - 3000 if str(ref).upper().startswith("TR-") else tid
    except ValueError:
        raise HTTPException(404, "Trip not found") from None
    trip = db.get(Trip, tid)
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


def transition(trip: Trip, to: str) -> None:
    if to not in TRIP_TRANSITIONS.get(trip.status, ()):
        raise HTTPException(409, f"Trip {trip.code} is {trip.status}; cannot move to {to}")
    trip.status = to


def require_driver_of(trip: Trip, user: User) -> None:
    if trip.driver_user_id != user.id:
        raise HTTPException(403, "This trip is assigned to a different driver")


def trip_view(db: Session, trip: Trip, detail: bool = False) -> dict:
    ops = get_setting(db, "operations")
    stops = []
    for s in trip.stops:
        stops.append({
            "id": s.id, "seq": s.seq, "communityId": s.community_id, "communityName": s.community.name,
            "lat": s.community.lat, "lng": s.community.lng, "allocatedLitres": s.allocated_litres, "status": s.status,
            "arrivedAt": iso(s.arrived_at), "arrivalDistanceM": s.arrival_distance_m, "arrivalConfirmedAt": iso(s.arrival_confirmed_at),
            "deliveredAt": iso(s.delivered_at), "verifiedAt": iso(s.verified_at),
            "dataOrigin": s.community.data_origin,
        })
    out = {
        "id": trip.code, "dbId": trip.id, "tankerId": trip.tanker_id, "vehicleNumber": trip.tanker.vehicle_number,
        "driverUserId": trip.driver_user_id, "driverName": trip.driver.name if trip.driver else None,
        "status": trip.status, "distanceKm": trip.distance_km, "durationMin": trip.duration_min,
        "baselineDistanceKm": trip.baseline_distance_km, "baselineDurationMin": trip.baseline_duration_min,
        "routingSource": trip.routing_source, "routeGeometry": trip.route_geometry,
        "createdAt": iso(trip.created_at), "assignedAt": iso(trip.assigned_at), "acceptedAt": iso(trip.accepted_at),
        "startedAt": iso(trip.started_at), "startLat": trip.start_lat, "startLng": trip.start_lng,
        "arrivedAt": iso(trip.arrived_at), "driverEndedAt": iso(trip.driver_ended_at), "verifiedAt": iso(trip.verified_at),
        "completedAt": iso(trip.completed_at), "cancelledAt": iso(trip.cancelled_at), "cancelReason": trip.cancel_reason,
        "distanceTravelledKm": trip.distance_travelled_km,
        "geofenceRadiusM": ops["geofenceRadiusM"],
        "stops": stops,
    }
    if detail:
        pts = actual_route(db, trip.id)
        out["actualRoute"] = thin(pts, 2000)
        out["actualPointCount"] = len(pts)
        if trip.status not in (T_COMPLETED, T_CANCELLED):
            out["distanceTravelledKm"] = round(polyline_length_km(pts), 3)
        out["dispatchRouteGeometry"] = trip.dispatch_route_geometry
        out["deliveries"] = [delivery_view(d) for d in db.scalars(select(Delivery).where(Delivery.trip_id == trip.id).order_by(Delivery.delivered_at))]
        out["anomalies"] = [anomaly_view(a) for a in db.scalars(select(Anomaly).where(Anomaly.trip_id == trip.id).order_by(Anomaly.detected_at))]
        out["timeline"] = [{"at": iso(a.created_at), "action": a.action, "by": a.user_email, "details": a.details}
                           for a in db.scalars(select(AuditLog).where(AuditLog.entity == "trip", AuditLog.entity_id == trip.code).order_by(AuditLog.created_at))]
    return out


def anomaly_view(a: Anomaly) -> dict:
    return {"id": a.id, "kind": a.kind, "vehicleId": a.vehicle_id, "tripId": f"TR-{3000 + a.trip_id}" if a.trip_id else None,
            "detectedAt": iso(a.detected_at), "lat": a.lat, "lng": a.lng, "value": a.value, "details": a.details,
            "status": a.status, "acknowledgedBy": a.acknowledged_by, "acknowledgedAt": iso(a.acknowledged_at), "note": a.note,
            "resolvedAt": iso(a.resolved_at)}


def actual_route(db: Session, trip_id: int) -> list[tuple[float, float]]:
    rows = db.execute(select(Telemetry.lat, Telemetry.lng).where(Telemetry.trip_id == trip_id, Telemetry.accepted.is_(True))
                      .order_by(Telemetry.device_time)).all()
    return [(r[0], r[1]) for r in rows]


def thin(pts: list, n: int) -> list:
    if len(pts) <= n:
        return [list(p) for p in pts]
    step = len(pts) / n
    out = [list(pts[int(i * step)]) for i in range(n)]
    out[-1] = list(pts[-1])
    return out


def publish_trip(trip: Trip) -> None:
    hub.publish("trip.changed", {"id": trip.code, "status": trip.status, "tankerId": trip.tanker_id})
    hub.publish("tankers.changed")


# ---------------------------------------------------------------------------
# Planning & dispatch
# ---------------------------------------------------------------------------
def plan_route(db: Session, body: RouteOptimizeIn):
    tanker = db.get(Tanker, body.tanker_id)
    if not tanker:
        raise HTTPException(404, "Tanker not found")
    depot = tanker.depot or db.scalar(select(Depot))
    if not depot:
        raise HTTPException(400, "No depot configured")
    ids = list(dict.fromkeys(body.community_ids))
    views = {v["id"]: v for v in community_views(db)}
    missing = [i for i in ids if i not in views]
    if missing:
        raise HTTPException(404, f"Unknown or inactive communities: {missing}")
    if body.litres:
        litres = {i: int(body.litres.get(i, 0)) for i in ids}
    else:  # split capacity in proportion to each stop's shortfall
        need = {i: max(views[i]["shortfall"], 1) for i in ids}
        tot = sum(need.values())
        litres = {i: max(100, int(tanker.capacity * need[i] / tot // 100 * 100)) for i in ids}
    if any(v <= 0 for v in litres.values()):
        raise HTTPException(400, "Every stop needs a positive quantity")
    if sum(litres.values()) > tanker.capacity:
        raise HTTPException(400, f"Stops need {sum(litres.values()):,} L but {tanker.id} carries {tanker.capacity:,} L")

    ops = get_setting(db, "operations")
    stops = [Point(i, views[i]["name"], views[i]["lat"], views[i]["lng"], views[i]["priorityScore"] / 100) for i in ids]
    plan = optimise_route(Point("depot", depot.name, depot.lat, depot.lng), stops, ops["fallbackSpeedKmh"], ops["roadCircuityFactor"])
    fuel = lambda km: km / ops["tankerKmPerLitre"]  # noqa: E731
    saved_km = round(plan.baseline_distance_km - plan.distance_km, 2)
    result = {
        "tankerId": tanker.id, "vehicleNumber": tanker.vehicle_number,
        "depot": {"name": depot.name, "lat": depot.lat, "lng": depot.lng},
        "stops": [s.name for s in stops], "recommendedSequence": [s.name for s in plan.sequence],
        "sequence": [{"communityId": s.key, "name": s.name, "lat": s.lat, "lng": s.lng,
                      "priorityScore": views[s.key]["priorityScore"], "litres": litres[s.key]} for s in plan.sequence],
        "distanceBeforeKm": plan.baseline_distance_km, "distanceAfterKm": plan.distance_km, "distanceSavedKm": saved_km,
        "timeBeforeMin": plan.baseline_duration_min, "timeAfterMin": plan.duration_min,
        "timeSavedMin": round(plan.baseline_duration_min - plan.duration_min, 1),
        "fuelLitresAfter": round(fuel(plan.distance_km), 2),
        "fuelSavedInr": round(fuel(saved_km) * ops["dieselPricePerLitre"]),
        "co2SavedKg": round(fuel(saved_km) * ops["co2KgPerLitreDiesel"], 2),
        "routeGeometry": plan.geometry, "routingSource": plan.source,
        "assumptions": {"dieselPricePerLitre": ops["dieselPricePerLitre"], "tankerKmPerLitre": ops["tankerKmPerLitre"],
                        "baseline": "stops in the order entered, depot -> stops -> depot"},
    }
    return tanker, depot, plan, litres, result


@router.post("/routes/optimize")
def optimize(body: RouteOptimizeIn, db: Session = Depends(get_db), _: User = Depends(require("dispatch"))):
    return plan_route(db, body)[4]


def _check_driver(db: Session, driver_id: int, exclude_trip: int | None = None) -> User:
    driver = db.get(User, driver_id)
    if not driver or driver.role != "driver" or not driver.is_active:
        raise HTTPException(400, "Selected user is not an active driver")
    busy = db.scalar(select(Trip).where(Trip.driver_user_id == driver_id, Trip.status.in_(TRIP_OPEN),
                                        Trip.id != (exclude_trip or -1)))
    if busy:
        raise HTTPException(409, f"{driver.name} already has open trip {busy.code}")
    return driver


@router.post("/trips", status_code=201)
def create_trip(body: DispatchIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("dispatch"))):
    return dispatch_trip(db, body, actor_from(request, user), user)


def dispatch_trip(db: Session, body: DispatchIn, actor, user: User | None):
    """Create and (optionally) assign a trip. Shared by manual dispatch and approved auto-dispatch proposals."""
    tanker, depot, plan, litres, result = plan_route(db, body)
    if tanker.status != TANKER_AVAILABLE:
        raise HTTPException(409, f"{tanker.vehicle_number} is {tanker.status}; only Available tankers can be assigned")
    driver = _check_driver(db, body.driver_user_id) if body.driver_user_id else None
    now = utcnow()
    trip = Trip(tanker_id=tanker.id, driver_user_id=driver.id if driver else None, status=T_ASSIGNED if driver else T_PLANNED,
                origin_depot_id=depot.id, route_geometry=plan.geometry, dispatch_route_geometry=plan.geometry,
                distance_km=plan.distance_km, duration_min=plan.duration_min, baseline_distance_km=plan.baseline_distance_km,
                baseline_duration_min=plan.baseline_duration_min, routing_source=plan.source, created_by=user.id if user else None,
                assigned_at=now if driver else None)
    for seq, p in enumerate(plan.sequence, start=1):
        trip.stops.append(TripStop(seq=seq, community_id=p.key, allocated_litres=litres[p.key]))
    db.add(trip)
    before = snapshot(tanker, ("status", "driver_user_id"))
    tanker.status, tanker.current_load = TANKER_ASSIGNED, sum(litres.values())
    if driver:
        tanker.driver_user_id, tanker.driver_name, tanker.driver_phone = driver.id, driver.name, driver.phone
    db.execute(update(WaterRequest).where(WaterRequest.status == "Allocated", WaterRequest.community_id.in_(list(litres)))
               .values(status="Dispatched", updated_at=now))
    db.flush()
    audit(db, actor, "trip.create", "trip", trip.code,
          {"tanker": tanker.id, "driver": driver.email if driver else None, "stops": [p.key for p in plan.sequence], "km": plan.distance_km},
          before={"tanker": before}, after={"tanker": snapshot(tanker, ("status", "driver_user_id")), "trip": snapshot(trip, TRIP_FIELDS)})
    if driver:
        notify(db, "trip_assigned", "info", f"{trip.code} assigned to {driver.name}", f"{tanker.vehicle_number}: "
               + " → ".join(s.community.name for s in trip.stops if s.community) , "trip", trip.code)
    db.commit()
    db.refresh(trip)
    publish_trip(trip)
    hub.publish("requests.changed")
    return {**trip_view(db, trip), "optimization": result}


@router.post("/trips/{ref}/assign-driver")
def assign_driver(ref: str, body: AssignDriverIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("dispatch"))):
    trip = get_trip(db, ref)
    if trip.status not in (T_PLANNED, T_ASSIGNED):
        raise HTTPException(409, f"Driver can only be (re)assigned before the driver accepts; trip is {trip.status}")
    driver = _check_driver(db, body.driver_user_id, exclude_trip=trip.id)
    before = snapshot(trip, TRIP_FIELDS)
    transition(trip, T_ASSIGNED)
    trip.driver_user_id, trip.assigned_at = driver.id, utcnow()
    t = trip.tanker
    t.driver_user_id, t.driver_name, t.driver_phone = driver.id, driver.name, driver.phone
    audit(db, actor_from(request, user), "trip.assign_driver", "trip", trip.code, {"driver": driver.email}, before=before, after=snapshot(trip, TRIP_FIELDS))
    db.commit()
    publish_trip(trip)
    return trip_view(db, trip)


@router.post("/trips/{ref}/cancel")
def cancel_trip(ref: str, body: CancelIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("dispatch"))):
    trip = get_trip(db, ref)
    before = snapshot(trip, TRIP_FIELDS)
    transition(trip, T_CANCELLED)
    trip.cancelled_at, trip.cancel_reason = utcnow(), body.reason
    if trip.tanker.status in (TANKER_ASSIGNED, TANKER_ON_TRIP):
        trip.tanker.status = TANKER_AVAILABLE
    undelivered = [s.community_id for s in trip.stops if s.status in (STOP_PENDING, STOP_ARRIVED)]
    if undelivered:
        db.execute(update(WaterRequest).where(WaterRequest.status == "Dispatched", WaterRequest.community_id.in_(undelivered))
                   .values(status="Allocated", updated_at=utcnow()))
    audit(db, actor_from(request, user), "trip.cancel", "trip", trip.code, {"reason": body.reason}, before=before, after=snapshot(trip, TRIP_FIELDS))
    db.commit()
    publish_trip(trip)
    hub.publish("requests.changed")
    return trip_view(db, trip)


@router.get("/trips")
def list_trips(active: bool = False, limit: int = 100, include_synthetic: bool = False, db: Session = Depends(get_db),
               _: User = Depends(require("view_operations"))):
    q = select(Trip).options(joinedload(Trip.tanker)).order_by(Trip.created_at.desc()).limit(min(max(limit, 1), 500))
    if not include_synthetic:
        q = q.where(Trip.data_origin != SYNTHETIC)
    if active:
        q = q.where(Trip.status.in_(TRIP_OPEN))
    return [trip_view(db, t) for t in db.scalars(q).unique()]


@router.get("/trips/{ref}")
def get_trip_detail(ref: str, db: Session = Depends(get_db), user: User = Depends(any_user)):
    trip = get_trip(db, ref)
    if user.role == "driver" and trip.driver_user_id != user.id:
        raise HTTPException(403, "Not your trip")
    return trip_view(db, trip, detail=True)


# ---------------------------------------------------------------------------
# Driver workflow
# ---------------------------------------------------------------------------
@router.get("/driver/assignment")
def driver_assignment(db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    trip = db.scalar(select(Trip).where(Trip.driver_user_id == user.id, Trip.status.in_(TRIP_OPEN), Trip.driver_ended_at.is_(None))
                     .order_by(Trip.created_at.desc()))
    ops = get_setting(db, "operations")
    tanker = trip.tanker if trip else db.scalar(select(Tanker).where(Tanker.driver_user_id == user.id))
    return {
        "vehicle": tracking.vehicle_view(tanker, ops, trip) if tanker else None,
        "trip": trip_view(db, trip) if trip else None,
        "thresholds": {k: ops[k] for k in ("geofenceRadiusM", "arrivalConsecutiveFixes", "arrivalMaxAccuracyM", "startMaxAccuracyM", "liveSeconds", "offlineSeconds")},
        "serverTime": iso(utcnow()),
    }


@router.post("/trips/{ref}/accept")
def accept_trip(ref: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    trip = get_trip(db, ref)
    require_driver_of(trip, user)
    before = snapshot(trip, TRIP_FIELDS)
    transition(trip, T_ACCEPTED)
    trip.accepted_at = utcnow()
    audit(db, actor_from(request, user), "trip.accept", "trip", trip.code, before=before, after=snapshot(trip, TRIP_FIELDS))
    db.commit()
    publish_trip(trip)
    return trip_view(db, trip)


def _parse_time(s: str) -> datetime:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "deviceTime must be ISO-8601") from None
    return (dt.astimezone(timezone.utc) if dt.tzinfo else dt).replace(tzinfo=None)


@router.post("/trips/{ref}/start")
def start_trip(ref: str, body: StartTripIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    trip = get_trip(db, ref)
    require_driver_of(trip, user)
    if trip.status != T_ACCEPTED:
        raise HTTPException(409, f"Trip is {trip.status}; accept it before starting")
    if trip.tanker.status == TANKER_MAINTENANCE:
        raise HTTPException(409, "Vehicle is marked under maintenance")
    ops = get_setting(db, "operations")
    now = utcnow()
    fix = tracking.Fix(body.lat, body.lng, _parse_time(body.device_time), body.accuracy_m, body.speed_kmh, body.heading)
    problem = tracking._validate(fix, ops, now, trip)
    if problem:
        raise HTTPException(422, f"GPS fix rejected: {problem}")
    if now - fix.device_time > timedelta(seconds=ops["maxClockSkewSeconds"]):
        raise HTTPException(422, "GPS fix is not fresh. Wait for a current location and try again.")
    if fix.accuracy_m is None or fix.accuracy_m > ops["startMaxAccuracyM"]:
        raise HTTPException(422, f"GPS accuracy {fix.accuracy_m or 'unknown'} m is too poor to start (needs ≤ {ops['startMaxAccuracyM']} m). Move to open sky and retry.")

    before = snapshot(trip, TRIP_FIELDS)
    transition(trip, T_EN_ROUTE)
    trip.started_at, trip.start_lat, trip.start_lng, trip.start_accuracy_m = now, fix.lat, fix.lng, fix.accuracy_m
    t = trip.tanker
    t.status = TANKER_ON_TRIP
    db.add(Telemetry(vehicle_id=t.id, driver_user_id=user.id, trip_id=trip.id, lat=fix.lat, lng=fix.lng, accuracy_m=fix.accuracy_m,
                     speed_kmh=fix.speed_kmh, heading=fix.heading, device_time=fix.device_time, received_at=now, source=body.source,
                     device_id=body.device_id, accepted=True, flags="start"))
    t.lat, t.lng, t.accuracy_m, t.speed_kmh, t.heading = fix.lat, fix.lng, fix.accuracy_m, fix.speed_kmh, fix.heading
    t.last_device_time, t.last_ping_at, t.last_source, t.device_id = fix.device_time, now, body.source, body.device_id or t.device_id
    # Planned route from the REAL start position to the remaining stops (dispatch route is kept for reference).
    pts = [Point("start", "Start", fix.lat, fix.lng)] + [Point(s.community_id, s.community.name, s.community.lat, s.community.lng) for s in trip.stops]
    geometry, dist_m, dur_s, src = route_geometry(pts)
    trip.route_geometry, trip.routing_source = geometry, src
    if src == "osrm":
        trip.distance_km, trip.duration_min = round(dist_m / 1000, 2), round(dur_s / 60, 1)
    audit(db, actor_from(request, user), "trip.start", "trip", trip.code,
          {"lat": fix.lat, "lng": fix.lng, "accuracyM": fix.accuracy_m, "deviceTime": iso(fix.device_time), "source": body.source},
          before=before, after=snapshot(trip, TRIP_FIELDS))
    notify(db, "trip_started", "info", f"{t.vehicle_number} started {trip.code}", f"Driver {user.name} is en route.", "trip", trip.code)
    db.commit()
    publish_trip(trip)
    hub.publish("vehicle.update", tracking.vehicle_view(t, ops, trip))
    return trip_view(db, trip)


@router.post("/trips/{ref}/confirm-arrival")
def confirm_arrival(ref: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    trip = get_trip(db, ref)
    require_driver_of(trip, user)
    stop = tracking.current_stop(trip)
    ops = get_setting(db, "operations")
    if trip.status == T_EN_ROUTE and stop is not None:
        t = trip.tanker
        d = round(haversine_m(t.lat, t.lng, stop.community.lat, stop.community.lng)) if t.lat is not None else None
        raise HTTPException(409, "Arrival has not been detected by GPS yet"
                            + (f": last fix is {d} m from {stop.community.name}" if d is not None else "")
                            + f" (needs ≤ {ops['geofenceRadiusM']} m for {ops['arrivalConsecutiveFixes']} consecutive fixes).")
    if trip.status != T_ARRIVED or stop is None or stop.status != STOP_ARRIVED:
        raise HTTPException(409, f"Trip is {trip.status}; nothing to confirm")
    before = snapshot(trip, TRIP_FIELDS)
    transition(trip, T_DELIVERING)
    stop.arrival_confirmed_at = utcnow()
    audit(db, actor_from(request, user), "trip.arrival_confirmed", "trip", trip.code, {"stop": stop.seq}, before=before, after=snapshot(trip, TRIP_FIELDS))
    db.commit()
    publish_trip(trip)
    return trip_view(db, trip)


def _save_image(data: bytes, content_type: str, prefix: str) -> str:
    ext = ALLOWED_IMAGE_TYPES.get(content_type or "")
    if not ext:
        raise HTTPException(415, "Image must be JPEG, PNG or WebP")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Image exceeds {settings.max_upload_mb} MB")
    if not any(data.startswith(m) for m in IMAGE_MAGIC[ext]):
        raise HTTPException(415, "File content does not match its image type")
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{prefix}_{uuid.uuid4().hex}{ext}"
    (settings.upload_dir / name).write_bytes(data)
    return name


@router.post("/trips/{ref}/deliveries", status_code=201)
async def record_delivery(
    ref: str,
    request: Request,
    delivered_amount: int = Form(..., ge=0, le=60_000, alias="deliveredAmount"),
    receiver_name: str = Form("", max_length=120, alias="receiverName"),
    receiver_phone: str = Form("", max_length=32, alias="receiverPhone"),
    notes: str = Form("", max_length=1000),
    signature: str = Form("", alias="signature"),  # data:image/png;base64,... from the on-screen pad
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(require("drive")),
):
    trip = get_trip(db, ref)
    require_driver_of(trip, user)
    stop = tracking.current_stop(trip)
    if trip.status != T_DELIVERING or stop is None or stop.status != STOP_ARRIVED or stop.arrival_confirmed_at is None:
        raise HTTPException(409, f"Delivery can be recorded only after GPS arrival is confirmed (trip is {trip.status})")
    ops = get_setting(db, "operations")
    if ops["requireReceiverName"] and not receiver_name.strip():
        raise HTTPException(422, "Receiver / authorised representative name is required")

    photo_path = None
    if photo is not None and photo.filename:
        photo_path = _save_image(await photo.read(), photo.content_type or "", "pod")
    sig_path = None
    if signature:
        if not signature.startswith("data:image/png;base64,"):
            raise HTTPException(415, "Signature must be a PNG data URL")
        try:
            sig_path = _save_image(base64.b64decode(signature.split(",", 1)[1], validate=True), "image/png", "sig")
        except ValueError:
            raise HTTPException(422, "Signature is not valid base64") from None

    t = trip.tanker
    now = utcnow()
    state, age = tracking.tracking_state(t, ops, now)
    dist = haversine_m(t.lat, t.lng, stop.community.lat, stop.community.lng) if t.lat is not None else None
    variance = stop.allocated_litres - delivered_amount
    variance_pct = 100 * abs(variance) / max(stop.allocated_litres, 1)
    flags = []
    if variance_pct > ops["varianceTolerancePct"]:
        flags.append(f"{variance:+,} L variance ({variance_pct:.1f}%)")
    if dist is None or dist > 2 * ops["geofenceRadiusM"]:
        flags.append("vehicle not at destination when delivery was recorded" if dist is not None else "no GPS position")
    if state != "live":
        flags.append(f"GPS {state} at time of recording")

    d = Delivery(trip_stop_id=stop.id, trip_id=trip.id, tanker_id=t.id, community_id=stop.community_id,
                 allocated_amount=stop.allocated_litres, delivered_amount=delivered_amount, delivered_at=now,
                 gps_lat=t.lat, gps_lng=t.lng, gps_device_time=t.last_device_time,
                 geofence_distance_m=None if dist is None else round(dist, 1), gps_verified=stop.arrived_at is not None,
                 receiver_name=receiver_name.strip(), receiver_phone=receiver_phone.strip(),
                 status=D_MISMATCH if flags else D_PENDING, variance_amount=variance,
                 notes="; ".join(flags + ([notes] if notes else [])), photo_path=photo_path, signature_path=sig_path,
                 trip_minutes=round((now - trip.started_at).total_seconds() / 60, 1) if trip.started_at else None, recorded_by=user.name)
    db.add(d)
    before = snapshot(trip, TRIP_FIELDS)
    stop.status, stop.delivered_at = STOP_DELIVERED, now
    t.current_load = max(0, t.current_load - delivered_amount)
    nxt = tracking.current_stop(trip)
    transition(trip, T_EN_ROUTE if nxt else T_DELIVERED)
    db.flush()
    audit(db, actor_from(request, user), "delivery.record", "trip", trip.code,
          {"delivery": d.code, "stop": stop.seq, "litres": delivered_amount, "receiver": receiver_name, "flags": flags},
          before=before, after=snapshot(trip, TRIP_FIELDS))
    notify(db, "delivery_recorded", "warning" if flags else "info", f"Delivery {d.code} recorded at {stop.community.name}",
           ("Flagged: " + "; ".join(flags)) if flags else "Awaiting operator verification.", "delivery", d.code)
    db.commit()
    db.refresh(d)
    publish_trip(trip)
    hub.publish("deliveries.changed", {"id": d.code, "status": d.status})
    return {"delivery": delivery_view(d), "trip": trip_view(db, trip)}


@router.post("/trips/{ref}/end")
def end_trip(ref: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require("drive"))):
    trip = get_trip(db, ref)
    require_driver_of(trip, user)
    if trip.status != T_DELIVERED:
        raise HTTPException(409, f"Trip is {trip.status}; record a delivery at every stop before ending")
    if trip.driver_ended_at:
        raise HTTPException(409, "Trip already ended by driver")
    trip.driver_ended_at = utcnow()
    audit(db, actor_from(request, user), "trip.driver_end", "trip", trip.code, after=snapshot(trip, TRIP_FIELDS))
    _maybe_complete(db, trip, actor_from(request, user))
    db.commit()
    publish_trip(trip)
    return trip_view(db, trip)


# ---------------------------------------------------------------------------
# Verification & completion
# ---------------------------------------------------------------------------
def _maybe_complete(db: Session, trip: Trip, who) -> bool:
    """Complete the trip when every stop is delivered AND verified. Backend-controlled; idempotent."""
    if trip.status != T_DELIVERED or any(s.status != STOP_VERIFIED for s in trip.stops):
        return False
    now = utcnow()
    before = snapshot(trip, TRIP_FIELDS)
    trip.verified_at = now
    transition(trip, T_COMPLETED)
    trip.completed_at = now
    trip.driver_ended_at = trip.driver_ended_at or now
    trip.distance_travelled_km = round(polyline_length_km(actual_route(db, trip.id)), 3)
    t = trip.tanker
    t.status, t.current_load = TANKER_AVAILABLE, 0
    db.execute(update(WaterRequest).where(WaterRequest.status == "Dispatched", WaterRequest.community_id.in_([s.community_id for s in trip.stops]))
               .values(status="Delivered", updated_at=now, fulfilled_at=now))
    audit(db, who, "trip.complete", "trip", trip.code, {"distanceTravelledKm": trip.distance_travelled_km},
          before=before, after=snapshot(trip, TRIP_FIELDS))
    notify(db, "trip_completed", "info", f"{trip.code} completed", f"{t.vehicle_number} is available again.", "trip", trip.code)
    hub.publish("requests.changed")
    return True


def _get_delivery(db: Session, ref: str) -> Delivery:
    try:
        did = int(ref.split("-")[-1])
        did = did - 4000 if ref.upper().startswith("DV-") else did
    except ValueError:
        raise HTTPException(404, "Delivery not found") from None
    d = db.get(Delivery, did)
    if not d:
        raise HTTPException(404, "Delivery not found")
    return d


@router.get("/deliveries")
def list_deliveries(limit: int = 500, include_synthetic: bool = False, db: Session = Depends(get_db),
                    _: User = Depends(require("view_operations"))):
    q = select(Delivery).options(joinedload(Delivery.tanker), joinedload(Delivery.community))
    if not include_synthetic:
        q = q.where(Delivery.data_origin != SYNTHETIC)
    rows = db.scalars(q.order_by(Delivery.delivered_at.desc()).limit(min(max(limit, 1), 2000)))
    return [delivery_view(d) for d in rows]


@router.post("/deliveries/{ref}/verify")
def verify_delivery(ref: str, body: DeliveryAction, request: Request, db: Session = Depends(get_db), user: User = Depends(require("verify_delivery"))):
    d = _get_delivery(db, ref)
    if d.status == D_VERIFIED:
        raise HTTPException(409, "Already verified")
    ops = get_setting(db, "operations")
    problems = []
    if ops["requireReceiverName"] and not d.receiver_name:
        problems.append("receiver name missing")
    if ops["requireProofForVerification"] and not (d.photo_path or d.signature_path):
        problems.append("photo or signature required")
    if problems:
        raise HTTPException(422, "Cannot verify: " + ", ".join(problems))
    if d.status in (D_MISMATCH, D_INVESTIGATION) and len(body.notes.strip()) < 10:
        raise HTTPException(422, "This delivery was flagged. Record how the discrepancy was resolved (min 10 characters) to verify it.")
    before = snapshot(d, ("status", "officer_verified", "verified_by"))
    now = utcnow()
    d.officer_verified, d.verified_by, d.verified_at, d.status = True, user.name, now, D_VERIFIED
    d.verification_notes = body.notes
    stop = db.get(TripStop, d.trip_stop_id) if d.trip_stop_id else None
    if stop and stop.status == STOP_DELIVERED:
        stop.status, stop.verified_at = STOP_VERIFIED, now
    who = actor_from(request, user)
    audit(db, who, "delivery.verify", "delivery", d.code, {"notes": body.notes}, before=before, after=snapshot(d, ("status", "officer_verified", "verified_by")))
    completed = False
    if stop:
        trip = stop.trip
        audit(db, who, "trip.stop_verified", "trip", trip.code, {"delivery": d.code, "stop": stop.seq})
        completed = _maybe_complete(db, trip, who)
    db.commit()
    hub.publish("deliveries.changed", {"id": d.code})
    if stop:
        publish_trip(stop.trip)
    return {**delivery_view(d), "tripCompleted": completed}


@router.post("/deliveries/{ref}/investigate")
def investigate_delivery(ref: str, body: DeliveryAction, request: Request, db: Session = Depends(get_db), user: User = Depends(require("verify_delivery"))):
    d = _get_delivery(db, ref)
    if d.status == D_VERIFIED:
        raise HTTPException(409, "Verified deliveries cannot be reopened")
    before = snapshot(d, ("status",))
    d.status = D_INVESTIGATION
    d.notes = (d.notes + "; " if d.notes else "") + f"Investigation opened by {user.name}" + (f": {body.notes}" if body.notes else "")
    audit(db, actor_from(request, user), "delivery.investigate", "delivery", d.code, {"notes": body.notes}, before=before, after=snapshot(d, ("status",)))
    db.commit()
    hub.publish("deliveries.changed", {"id": d.code})
    return delivery_view(d)


@router.get("/deliveries/{ref}/{kind}")
def delivery_file(ref: str, kind: str, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    if kind not in ("photo", "signature"):
        raise HTTPException(404, "Unknown file")
    d = _get_delivery(db, ref)
    name = d.photo_path if kind == "photo" else d.signature_path
    if not name:
        raise HTTPException(404, f"No {kind}")
    path = (settings.upload_dir / Path(name).name).resolve()
    if not path.is_file() or settings.upload_dir.resolve() not in path.parents:
        raise HTTPException(404, "File missing")
    return FileResponse(path)
