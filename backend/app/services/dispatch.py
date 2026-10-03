"""Auto-dispatch: propose which tanker should go where, for a dispatcher to approve.

1. Candidates: active communities with a shortfall whose status is Critical or High Demand (or with a
   Critical open request), priority >= minPriority, and no stop already pending on an open trip.
2. Tankers: Available, at an active depot, not on an open trip.
3. Every (tanker, community) pair within maxDistanceKm of the tanker's depot is scored
       score = priority x (1 + crisis/100) x impact / (1 + distance_km / 25)
       impact = 0.4 + 0.6 x sqrt(min(1, tanker capacity / shortfall))
   so one load goes where it makes a difference (a village short 20,000 L) before a city short
   200 million litres, which needs its piped supply restored rather than one tanker. Pairs are taken
   greedily, best first, one community per tanker.
4. Spare capacity is filled with up to maxStops-1 more candidates within clusterRadiusKm of the first
   stop, best priority first. Litres per stop = min(shortfall, remaining capacity), in 100 L steps.

Distances here are straight-line; approval routes the trip on real roads (OSRM) through the same
dispatch path as a manual trip, with the same capacity, tanker and driver checks.

Optional policy (setting dispatch.autoApproveCritical): proposals whose first stop is Critical are
approved immediately; every other proposal waits for a person.
"""
from __future__ import annotations

import math
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import TANKER_AVAILABLE, TRIP_OPEN
from ..models import Community, Depot, DispatchProposal, Tanker, Trip, TripStop, User, WaterRequest, utcnow
from ..schemas import DispatchIn
from .common import get_setting, haversine_m
from .realtime import hub
from .views import community_views

OPEN_STOP = ("Pending", "Arrived")


def _busy_communities(db: Session) -> set[str]:
    rows = db.execute(select(TripStop.community_id).join(Trip, Trip.id == TripStop.trip_id)
                      .where(Trip.status.in_(TRIP_OPEN), TripStop.status.in_(OPEN_STOP)))
    return {r[0] for r in rows}


def _round_down(x: float) -> int:
    return int(x // 100 * 100)


def plan(tankers: list[dict], candidates: list[dict], cfg: dict) -> list[dict]:
    """Pure planner. tankers: {id, capacity, lat, lng, depot}; candidates: community views (+ crisis).
    Returns [{tanker, stops:[{id, litres}], km, score, first}]."""
    max_km, cluster_km, max_stops = cfg["maxDistanceKm"], cfg["clusterRadiusKm"], cfg["maxStops"]
    pairs = []
    for t in tankers:
        for c in candidates:
            km = haversine_m(t["lat"], t["lng"], c["lat"], c["lng"]) / 1000
            if km <= max_km:
                impact = 0.4 + 0.6 * math.sqrt(min(1.0, t["capacity"] / max(c["shortfall"], 1)))
                pairs.append((c["priorityScore"] * (1 + c.get("crisisScore", 0) / 100) * impact / (1 + km / 25), km, t, c))
    pairs.sort(key=lambda p: -p[0])
    used_t, used_c, out = set(), set(), []
    for score, km, t, c in pairs:
        if t["id"] in used_t or c["id"] in used_c:
            continue
        used_t.add(t["id"])
        used_c.add(c["id"])
        cap = t["capacity"]
        first = min(c["shortfall"], cap)
        stops = [{"id": c["id"], "litres": max(100, _round_down(first))}]
        cap -= stops[0]["litres"]
        for o in sorted(candidates, key=lambda x: -x["priorityScore"]):
            if len(stops) >= max_stops or cap < 500:
                break
            if o["id"] in used_c or haversine_m(c["lat"], c["lng"], o["lat"], o["lng"]) / 1000 > cluster_km:
                continue
            litres = _round_down(min(o["shortfall"], cap))
            if litres < 500:
                continue
            stops.append({"id": o["id"], "litres": litres})
            used_c.add(o["id"])
            cap -= litres
        out.append({"tanker": t, "first": c, "stops": stops, "km": round(km, 1), "score": round(score, 1)})
    return out


def propose(db: Session, user: User | None = None) -> dict:
    cfg = get_setting(db, "dispatch")
    now = utcnow()
    for p in db.scalars(select(DispatchProposal).where(DispatchProposal.status == "Proposed")):
        p.status, p.decided_at, p.decided_by = "Expired", now, "superseded by a new proposal run"

    on_trip = {r[0] for r in db.execute(select(Trip.tanker_id).where(Trip.status.in_(TRIP_OPEN)))}
    tankers = []
    for t in db.scalars(select(Tanker).where(Tanker.status == TANKER_AVAILABLE)):
        d: Depot | None = t.depot
        if t.id in on_trip or not d or not d.is_active:
            continue
        tankers.append({"id": t.id, "capacity": t.capacity, "lat": d.lat, "lng": d.lng, "depot": d.name, "number": t.vehicle_number})

    busy = _busy_communities(db)
    critical_req = {r[0] for r in db.execute(select(WaterRequest.community_id).where(
        WaterRequest.urgency == "Critical", WaterRequest.status.in_(("Pending", "Allocated"))))}
    crisis = dict(db.execute(select(Community.id, Community.crisis_score).where(Community.is_active.is_(True))).all())
    views = community_views(db)
    candidates = [{**v, "crisisScore": crisis.get(v["id"], 0) or 0} for v in views
                  if v["shortfall"] > 0 and v["id"] not in busy and v["priorityScore"] >= cfg["minPriority"]
                  and (v["status"] in ("Critical", "High Demand") or v["id"] in critical_req)]
    by_id = {v["id"]: v for v in candidates}

    batch = secrets.token_hex(6)
    created = []
    for p in plan(tankers, candidates, cfg):
        c, t = p["first"], p["tanker"]
        reasons = [
            f"{c['name']}: priority {c['priorityScore']}/100, status {c['status']}"
            + (f", crisis signals {c['crisisScore']:.0f}/100" if c["crisisScore"] else ""),
            f"Shortfall {c['shortfall']:,} L/day; this trip carries {sum(s['litres'] for s in p['stops']):,} L of {t['capacity']:,} L",
            f"{p['km']} km (straight line) from {t['depot']}",
        ]
        if c["id"] in critical_req:
            reasons.append("Has an open Critical water request")
        extra = [by_id[s["id"]]["name"] for s in p["stops"][1:]]
        if extra:
            reasons.append("Also serves nearby " + ", ".join(extra) + f" (within {cfg['clusterRadiusKm']} km)")
        row = DispatchProposal(batch=batch, tanker_id=t["id"], depot_id=db.get(Tanker, t["id"]).depot_id,
                               community_ids=[s["id"] for s in p["stops"]], litres={s["id"]: s["litres"] for s in p["stops"]},
                               score=p["score"], est_distance_km=p["km"], reasons=reasons)
        db.add(row)
        created.append(row)
    db.commit()

    auto = []
    if cfg.get("autoApproveCritical"):
        for row in created:
            if by_id[row.community_ids[0]]["status"] == "Critical":
                try:
                    approve(db, row, None, user, auto=True)
                    auto.append(row.id)
                except HTTPException as exc:
                    row.reasons = [*row.reasons, f"Auto-approve skipped: {exc.detail}"]
                    db.commit()
    hub.publish("dispatch.changed", {"batch": batch})
    return {"batch": batch, "proposed": len(created), "autoApproved": auto, "candidates": len(candidates),
            "tankersAvailable": len(tankers)}


def approve(db: Session, row: DispatchProposal, actor, user: User | None, auto: bool = False) -> dict:
    from ..routers.trips import _check_driver, dispatch_trip  # router owns the dispatch workflow

    if row.status != "Proposed":
        raise HTTPException(409, f"Proposal is {row.status}")
    tanker = db.get(Tanker, row.tanker_id)
    driver_id, note = None, None
    if tanker and tanker.driver_user_id:
        try:
            driver_id = _check_driver(db, tanker.driver_user_id).id
        except HTTPException as exc:
            note = f"Driver not assigned: {exc.detail}"
    body = DispatchIn(tanker_id=row.tanker_id, community_ids=row.community_ids, litres=row.litres, driver_user_id=driver_id)
    trip = dispatch_trip(db, body, actor if actor is not None else user, user)
    row = db.get(DispatchProposal, row.id)
    row.status, row.decided_at, row.auto = "Approved", utcnow(), auto
    row.decided_by = ("auto-approve policy" + (f" (run by {user.email})" if user else "")) if auto else (user.email if user else "system")
    row.trip_id = db.scalar(select(Trip.id).where(Trip.tanker_id == row.tanker_id).order_by(Trip.id.desc()))
    if note:
        row.reasons = [*row.reasons, note]
    db.commit()
    hub.publish("dispatch.changed", {"id": row.id})
    return trip


def reject(db: Session, row: DispatchProposal, user: User, reason: str = "") -> None:
    if row.status != "Proposed":
        raise HTTPException(409, f"Proposal is {row.status}")
    row.status, row.decided_at, row.decided_by = "Rejected", utcnow(), user.email
    if reason:
        row.reasons = [*row.reasons, f"Rejected: {reason}"]
    db.commit()
    hub.publish("dispatch.changed", {"id": row.id})


def proposal_view(db: Session, row: DispatchProposal, names: dict[str, str] | None = None) -> dict:
    names = names or {}
    t = row.tanker
    return {
        "id": row.id, "batch": row.batch, "status": row.status, "auto": row.auto, "score": row.score,
        "tankerId": row.tanker_id, "vehicleNumber": t.vehicle_number if t else row.tanker_id,
        "depot": db.get(Depot, row.depot_id).name if row.depot_id else None,
        "stops": [{"communityId": cid, "name": names.get(cid) or (db.get(Community, cid).name if db.get(Community, cid) else cid),
                   "litres": row.litres.get(cid, 0)} for cid in row.community_ids],
        "estDistanceKm": row.est_distance_km, "reasons": row.reasons,
        "tripId": row.trip_id, "tripCode": f"TR-{3000 + row.trip_id}" if row.trip_id else None,
        "createdAt": row.created_at.isoformat(timespec="seconds") + "Z",
        "decidedAt": row.decided_at.isoformat(timespec="seconds") + "Z" if row.decided_at else None, "decidedBy": row.decided_by,
    }
