from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..domain import SYNTHETIC
from ..models import Community, User, WaterRequest, utcnow
from ..schemas import RequestIn, RequestStatusIn
from ..security import require
from ..services import supply
from ..services.common import audit, get_setting
from ..services.priority import level_from_subscore, score_community, urgency_from_score, vulnerability_level
from ..services.realtime import hub
from ..services.views import priority_context, request_view

router = APIRouter(tags=["water requests"])

ALLOWED_TRANSITIONS = {
    "Pending": {"Allocated", "Rejected"},
    "Allocated": {"Dispatched", "Rejected", "Pending"},
    "Dispatched": {"Delivered"},
    "Delivered": set(),
    "Rejected": {"Pending"},
    "Merged": {"Pending"},  # an operator can split a merged request back out
}
OPEN_STATUSES = ("Pending", "Allocated", "Dispatched")


def open_duplicate(db: Session, community_id: str, hours: int) -> WaterRequest | None:
    """The open request this one would repeat: same place, still open, raised within ``hours``.

    Two requests for one place within a couple of days are almost always the same need reported twice
    (different callers, a follow-up call). Merging them stops the same need being counted and served twice."""
    if hours <= 0:
        return None
    since = utcnow() - timedelta(hours=hours)
    return db.scalar(select(WaterRequest).where(
        WaterRequest.community_id == community_id, WaterRequest.status.in_(OPEN_STATUSES),
        WaterRequest.duplicate_of_id.is_(None), WaterRequest.data_origin != SYNTHETIC,
        WaterRequest.created_at >= since).order_by(WaterRequest.created_at))


def assess(db: Session, body: RequestIn) -> dict:
    community = db.get(Community, body.community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    communities = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    ctx = priority_context(db, communities)
    weights = get_setting(db, "weights")
    pr = score_community(community, weights, ctx, days_without_water=body.days_without_water)

    unserved_people = max(0, community.population - body.people_currently_served)
    shortfall = supply.shortfall(community)
    reasoning = (
        f"{pr.explanation} {community.name} ({community.ward}) has {community.population:,} residents, "
        f"{unserved_people:,} not currently served; current allocation covers "
        f"{supply.coverage_pct(community)}% of baseline demand "
        f"({shortfall:,} L/day shortfall)."
    )
    if body.days_without_water >= 3:
        reasoning += f" {body.days_without_water} consecutive days without adequate water raises unmet-need to {pr.subscores['unmetNeed']:.0f}/100."
    if community.water_access_km is not None:
        reasoning += f" Nearest water source: {community.water_access_note}."
    hours = get_setting(db, "operations")["requestDuplicateHours"]
    dup = open_duplicate(db, community.id, hours)
    return {
        "demandLevel": level_from_subscore(max(pr.subscores["demand"], pr.subscores["unmetNeed"])),
        "vulnerability": level_from_subscore(pr.subscores["vulnerability"]),
        "estimatedShortfall": shortfall,
        "priorityScore": pr.score,
        "urgency": urgency_from_score(pr.score),
        "factors": pr.subscores,
        "contributions": pr.contributions,
        "weights": weights,
        "reasoning": reasoning,
        "vulnerabilityLevel": vulnerability_level(community.vulnerability_score),
        "possibleDuplicateOf": dup.code if dup else None,
        "duplicateWindowHours": hours,
    }


@router.get("/requests")
def list_requests(include_synthetic: bool = False, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(WaterRequest).options(joinedload(WaterRequest.community)).order_by(WaterRequest.created_at.desc())
    if not include_synthetic:
        q = q.where(WaterRequest.data_origin != SYNTHETIC)
    return [request_view(r) for r in db.scalars(q)]


@router.post("/requests/assess")
def assess_request(body: RequestIn, db: Session = Depends(get_db), _: User = Depends(require("manage_requests"))):
    """Preview the AI priority assessment without saving."""
    return assess(db, body)


@router.post("/requests", status_code=201)
def create_request(body: RequestIn, db: Session = Depends(get_db), user: User = Depends(require("manage_requests"))):
    a = assess(db, body)
    dup_code = a["possibleDuplicateOf"]
    dup = _get(db, dup_code) if dup_code and not body.allow_duplicate else None
    r = WaterRequest(
        community_id=body.community_id,
        requested_amount=body.requested_amount,
        urgency=a["urgency"],
        people_currently_served=body.people_currently_served,
        reason=body.reason,
        days_without_water=body.days_without_water,
        contact_person=body.contact_person,
        phone=body.phone,
        priority_score=a["priorityScore"],
        assessment=a,
        created_by=user.id,
    )
    if dup is not None:
        r.status, r.duplicate_of_id = "Merged", dup.id
        r.duplicate_reason = (f"Same place as open request {dup.code} raised "
                              f"{(utcnow() - dup.created_at).total_seconds() / 3600:.0f} h earlier; merged so the need is counted once.")
        # Keep the larger figure and the worse situation on the request that stays open.
        dup.requested_amount = max(dup.requested_amount, body.requested_amount)
        dup.days_without_water = max(dup.days_without_water, body.days_without_water)
    elif dup_code:
        r.duplicate_reason = f"Operator confirmed this is separate from open request {dup_code}."
    db.add(r)
    db.flush()
    audit(db, user, "request.create", "water_request", r.code,
          {"priority": r.priority_score, "mergedInto": dup.code if dup else None, "duplicateOverride": bool(dup_code and dup is None)})
    db.commit()
    db.refresh(r)
    view = request_view(r)
    hub.publish("requests.changed", {"id": view["id"]})
    return view


@router.patch("/requests/{code}/status")
def update_status(code: str, body: RequestStatusIn, db: Session = Depends(get_db), user: User = Depends(require("manage_requests"))):
    r = _get(db, code)
    if body.status != r.status and body.status not in ALLOWED_TRANSITIONS[r.status]:
        raise HTTPException(409, f"Cannot move request from {r.status} to {body.status}")
    old, r.status = r.status, body.status
    if old == "Merged" and r.status == "Pending":
        r.duplicate_reason = f"Split out of {r.duplicate_of_id and f'WR-{1000 + r.duplicate_of_id}'} by an operator."
        r.duplicate_of_id = None
    audit(db, user, "request.status", "water_request", r.code, {"from": old, "to": r.status})
    db.commit()
    hub.publish("requests.changed", {"id": r.code})
    return request_view(r)


def _get(db: Session, code: str) -> WaterRequest:
    try:
        rid = int(code.split("-")[-1]) - 1000
    except ValueError:
        raise HTTPException(404, "Request not found") from None
    r = db.get(WaterRequest, rid)
    if not r:
        raise HTTPException(404, "Request not found")
    return r
