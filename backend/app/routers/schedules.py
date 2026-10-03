"""Public tap schedules and supply information.

Operators record when each tap / standpost / piped line runs and publish notices (interruptions, extra
supply, quality advisories). Residents see them on the public schedule page together with what the system
actually knows: whether a tanker trip to their place is open, and when water was last delivered there.
Every value here is either entered by staff or read from live operational records.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..domain import SYNTHETIC, TRIP_OPEN
from ..models import Community, Delivery, SupplyNotice, TapSchedule, Trip, TripStop, User, utcnow
from ..schemas import SupplyNoticeIn, TapScheduleIn
from ..security import actor_from, require
from ..services import supply
from ..services.common import audit, snapshot
from ..services.realtime import hub
from ..services.views import iso, plain_name

router = APIRouter(tags=["schedules"])
IST = timedelta(hours=5, minutes=30)
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _hm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


def next_window(sched: TapSchedule, now_utc: datetime) -> dict | None:
    """Next (or current) run of this schedule, in IST. Overnight windows (22:00-02:00) are supported."""
    if not sched.days:
        return None
    local = now_utc + IST
    sh, sm = _hm(sched.start_time)
    eh, em = _hm(sched.end_time)
    for offset in range(-1, 8):
        day = (local - timedelta(days=0)).date() + timedelta(days=offset)
        if day.isoweekday() not in sched.days:
            continue
        start = datetime(day.year, day.month, day.day, sh, sm)
        end = datetime(day.year, day.month, day.day, eh, em)
        if end <= start:
            end += timedelta(days=1)
        if end > local:
            return {"startsAt": iso(start - IST), "endsAt": iso(end - IST), "running": start <= local < end,
                    "startsLocal": start.strftime("%a %d %b, %H:%M"), "endsLocal": end.strftime("%H:%M")}
    return None


def schedule_view(s: TapSchedule, now: datetime | None = None) -> dict:
    now = now or utcnow()
    return {
        "id": s.id, "communityId": s.community_id, "communityName": s.community.name if s.community else s.community_id,
        "pointName": s.point_name, "kind": s.kind, "days": sorted(s.days or []),
        "daysLabel": ", ".join(DAY_NAMES[d - 1] for d in sorted(s.days or [])) if len(s.days or []) < 7 else "Every day",
        "startTime": s.start_time, "endTime": s.end_time, "lat": s.lat, "lng": s.lng, "notes": s.notes,
        "isActive": s.is_active, "dataOrigin": s.data_origin, "updatedBy": s.updated_by, "updatedAt": iso(s.updated_at),
        "next": next_window(s, now) if s.is_active else None,
    }


def notice_view(n: SupplyNotice) -> dict:
    return {"id": n.id, "communityId": n.community_id, "communityName": n.community.name if n.community else n.community_id,
            "kind": n.kind, "message": n.message, "startsAt": iso(n.starts_at), "endsAt": iso(n.ends_at),
            "createdBy": n.created_by, "createdAt": iso(n.created_at)}


def _active_notices(db: Session, community_id: str | None = None):
    now = utcnow()
    q = select(SupplyNotice).options(joinedload(SupplyNotice.community)).where(
        SupplyNotice.starts_at <= now + timedelta(days=7),
        (SupplyNotice.ends_at.is_(None)) | (SupplyNotice.ends_at > now)).order_by(SupplyNotice.starts_at)
    if community_id:
        q = q.where(SupplyNotice.community_id == community_id)
    return list(db.scalars(q))


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------
@router.get("/schedules")
def list_schedules(community_id: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(TapSchedule).options(joinedload(TapSchedule.community)).order_by(TapSchedule.community_id, TapSchedule.start_time)
    if community_id:
        q = q.where(TapSchedule.community_id == community_id)
    now = utcnow()
    return {"schedules": [schedule_view(s, now) for s in db.scalars(q)],
            "notices": [notice_view(n) for n in _active_notices(db, community_id)]}


def _check(body: TapScheduleIn, db: Session) -> None:
    if not db.get(Community, body.community_id):
        raise HTTPException(404, "Community not found")
    if any(d < 1 or d > 7 for d in body.days):
        raise HTTPException(422, "days are ISO weekdays 1 (Monday) to 7 (Sunday)")
    if body.start_time == body.end_time:
        raise HTTPException(422, "Start and end time must differ")


@router.post("/schedules", status_code=201)
def create_schedule(body: TapScheduleIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("manage_schedules"))):
    _check(body, db)
    s = TapSchedule(**{**body.model_dump(), "days": sorted(set(body.days))}, updated_by=user.email, data_origin="manual")
    db.add(s)
    db.flush()
    audit(db, actor_from(request, user), "schedule.create", "tap_schedule", s.id,
          after=snapshot(s, ("community_id", "point_name", "days", "start_time", "end_time")))
    db.commit()
    db.refresh(s)
    hub.publish("schedules.changed", {"communityId": s.community_id})
    return schedule_view(s)


@router.put("/schedules/{sid}")
def update_schedule(sid: int, body: TapScheduleIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("manage_schedules"))):
    s = db.get(TapSchedule, sid)
    if not s:
        raise HTTPException(404, "Schedule not found")
    _check(body, db)
    fields = ("community_id", "point_name", "kind", "days", "start_time", "end_time", "notes", "is_active")
    before = snapshot(s, fields)
    for k, v in {**body.model_dump(), "days": sorted(set(body.days))}.items():
        setattr(s, k, v)
    s.updated_by = user.email
    audit(db, actor_from(request, user), "schedule.update", "tap_schedule", s.id, before=before, after=snapshot(s, fields))
    db.commit()
    db.refresh(s)
    hub.publish("schedules.changed", {"communityId": s.community_id})
    return schedule_view(s)


@router.delete("/schedules/{sid}", status_code=204)
def delete_schedule(sid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require("manage_schedules"))):
    s = db.get(TapSchedule, sid)
    if not s:
        raise HTTPException(404, "Schedule not found")
    audit(db, actor_from(request, user), "schedule.delete", "tap_schedule", s.id,
          before=snapshot(s, ("community_id", "point_name", "days", "start_time", "end_time")))
    db.delete(s)
    db.commit()
    hub.publish("schedules.changed", {"communityId": s.community_id})


@router.post("/supply-notices", status_code=201)
def create_notice(body: SupplyNoticeIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("manage_schedules"))):
    if not db.get(Community, body.community_id):
        raise HTTPException(404, "Community not found")
    starts = body.starts_at.replace(tzinfo=None) if body.starts_at else utcnow()
    ends = body.ends_at.replace(tzinfo=None) if body.ends_at else None
    if ends and ends <= starts:
        raise HTTPException(422, "Notice must end after it starts")
    n = SupplyNotice(community_id=body.community_id, kind=body.kind, message=body.message.strip(), starts_at=starts, ends_at=ends,
                     created_by=user.email)
    db.add(n)
    db.flush()
    audit(db, actor_from(request, user), "notice.create", "supply_notice", n.id, after={"kind": n.kind, "message": n.message})
    db.commit()
    db.refresh(n)
    hub.publish("schedules.changed", {"communityId": n.community_id})
    return notice_view(n)


@router.post("/supply-notices/{nid}/end")
def end_notice(nid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require("manage_schedules"))):
    n = db.get(SupplyNotice, nid)
    if not n:
        raise HTTPException(404, "Notice not found")
    n.ends_at = utcnow()
    audit(db, actor_from(request, user), "notice.end", "supply_notice", n.id)
    db.commit()
    hub.publish("schedules.changed", {"communityId": n.community_id})
    return notice_view(n)


# ---------------------------------------------------------------------------
# Public (no login)
# ---------------------------------------------------------------------------
@router.get("/public/schedules")
def public_schedule_index(db: Session = Depends(get_db)):
    """Places that currently publish a tap schedule or notice, so residents can find theirs quickly."""
    sched = dict(db.execute(select(TapSchedule.community_id, func.count(TapSchedule.id))
                            .where(TapSchedule.is_active.is_(True)).group_by(TapSchedule.community_id)).all())
    notices = {n.community_id for n in _active_notices(db)}
    ids = set(sched) | notices
    rows = db.scalars(select(Community).where(Community.id.in_(ids), Community.is_active.is_(True)).order_by(Community.name)) if ids else []
    return [{"id": c.id, "name": c.name, "ward": c.ward, "schedules": sched.get(c.id, 0), "hasNotice": c.id in notices} for c in rows]


@router.get("/public/supply/{community_id}")
def public_supply(community_id: str, db: Session = Depends(get_db)):
    c = db.get(Community, community_id)
    if not c or not c.is_active:
        raise HTTPException(404, "Place not found")
    now = utcnow()
    scheds = list(db.scalars(select(TapSchedule).where(TapSchedule.community_id == c.id, TapSchedule.is_active.is_(True))
                             .order_by(TapSchedule.start_time)))
    views = [schedule_view(s, now) for s in scheds]
    upcoming = sorted((v for v in views if v["next"]), key=lambda v: v["next"]["startsAt"])
    # Open tanker trips with a stop here (no vehicle position or driver details are published).
    stop = db.execute(select(TripStop, Trip).join(Trip, Trip.id == TripStop.trip_id)
                      .where(TripStop.community_id == c.id, Trip.status.in_(TRIP_OPEN), Trip.data_origin != SYNTHETIC,
                             TripStop.status.in_(("Pending", "Arrived")))
                      .order_by(Trip.created_at)).first()
    tanker = None
    if stop:
        ts, trip = stop
        stage = {"Planned": "scheduled", "Assigned": "scheduled", "Accepted": "scheduled", "En Route": "on_the_way",
                 "Arrived": "arrived", "Delivering": "arrived"}.get(trip.status, "scheduled")
        if ts.status == "Arrived":
            stage = "arrived"
        tanker = {"stage": stage, "trip": trip.code, "litres": ts.allocated_litres, "since": iso(trip.started_at or trip.assigned_at or trip.created_at)}
    last = db.execute(select(Delivery.delivered_at, Delivery.delivered_amount)
                      .where(Delivery.community_id == c.id, Delivery.data_origin != SYNTHETIC)
                      .order_by(Delivery.delivered_at.desc())).first()
    return {
        "community": {"id": c.id, "name": c.name, "ward": c.ward, "district": c.district.name if c.district else None,
                      "state": plain_name(c.state.name) if c.state else None, "population": c.population},
        "schedules": views,
        "nextSupply": upcoming[0] if upcoming else None,
        "notices": [notice_view(n) for n in _active_notices(db, c.id)],
        "tanker": tanker,
        "lastDelivery": {"at": iso(last[0]), "litres": last[1]} if last else None,
        # Estimate: piped baseline + approved tanker allocation vs demand at the planning norm.
        "estimatedCoveragePct": supply.coverage_pct(c),
        "coverageBasis": c.demand_basis or "Demand at the planning norm; piped supply estimated.",
        "serverTime": iso(now),
    }
