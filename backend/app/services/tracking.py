"""Real vehicle telemetry: validation, storage, arrival detection, route deviation, anomalies, liveness.

Rules (non-negotiable):
* A vehicle's position only ever comes from an accepted telemetry fix. No interpolation, no defaults.
* Liveness (LIVE / STALE / OFFLINE) is derived from real timestamps only.
* Arrival is declared only from consecutive GPS fixes inside the destination geofence.
* Rejected or suspicious fixes are kept (or recorded as anomalies), never silently dropped.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import (
    SOURCE_LABELS, STOP_ARRIVED, STOP_PENDING, T_ARRIVED, T_EN_ROUTE, TRIP_MOVING, TRIP_OPEN, TRIP_TELEMETRY_OK,
)
from ..models import Anomaly, Telemetry, Tanker, Trip, TripStop, User, utcnow
from .common import audit, get_setting, haversine_m
from .geo import bearing_label, distance_to_polyline_m
from .notify import notify
from .realtime import hub

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Liveness
# ---------------------------------------------------------------------------
def tracking_state(tanker: Tanker, ops: dict, now: datetime | None = None) -> tuple[str, float | None]:
    """('live'|'stale'|'offline'|'no_signal', age_seconds). Age uses the OLDER of device fix time and receipt time,
    so a delayed batch or a fast device clock can never make a vehicle look fresher than it is."""
    if tanker.last_ping_at is None or tanker.lat is None:
        return "no_signal", None
    now = now or utcnow()
    ref = min(tanker.last_ping_at, tanker.last_device_time or tanker.last_ping_at)
    age = max(0.0, (now - ref).total_seconds())
    if age <= ops["liveSeconds"]:
        return "live", age
    if age <= ops["offlineSeconds"]:
        return "stale", age
    return "offline", age


def active_trip(db: Session, tanker_id: str, statuses=TRIP_OPEN) -> Trip | None:
    return db.scalar(select(Trip).where(Trip.tanker_id == tanker_id, Trip.status.in_(statuses)).order_by(Trip.created_at.desc()))


def current_stop(trip: Trip) -> TripStop | None:
    for s in trip.stops:
        if s.status in (STOP_PENDING, STOP_ARRIVED):
            return s
    return None


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def vehicle_view(tanker: Tanker, ops: dict, trip: Trip | None, now: datetime | None = None) -> dict:
    now = now or utcnow()
    state, age = tracking_state(tanker, ops, now)
    stop = current_stop(trip) if trip else None
    dist_to_dest = None
    if stop and tanker.lat is not None:
        dist_to_dest = round(haversine_m(tanker.lat, tanker.lng, stop.community.lat, stop.community.lng))
    return {
        "vehicleId": tanker.id,
        "registration": tanker.vehicle_number,
        "status": tanker.status,
        "driverName": tanker.driver_name,
        "driverUserId": tanker.driver_user_id,
        "trackingSource": tanker.tracking_source,
        "position": None if tanker.lat is None else {
            "lat": tanker.lat, "lng": tanker.lng, "accuracyM": tanker.accuracy_m,
            "speedKmh": None if tanker.speed_kmh is None else round(tanker.speed_kmh, 1),
            "heading": tanker.heading, "headingLabel": bearing_label(tanker.heading),
            "deviceTime": iso(tanker.last_device_time), "receivedAt": iso(tanker.last_ping_at),
            "source": tanker.last_source, "sourceLabel": SOURCE_LABELS.get(tanker.last_source or "", tanker.last_source),
        },
        "trackingState": state,
        "ageSeconds": None if age is None else round(age),
        "trip": None if trip is None else {
            "id": trip.code, "dbId": trip.id, "status": trip.status,
            "destination": stop.community.name if stop else None,
            "destinationId": stop.community_id if stop else None,
            "destinationLat": stop.community.lat if stop else None,
            "destinationLng": stop.community.lng if stop else None,
            "stopSeq": stop.seq if stop else None,
            "distanceToDestinationM": dist_to_dest,  # straight-line from the real last fix
        },
    }


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------
@dataclass
class Fix:
    lat: float
    lng: float
    device_time: datetime  # naive UTC
    accuracy_m: float | None = None
    speed_kmh: float | None = None
    heading: float | None = None


@dataclass
class IngestResult:
    accepted: int = 0
    duplicates: int = 0
    flagged: int = 0
    rejected: list[dict] = field(default_factory=list)
    arrived_stop: str | None = None
    trip_status: str | None = None


def _finite(*vals) -> bool:
    return all(v is None or (isinstance(v, (int, float)) and math.isfinite(v)) for v in vals)


def _validate(f: Fix, ops: dict, now: datetime, trip: Trip) -> str | None:
    if not _finite(f.lat, f.lng, f.accuracy_m, f.speed_kmh, f.heading):
        return "non_numeric"
    if not (-90 <= f.lat <= 90 and -180 <= f.lng <= 180):
        return "coordinates_out_of_range"
    if abs(f.lat) < 1e-6 and abs(f.lng) < 1e-6:
        return "null_island"
    if f.accuracy_m is not None and not (0 <= f.accuracy_m <= 100_000):
        return "invalid_accuracy"
    if f.speed_kmh is not None and not (0 <= f.speed_kmh <= 400):
        return "invalid_speed"
    if f.heading is not None and not (0 <= f.heading <= 360):
        return "invalid_heading"
    if f.device_time > now + timedelta(seconds=ops["maxClockSkewSeconds"]):
        return "timestamp_in_future"
    if f.device_time < now - timedelta(hours=ops["maxBufferedAgeHours"]):
        return "timestamp_too_old"
    if trip.started_at and f.device_time < trip.started_at - timedelta(seconds=ops["maxClockSkewSeconds"]):
        return "before_trip_start"
    return None


def authorize_vehicle(db: Session, user: User, vehicle_id: str) -> tuple[Tanker, Trip]:
    tanker = db.get(Tanker, vehicle_id)
    if tanker is None:
        raise HTTPException(404, "Unknown vehicle")
    if user.role != "driver":
        raise HTTPException(403, "Telemetry must come from the assigned driver's device")
    trip = active_trip(db, tanker.id, TRIP_TELEMETRY_OK)
    if trip is None:
        raise HTTPException(409, "No started trip for this vehicle. Telemetry is accepted only after START TRIP.")
    if trip.driver_user_id != user.id:
        raise HTTPException(403, "You are not the driver assigned to this vehicle's trip")
    if trip.driver_ended_at is not None:
        raise HTTPException(409, "Trip already ended by the driver; telemetry closed")
    return tanker, trip


def ingest(db: Session, user: User, vehicle_id: str, trip_code: str | None, source: str, device_id: str | None,
           fixes: list[Fix]) -> IngestResult:
    tanker, trip = authorize_vehicle(db, user, vehicle_id)
    if trip_code and trip_code != trip.code:
        raise HTTPException(409, f"Telemetry is for {trip_code} but the vehicle's active trip is {trip.code}")
    ops = get_setting(db, "operations")
    now = utcnow()
    res = IngestResult()

    prev = db.scalar(select(Telemetry).where(Telemetry.vehicle_id == tanker.id, Telemetry.accepted.is_(True))
                     .order_by(Telemetry.device_time.desc()))
    seen_times = set()
    invalid_logged = False

    for idx, f in sorted(enumerate(fixes), key=lambda p: p[1].device_time):
        reason = _validate(f, ops, now, trip)
        if reason:
            res.rejected.append({"index": idx, "reason": reason})
            if not invalid_logged and reason in ("coordinates_out_of_range", "null_island", "non_numeric"):
                invalid_logged = True
                db.add(Anomaly(kind="invalid_fix", vehicle_id=tanker.id, trip_id=trip.id, details={"reason": reason, "deviceTime": iso(f.device_time)}))
            continue
        if f.device_time in seen_times or db.scalar(select(Telemetry.id).where(Telemetry.vehicle_id == tanker.id, Telemetry.device_time == f.device_time)):
            res.duplicates += 1
            continue
        seen_times.add(f.device_time)

        flags: list[str] = []
        accepted = True
        speed = f.speed_kmh
        if prev is not None and f.device_time > prev.device_time:
            dt = (f.device_time - prev.device_time).total_seconds()
            dist = haversine_m(prev.lat, prev.lng, f.lat, f.lng)
            tolerance = 2 * ((f.accuracy_m or 0) + (prev.accuracy_m or 0))
            implied = dist / dt * 3.6 if dt > 0 else 0
            if implied > ops["maxPlausibleSpeedKmh"] and dist > max(500.0, tolerance):
                accepted = False
                flags.append("jump")
                db.add(Anomaly(kind="gps_jump", vehicle_id=tanker.id, trip_id=trip.id, lat=f.lat, lng=f.lng, value=round(implied),
                               details={"fromLat": prev.lat, "fromLng": prev.lng, "metres": round(dist), "seconds": dt}))
                notify(db, "gps_jump", "warning", f"GPS jump rejected: {tanker.vehicle_number}",
                       f"Implied speed {round(implied)} km/h over {round(dist)} m. Position not updated.", "vehicle", tanker.id)
            elif speed is None and dt >= 3:
                speed = implied  # derived from two real fixes
        if f.accuracy_m is not None and f.accuracy_m > ops["lowAccuracyM"]:
            flags.append("low_accuracy")
        if tanker.last_device_time and f.device_time < tanker.last_device_time:
            flags.append("out_of_order")
        if (now - f.device_time).total_seconds() > 30:
            flags.append("buffered")

        row = Telemetry(vehicle_id=tanker.id, driver_user_id=user.id, trip_id=trip.id, lat=f.lat, lng=f.lng, accuracy_m=f.accuracy_m,
                        speed_kmh=speed, heading=f.heading, device_time=f.device_time, received_at=now, source=source,
                        device_id=device_id, accepted=accepted, flags=",".join(flags))
        db.add(row)
        if flags:
            res.flagged += 1
        if not accepted:
            continue
        res.accepted += 1
        prev = row
        if "out_of_order" in flags:
            continue  # history only; the live position never moves backwards in time

        tanker.lat, tanker.lng, tanker.accuracy_m = f.lat, f.lng, f.accuracy_m
        tanker.speed_kmh, tanker.heading = speed, f.heading
        tanker.last_device_time, tanker.last_ping_at, tanker.last_source = f.device_time, now, source
        if device_id:
            tanker.device_id = device_id
        _evaluate(db, tanker, trip, f, ops, res)

    _resolve_open(db, trip, "telemetry_stale", now)
    db.commit()
    res.trip_status = trip.status
    _broadcast_vehicle(db, tanker, trip, ops)
    if res.arrived_stop:
        hub.publish("trip.changed", {"id": trip.code, "status": trip.status})
    return res


def _evaluate(db: Session, tanker: Tanker, trip: Trip, f: Fix, ops: dict, res: IngestResult) -> None:
    """Arrival and route-deviation checks for one accepted, in-order fix."""
    stop = current_stop(trip)
    good_fix = f.accuracy_m is None or f.accuracy_m <= ops["arrivalMaxAccuracyM"]
    radius = ops["geofenceRadiusM"]

    if stop is not None and trip.status == T_EN_ROUTE and stop.status == STOP_PENDING:
        d = haversine_m(f.lat, f.lng, stop.community.lat, stop.community.lng)
        if good_fix and d <= radius:
            stop.inside_streak += 1
        else:
            stop.inside_streak = 0
        if stop.inside_streak >= ops["arrivalConsecutiveFixes"]:
            stop.status, stop.arrived_at, stop.arrival_distance_m = STOP_ARRIVED, f.device_time, round(d, 1)
            trip.status = T_ARRIVED
            trip.arrived_at = trip.arrived_at or f.device_time
            res.arrived_stop = stop.community.name
            audit(db, None, "trip.arrival_detected", "trip", trip.code,
                  {"stop": stop.seq, "community": stop.community_id, "distanceM": round(d, 1), "accuracyM": f.accuracy_m,
                   "consecutiveFixes": stop.inside_streak, "radiusM": radius})
            notify(db, "arrival", "info", f"{tanker.vehicle_number} arrived at {stop.community.name}",
                   f"GPS within {round(d)} m of the destination ({stop.inside_streak} consecutive fixes).", "trip", trip.code)

    # Route deviation (only while driving, only with a planned route, not on the final approach)
    if trip.status != T_EN_ROUTE or not trip.route_geometry or not good_fix:
        return
    if stop is not None and haversine_m(f.lat, f.lng, stop.community.lat, stop.community.lng) < 3 * radius:
        return
    off = distance_to_polyline_m(f.lat, f.lng, trip.route_geometry)
    if off is None:
        return
    if off > ops["deviationThresholdM"] + (f.accuracy_m or 0):
        trip.deviation_streak += 1
        if trip.deviation_streak >= ops["deviationConsecutiveFixes"] and trip.open_deviation_id is None:
            a = Anomaly(kind="route_deviation", vehicle_id=tanker.id, trip_id=trip.id, lat=f.lat, lng=f.lng, value=round(off),
                        details={"thresholdM": ops["deviationThresholdM"], "deviceTime": iso(f.device_time)})
            db.add(a)
            db.flush()
            trip.open_deviation_id = a.id
            notify(db, "route_deviation", "warning", f"Route deviation: {tanker.vehicle_number}",
                   f"{round(off)} m from the planned route on {trip.code}. Not necessarily wrongdoing; check with the driver.",
                   "trip", trip.code)
    else:
        trip.deviation_streak = 0
        if trip.open_deviation_id is not None:
            a = db.get(Anomaly, trip.open_deviation_id)
            if a and a.status != "resolved":
                a.status, a.resolved_at = "resolved", utcnow()
            trip.open_deviation_id = None


def _resolve_open(db: Session, trip: Trip, kind: str, now: datetime) -> None:
    for a in db.scalars(select(Anomaly).where(Anomaly.trip_id == trip.id, Anomaly.kind == kind, Anomaly.status != "resolved")):
        a.status, a.resolved_at = "resolved", now


def _broadcast_vehicle(db: Session, tanker: Tanker, trip: Trip | None, ops: dict) -> None:
    hub.publish("vehicle.update", vehicle_view(tanker, ops, trip))


# ---------------------------------------------------------------------------
# Periodic sweep (stale / offline / prolonged stop) — runs in the background job loop
# ---------------------------------------------------------------------------
_last_state: dict[str, str] = {}


def sweep(db: Session) -> None:
    ops = get_setting(db, "operations")
    now = utcnow()
    for tanker in db.scalars(select(Tanker)):
        trip = active_trip(db, tanker.id)
        state, age = tracking_state(tanker, ops, now)
        if _last_state.get(tanker.id) != state:
            _last_state[tanker.id] = state
            _broadcast_vehicle(db, tanker, trip, ops)  # badge changes even though no new position arrived
        if trip is None or trip.status not in TRIP_MOVING:
            continue
        if state in ("offline", "no_signal") and trip.started_at and (now - trip.started_at).total_seconds() > ops["offlineSeconds"]:
            exists = db.scalar(select(Anomaly.id).where(Anomaly.trip_id == trip.id, Anomaly.kind == "telemetry_stale", Anomaly.status != "resolved"))
            if not exists:
                db.add(Anomaly(kind="telemetry_stale", vehicle_id=tanker.id, trip_id=trip.id, lat=tanker.lat, lng=tanker.lng,
                               value=None if age is None else round(age), details={"lastFix": iso(tanker.last_device_time)}))
                notify(db, "vehicle_offline", "warning", f"{tanker.vehicle_number} offline",
                       f"No GPS fix for {round((age or 0) / 60)} min during {trip.code}. Last known position kept; marker frozen.",
                       "vehicle", tanker.id, dedupe_key=f"offline:{trip.id}:{tanker.last_device_time}")
        _check_prolonged_stop(db, tanker, trip, ops, now)
    db.commit()


def _check_prolonged_stop(db: Session, tanker: Tanker, trip: Trip, ops: dict, now: datetime) -> None:
    if trip.status != T_EN_ROUTE or tanker.lat is None:
        return
    window = now - timedelta(minutes=ops["prolongedStopMinutes"])
    if not trip.started_at or trip.started_at > window:
        return
    pts = db.execute(select(Telemetry.lat, Telemetry.lng).where(Telemetry.trip_id == trip.id, Telemetry.accepted.is_(True),
                                                                 Telemetry.device_time >= window)).all()
    if len(pts) < 3:
        return  # not enough evidence (could be offline; that is reported separately)
    if max(haversine_m(pts[0][0], pts[0][1], p[0], p[1]) for p in pts) > 75:
        return
    stop = current_stop(trip)
    if stop and haversine_m(tanker.lat, tanker.lng, stop.community.lat, stop.community.lng) < 3 * ops["geofenceRadiusM"]:
        return
    exists = db.scalar(select(Anomaly.id).where(Anomaly.trip_id == trip.id, Anomaly.kind == "prolonged_stop", Anomaly.status == "open"))
    if not exists:
        db.add(Anomaly(kind="prolonged_stop", vehicle_id=tanker.id, trip_id=trip.id, lat=tanker.lat, lng=tanker.lng,
                       value=ops["prolongedStopMinutes"], details={"fixes": len(pts)}))
        notify(db, "prolonged_stop", "info", f"{tanker.vehicle_number} stationary {ops['prolongedStopMinutes']}+ min",
               f"Stopped away from any delivery point during {trip.code}.", "trip", trip.code)
