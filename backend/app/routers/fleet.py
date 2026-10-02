from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from ..config import get_settings
from ..db import get_db
from ..models import Community, Delivery, Depot, GpsPing, Tanker, Trip, TripStop, User, WaterRequest, utcnow
from ..schemas import DeliveryAction, DispatchIn, PingIn, RouteOptimizeIn, TankerIn, TankerUpdate
from ..security import admin_only, any_user, require_roles, staff
from ..services.common import audit, get_setting, haversine_m
from ..services.realtime import hub
from ..services.routing import Point, optimise_route
from ..services.views import community_views, delivery_view, tanker_views, trip_view

router = APIRouter(tags=["fleet, routing & delivery"])
settings = get_settings()
driver_or_staff = require_roles("admin", "officer", "driver")

ALLOWED_PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


# ---------------------------------------------------------------------------
# Tankers
# ---------------------------------------------------------------------------
@router.get("/tankers")
def list_tankers(db: Session = Depends(get_db), _: User = Depends(any_user)):
    return tanker_views(db)


@router.post("/tankers", status_code=201)
def create_tanker(body: TankerIn, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.get(Tanker, body.id):
        raise HTTPException(409, "Tanker id already exists")
    depot_id = body.depot_id or db.scalar(select(Depot.id))
    t = Tanker(**body.model_dump(exclude={"depot_id"}), depot_id=depot_id)
    if t.depot_id:
        d = db.get(Depot, t.depot_id)
        t.lat, t.lng = d.lat, d.lng
    db.add(t)
    audit(db, admin, "tanker.create", "tanker", t.id)
    db.commit()
    hub.publish("tankers.changed")
    return next(v for v in tanker_views(db) if v["id"] == t.id)


@router.patch("/tankers/{tanker_id}")
def update_tanker(tanker_id: str, body: TankerUpdate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    t = db.get(Tanker, tanker_id)
    if not t:
        raise HTTPException(404, "Tanker not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    audit(db, admin, "tanker.update", "tanker", t.id, data)
    db.commit()
    hub.publish("tankers.changed")
    return next(v for v in tanker_views(db) if v["id"] == t.id)


# ---------------------------------------------------------------------------
# Route optimisation & dispatch
# ---------------------------------------------------------------------------
def _plan_route(db: Session, body: RouteOptimizeIn):
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

    # Litres per stop: explicit, else split tanker capacity in proportion to each stop's shortfall.
    if body.litres:
        litres = {i: int(body.litres.get(i, 0)) for i in ids}
    else:
        need = {i: max(views[i]["shortfall"], 1) for i in ids}
        tot = sum(need.values())
        litres = {i: int(tanker.capacity * need[i] / tot // 100 * 100) for i in ids}
    if sum(litres.values()) > tanker.capacity:
        raise HTTPException(400, f"Stops need {sum(litres.values()):,} L but {tanker.id} carries {tanker.capacity:,} L")

    ops = get_setting(db, "operations")
    stops = [Point(i, views[i]["name"], views[i]["lat"], views[i]["lng"], views[i]["priorityScore"] / 100) for i in ids]
    plan = optimise_route(Point("depot", depot.name, depot.lat, depot.lng), stops, ops["fallbackSpeedKmh"], ops["roadCircuityFactor"])

    def fuel(km):
        return km / ops["tankerKmPerLitre"]

    saved_km = round(plan.baseline_distance_km - plan.distance_km, 2)
    result = {
        "tankerId": tanker.id,
        "vehicleNumber": tanker.vehicle_number,
        "depot": {"name": depot.name, "lat": depot.lat, "lng": depot.lng},
        "stops": [s.name for s in stops],
        "recommendedSequence": [s.name for s in plan.sequence],
        "sequence": [{"communityId": s.key, "name": s.name, "lat": s.lat, "lng": s.lng,
                      "priorityScore": views[s.key]["priorityScore"], "litres": litres[s.key]} for s in plan.sequence],
        "distanceBeforeKm": plan.baseline_distance_km,
        "distanceAfterKm": plan.distance_km,
        "distanceSavedKm": saved_km,
        "timeBeforeMin": plan.baseline_duration_min,
        "timeAfterMin": plan.duration_min,
        "timeSavedMin": round(plan.baseline_duration_min - plan.duration_min, 1),
        "fuelLitresAfter": round(fuel(plan.distance_km), 2),
        "fuelSavedInr": round(fuel(saved_km) * ops["dieselPricePerLitre"]),
        "co2SavedKg": round(fuel(saved_km) * ops["co2KgPerLitreDiesel"], 2),
        "routeGeometry": plan.geometry,
        "routingSource": plan.source,
        "assumptions": {
            "dieselPricePerLitre": ops["dieselPricePerLitre"],
            "tankerKmPerLitre": ops["tankerKmPerLitre"],
            "baseline": "stops in the order entered, depot -> stops -> depot",
        },
    }
    return tanker, plan, litres, result


@router.post("/routes/optimize")
def optimize(body: RouteOptimizeIn, db: Session = Depends(get_db), _: User = Depends(staff)):
    return _plan_route(db, body)[3]


@router.post("/trips", status_code=201)
def dispatch(body: DispatchIn, db: Session = Depends(get_db), user: User = Depends(staff)):
    tanker, plan, litres, result = _plan_route(db, body)
    if tanker.status == "Maintenance":
        raise HTTPException(409, f"{tanker.id} is under maintenance")
    if db.scalar(select(Trip).where(Trip.tanker_id == tanker.id, Trip.status.in_(("Planned", "En Route")))):
        raise HTTPException(409, f"{tanker.id} already has an active trip")
    now = utcnow()
    trip = Trip(
        tanker_id=tanker.id, status="En Route", route_geometry=plan.geometry,
        distance_km=plan.distance_km, duration_min=plan.duration_min,
        baseline_distance_km=plan.baseline_distance_km, baseline_duration_min=plan.baseline_duration_min,
        routing_source=plan.source, created_by=user.id, started_at=now,
    )
    for seq, p in enumerate(plan.sequence, start=1):
        trip.stops.append(TripStop(seq=seq, community_id=p.key, allocated_litres=litres[p.key]))
    db.add(trip)
    tanker.status, tanker.current_load = "En Route", sum(litres.values())
    if tanker.lat is None and tanker.depot:
        tanker.lat, tanker.lng = tanker.depot.lat, tanker.depot.lng
    db.execute(update(WaterRequest).where(WaterRequest.status == "Allocated", WaterRequest.community_id.in_(list(litres)))
               .values(status="Dispatched", updated_at=now))
    db.flush()
    audit(db, user, "trip.dispatch", "trip", trip.code, {"tanker": tanker.id, "stops": [p.key for p in plan.sequence], "km": plan.distance_km})
    db.commit()
    hub.publish("tankers.changed")
    hub.publish("requests.changed")
    return {**trip_view(trip), "optimization": result}


@router.get("/trips")
def list_trips(active: bool = False, db: Session = Depends(get_db), _: User = Depends(any_user)):
    q = select(Trip).options(joinedload(Trip.tanker)).order_by(Trip.created_at.desc()).limit(200)
    if active:
        q = q.where(Trip.status.in_(("Planned", "En Route")))
    return [trip_view(t) for t in db.scalars(q).unique()]


@router.post("/trips/{trip_id}/cancel")
def cancel_trip(trip_id: int, db: Session = Depends(get_db), user: User = Depends(staff)):
    trip = db.get(Trip, trip_id)
    if not trip or trip.status in ("Completed", "Cancelled"):
        raise HTTPException(404, "Active trip not found")
    trip.status, trip.completed_at = "Cancelled", utcnow()
    if trip.tanker.status == "En Route":
        trip.tanker.status = "Idle"
    audit(db, user, "trip.cancel", "trip", trip.code)
    db.commit()
    hub.publish("tankers.changed")
    return trip_view(trip)


@router.get("/driver/trip")
def driver_trip(db: Session = Depends(get_db), user: User = Depends(require_roles("driver"))):
    tanker = db.scalar(select(Tanker).where(Tanker.driver_user_id == user.id))
    if not tanker:
        raise HTTPException(404, "No tanker is assigned to your account")
    trip = db.scalar(select(Trip).where(Trip.tanker_id == tanker.id, Trip.status.in_(("Planned", "En Route"))).order_by(Trip.created_at.desc()))
    return {"tanker": next(v for v in tanker_views(db) if v["id"] == tanker.id), "trip": trip_view(trip) if trip else None}


# ---------------------------------------------------------------------------
# Live GPS
# ---------------------------------------------------------------------------
def _resolve_tanker(db: Session, user: User, tanker_id: str | None) -> Tanker:
    if user.role == "driver":
        t = db.scalar(select(Tanker).where(Tanker.driver_user_id == user.id))
        if not t:
            raise HTTPException(403, "No tanker assigned to this driver")
        return t
    if not tanker_id:
        raise HTTPException(400, "tankerId required")
    t = db.get(Tanker, tanker_id)
    if not t:
        raise HTTPException(404, "Tanker not found")
    return t


@router.post("/tracking/ping")
def ping(body: PingIn, db: Session = Depends(get_db), user: User = Depends(driver_or_staff)):
    t = _resolve_tanker(db, user, body.tanker_id)
    now = utcnow()
    speed = body.speed_kmh
    if speed is None and t.lat is not None and t.last_ping_at:
        dt_h = max((now - t.last_ping_at).total_seconds(), 1) / 3600
        speed = min(120.0, haversine_m(t.lat, t.lng, body.lat, body.lng) / 1000 / dt_h)
    t.lat, t.lng, t.heading, t.last_ping_at = body.lat, body.lng, body.heading, now
    t.speed_kmh = round(speed or 0.0, 1)
    db.add(GpsPing(tanker_id=t.id, lat=body.lat, lng=body.lng, speed_kmh=t.speed_kmh, heading=body.heading, accuracy_m=body.accuracy_m))
    db.commit()
    hub.publish("tanker.position", {"id": t.id, "lat": t.lat, "lng": t.lng, "speedKmH": t.speed_kmh, "heading": t.heading})
    return {"ok": True}


@router.get("/tracking/{tanker_id}/trail")
def trail(tanker_id: str, limit: int = 300, db: Session = Depends(get_db), _: User = Depends(any_user)):
    rows = db.scalars(select(GpsPing).where(GpsPing.tanker_id == tanker_id).order_by(GpsPing.recorded_at.desc()).limit(min(limit, 2000)))
    return [[p.lat, p.lng] for p in reversed(list(rows))]


# ---------------------------------------------------------------------------
# Proof of delivery
# ---------------------------------------------------------------------------
@router.get("/deliveries")
def list_deliveries(db: Session = Depends(get_db), _: User = Depends(any_user)):
    rows = db.scalars(select(Delivery).options(joinedload(Delivery.tanker), joinedload(Delivery.community)).order_by(Delivery.delivered_at.desc()).limit(1000))
    return [delivery_view(d) for d in rows]


@router.post("/deliveries", status_code=201)
async def record_delivery(
    trip_stop_id: int = Form(..., alias="tripStopId"),
    delivered_amount: int = Form(..., ge=0, le=60_000, alias="deliveredAmount"),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    notes: str = Form("", max_length=1000),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(driver_or_staff),
):
    stop = db.get(TripStop, trip_stop_id)
    if not stop or stop.trip.status not in ("Planned", "En Route"):
        raise HTTPException(404, "Stop not found on an active trip")
    if stop.status != "Pending":
        raise HTTPException(409, "Delivery already recorded for this stop")
    tanker = stop.trip.tanker
    if user.role == "driver" and tanker.driver_user_id != user.id:
        raise HTTPException(403, "This stop belongs to another tanker")

    photo_path = None
    if photo is not None and photo.filename:
        ext = ALLOWED_PHOTO_TYPES.get(photo.content_type or "")
        if not ext:
            raise HTTPException(415, "Photo must be JPEG, PNG or WebP")
        data = await photo.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"Photo exceeds {settings.max_upload_mb} MB")
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        name = f"pod_{uuid.uuid4().hex}{ext}"
        (settings.upload_dir / name).write_bytes(data)
        photo_path = name

    ops = get_setting(db, "operations")
    plat, plng = (lat, lng) if lat is not None and lng is not None else (tanker.lat, tanker.lng)
    community = stop.community
    dist = haversine_m(plat, plng, community.lat, community.lng) if plat is not None else None
    gps_ok = dist is not None and dist <= ops["geofenceRadiusM"]
    variance = stop.allocated_litres - delivered_amount
    variance_pct = 100 * abs(variance) / max(stop.allocated_litres, 1)

    flags = []
    if not gps_ok:
        flags.append("outside geofence" if dist is not None else "no GPS fix")
    if variance_pct > ops["varianceTolerancePct"]:
        flags.append(f"{variance:+,} L variance ({variance_pct:.1f}%)")
    now = utcnow()
    d = Delivery(
        trip_stop_id=stop.id, tanker_id=tanker.id, community_id=community.id,
        allocated_amount=stop.allocated_litres, delivered_amount=delivered_amount, delivered_at=now,
        gps_lat=plat, gps_lng=plng, geofence_distance_m=dist, gps_verified=gps_ok,
        status="Mismatch" if flags else "Pending Verification", variance_amount=variance,
        notes="; ".join([*flags, notes] if notes else flags), photo_path=photo_path,
        trip_minutes=round((now - stop.trip.started_at).total_seconds() / 60, 1) if stop.trip.started_at else None,
        recorded_by=user.name,
    )
    db.add(d)
    stop.status = "Delivered"
    tanker.current_load = max(0, tanker.current_load - delivered_amount)

    trip = stop.trip
    if all(s.status != "Pending" for s in trip.stops):
        trip.status, trip.completed_at = "Completed", now
        tanker.status = "Idle"
        db.execute(update(WaterRequest).where(WaterRequest.status == "Dispatched", WaterRequest.community_id.in_([s.community_id for s in trip.stops]))
                   .values(status="Delivered", updated_at=now))
    db.flush()
    audit(db, user, "delivery.record", "delivery", d.code, {"stop": stop.id, "delivered": delivered_amount, "flags": flags})
    db.commit()
    db.refresh(d)
    hub.publish("deliveries.changed", {"id": d.code, "status": d.status})
    hub.publish("tankers.changed")
    return delivery_view(d)


def _get_delivery(db: Session, delivery_id: str) -> Delivery:
    try:
        did = int(delivery_id.split("-")[-1])
        did = did - 4000 if delivery_id.upper().startswith("DV-") else did
    except ValueError:
        raise HTTPException(404, "Delivery not found") from None
    d = db.get(Delivery, did)
    if not d:
        raise HTTPException(404, "Delivery not found")
    return d


@router.post("/deliveries/{delivery_id}/verify")
def verify_delivery(delivery_id: str, body: DeliveryAction, db: Session = Depends(get_db), user: User = Depends(staff)):
    d = _get_delivery(db, delivery_id)
    d.officer_verified, d.verified_by, d.status = True, user.name, "Verified"
    if body.notes:
        d.notes = (d.notes + "; " if d.notes else "") + f"Officer: {body.notes}"
    audit(db, user, "delivery.verify", "delivery", d.code, {"notes": body.notes})
    db.commit()
    hub.publish("deliveries.changed", {"id": d.code})
    return delivery_view(d)


@router.post("/deliveries/{delivery_id}/investigate")
def investigate_delivery(delivery_id: str, body: DeliveryAction, db: Session = Depends(get_db), user: User = Depends(staff)):
    d = _get_delivery(db, delivery_id)
    d.status = "Under Investigation"
    d.notes = (d.notes + "; " if d.notes else "") + f"Investigation opened by {user.name}" + (f": {body.notes}" if body.notes else "")
    audit(db, user, "delivery.investigate", "delivery", d.code, {"notes": body.notes})
    db.commit()
    hub.publish("deliveries.changed", {"id": d.code})
    return delivery_view(d)


@router.get("/deliveries/{delivery_id}/photo")
def delivery_photo(delivery_id: str, db: Session = Depends(get_db), _: User = Depends(any_user)):
    d = _get_delivery(db, delivery_id)
    if not d.photo_path:
        raise HTTPException(404, "No photo")
    path = (settings.upload_dir / Path(d.photo_path).name).resolve()
    if not path.is_file() or settings.upload_dir.resolve() not in path.parents:
        raise HTTPException(404, "Photo missing")
    return FileResponse(path)
