from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Community, User, WaterRequest
from ..schemas import RequestIn, RequestStatusIn
from ..security import require
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
}


def assess(db: Session, body: RequestIn) -> dict:
    community = db.get(Community, body.community_id)
    if not community:
        raise HTTPException(404, "Community not found")
    communities = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    ctx = priority_context(db, communities)
    weights = get_setting(db, "weights")
    pr = score_community(community, weights, ctx, days_without_water=body.days_without_water)

    unserved_people = max(0, community.population - body.people_currently_served)
    shortfall = max(0, community.daily_demand - community.allocated_water)
    reasoning = (
        f"{pr.explanation} {community.name} ({community.ward}) has {community.population:,} residents, "
        f"{unserved_people:,} not currently served; current allocation covers "
        f"{min(100, round(100 * community.allocated_water / community.daily_demand))}% of baseline demand "
        f"({shortfall:,} L/day shortfall)."
    )
    if body.days_without_water >= 3:
        reasoning += f" {body.days_without_water} consecutive days without adequate water raises unmet-need to {pr.subscores['unmetNeed']:.0f}/100."
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
    }


@router.get("/requests")
def list_requests(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    rows = db.scalars(select(WaterRequest).options(joinedload(WaterRequest.community)).order_by(WaterRequest.created_at.desc()))
    return [request_view(r) for r in rows]


@router.post("/requests/assess")
def assess_request(body: RequestIn, db: Session = Depends(get_db), _: User = Depends(require("manage_requests"))):
    """Preview the AI priority assessment without saving."""
    return assess(db, body)


@router.post("/requests", status_code=201)
def create_request(body: RequestIn, db: Session = Depends(get_db), user: User = Depends(require("manage_requests"))):
    a = assess(db, body)
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
    db.add(r)
    db.flush()
    audit(db, user, "request.create", "water_request", r.code, {"priority": r.priority_score})
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
