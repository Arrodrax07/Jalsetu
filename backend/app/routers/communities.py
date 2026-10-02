from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Community, DemandObservation, User
from ..schemas import CommunityIn, CommunityUpdate, DemandObservationIn
from ..security import actor_from, require
from ..services import ml
from ..services.common import audit
from ..services.realtime import hub
from ..services.views import community_views

router = APIRouter(tags=["communities"])


@router.get("/communities")
def list_communities(include_inactive: bool = False, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    return community_views(db, include_inactive=include_inactive)


@router.get("/public/communities")
def public_communities(db: Session = Depends(get_db)):
    """Minimal list for the citizen complaint portal (no auth)."""
    return [{"id": c.id, "name": c.name, "ward": c.ward}
            for c in db.scalars(select(Community).where(Community.is_active.is_(True)).order_by(Community.name))]


def _slug(name: str) -> str:
    return "c-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:36]


@router.post("/communities", status_code=201)
def create_community(body: CommunityIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_master_data"))):
    cid = body.id or _slug(body.name)
    if db.get(Community, cid):
        raise HTTPException(409, f"Community id '{cid}' already exists")
    data = body.model_dump(exclude={"id"})
    c = Community(id=cid, previous_allocation=data.get("allocated_water", 0), data_origin="manual", **data)
    from ..services.geography import locate
    c.state_id, c.district_id = locate(db, c.lat, c.lng)
    db.add(c)
    audit(db, actor_from(request, admin), "community.create", "community", cid, after={"name": c.name, "lat": c.lat, "lng": c.lng})
    db.commit()
    hub.publish("communities.changed")
    return next(v for v in community_views(db, include_inactive=True) if v["id"] == cid)


@router.patch("/communities/{community_id}")
def update_community(community_id: str, body: CommunityUpdate, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_master_data"))):
    c = db.get(Community, community_id)
    if not c:
        raise HTTPException(404, "Community not found")
    data = body.model_dump(exclude_unset=True)
    before = {k: getattr(c, k) for k in data}
    for k, v in data.items():
        setattr(c, k, v)
    if "lat" in data or "lng" in data:
        from ..services.geography import locate
        c.state_id, c.district_id = locate(db, c.lat, c.lng)
    audit(db, actor_from(request, admin), "community.update", "community", c.id, data, before=before, after=data)
    db.commit()
    hub.publish("communities.changed")
    return next(v for v in community_views(db, include_inactive=True) if v["id"] == c.id)


@router.get("/communities/{community_id}/forecast")
def community_forecast(community_id: str, days: int = 7, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    c = db.get(Community, community_id)
    if not c:
        raise HTTPException(404, "Community not found")
    try:
        rows, source = ml.forecast_demand(c.lat, c.lng, c.daily_demand, c.vulnerability_score, days=min(max(days, 1), 14))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"communityId": c.id, "baseline": c.daily_demand, "weatherSource": source, "days": rows}


@router.post("/demand-observations", status_code=201)
def record_observation(body: DemandObservationIn, db: Session = Depends(get_db), user: User = Depends(require("manage_requests"))):
    """Record actual metered daily consumption; used to retrain the demand model."""
    if not db.get(Community, body.community_id):
        raise HTTPException(404, "Community not found")
    row = db.scalar(select(DemandObservation).where(DemandObservation.community_id == body.community_id, DemandObservation.date == body.date))
    if row:
        row.litres, row.source = body.litres, body.source
    else:
        db.add(DemandObservation(community_id=body.community_id, date=body.date, litres=body.litres, source=body.source))
    audit(db, user, "demand.observe", "community", body.community_id, {"date": str(body.date), "litres": body.litres})
    db.commit()
    return {"ok": True}
