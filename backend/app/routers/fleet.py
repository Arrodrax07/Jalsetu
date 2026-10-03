"""Vehicle and depot master data. Trips, telemetry and deliveries live in trips.py / tracking.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import TANKER_AVAILABLE
from ..models import Depot, Tanker, User
from ..schemas import DepotIn, TankerIn, TankerUpdate
from ..security import actor_from, require
from ..services.common import audit, snapshot
from ..services.realtime import hub
from ..services.views import depot_view, tanker_views

router = APIRouter(tags=["fleet"])
TANKER_FIELDS = ("status", "capacity", "driver_user_id", "depot_id", "tracking_source", "vehicle_number")


@router.get("/tankers")
def list_tankers(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    return tanker_views(db)


@router.post("/tankers", status_code=201)
def create_tanker(body: TankerIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_master_data"))):
    if db.get(Tanker, body.id):
        raise HTTPException(409, "Vehicle id already exists")
    if db.scalar(select(Tanker).where(Tanker.vehicle_number == body.vehicle_number)):
        raise HTTPException(409, "Registration already exists")
    t = Tanker(**body.model_dump(exclude={"depot_id"}), depot_id=body.depot_id or db.scalar(select(Depot.id)),
               status=TANKER_AVAILABLE, data_origin="manual")
    db.add(t)
    audit(db, actor_from(request, admin), "tanker.create", "tanker", t.id, after=snapshot(t, TANKER_FIELDS))
    db.commit()
    hub.publish("tankers.changed")
    return next(v for v in tanker_views(db) if v["id"] == t.id)


@router.patch("/tankers/{tanker_id}")
def update_tanker(tanker_id: str, body: TankerUpdate, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_master_data"))):
    t = db.get(Tanker, tanker_id)
    if not t:
        raise HTTPException(404, "Tanker not found")
    before = snapshot(t, TANKER_FIELDS)
    data = body.model_dump(exclude_unset=True)
    if "driver_user_id" in data and data["driver_user_id"] is not None:
        d = db.get(User, data["driver_user_id"])
        if not d or d.role != "driver":
            raise HTTPException(400, "Default driver must be a driver account")
        t.driver_name, t.driver_phone = d.name, d.phone
    for k, v in data.items():
        setattr(t, k, v)
    audit(db, actor_from(request, admin), "tanker.update", "tanker", t.id, data, before=before, after=snapshot(t, TANKER_FIELDS))
    db.commit()
    hub.publish("tankers.changed")
    return next(v for v in tanker_views(db) if v["id"] == t.id)


@router.get("/depots")
def list_depots(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    return [depot_view(d) for d in db.scalars(select(Depot).where(Depot.is_active.is_(True)))]


@router.post("/depots", status_code=201)
def create_depot(body: DepotIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_master_data"))):
    d = Depot(name=body.name, lat=body.lat, lng=body.lng, capacity_litres=body.capacity_litres, data_origin="manual")
    db.add(d)
    db.flush()
    audit(db, actor_from(request, admin), "depot.create", "depot", d.id, after={"name": d.name, "lat": d.lat, "lng": d.lng})
    db.commit()
    return depot_view(d)
