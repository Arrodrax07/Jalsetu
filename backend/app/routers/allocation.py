from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import AllocationItem, AllocationPlan, Community, Tanker, User, WaterRequest, utcnow
from ..schemas import AllocationRunIn, BreakdownIn
from ..domain import TANKER_AVAILABLE, TANKER_MAINTENANCE
from ..security import require
from ..services import ml
from ..services.allocation import AllocationInput, optimise
from ..services import supply as supply_
from ..services.common import audit, get_setting
from ..services.priority import score_community
from ..services.realtime import hub
from ..services.views import plan_view, priority_context

router = APIRouter(tags=["allocation"])
log = logging.getLogger(__name__)

METHOD = "survival-floor + weighted proportional fairness (water-filling)"


def fleet_supply(db: Session, trips_per_day: int) -> int:
    caps = db.scalars(select(Tanker.capacity).where(Tanker.status != "Maintenance")).all()
    return int(sum(caps) * trips_per_day)


def forecast_demands(communities: list[Community]) -> tuple[dict[str, int], str]:
    out, sources = {}, set()
    for c in communities:
        try:
            rows, src = ml.forecast_demand(c.lat, c.lng, c.daily_demand, c.vulnerability_score, days=1)
            out[c.id] = rows[0]["litres_p50"]
            sources.add(src)
        except Exception as exc:  # noqa: BLE001 — fall back to baseline for this community
            log.warning("forecast failed for %s: %s", c.id, exc)
    if len(out) != len(communities):
        return {c.id: c.daily_demand for c in communities}, "baseline"
    return out, "PREDICTED: ml-forecast (" + ",".join(sorted(sources)) + "); advisory, needs real observations for calibration"


def latest_plan(db: Session, statuses=("Proposed", "Approved")) -> AllocationPlan | None:
    return db.scalar(select(AllocationPlan).where(AllocationPlan.status.in_(statuses))
                     .options(selectinload(AllocationPlan.items)).order_by(AllocationPlan.created_at.desc()))


def run_plan(db: Session, user: User | None, supply: int | None = None, use_forecast: bool = False, disruption: dict | None = None) -> AllocationPlan:
    # Only communities with a tanker need take part: places fully covered by their piped baseline get no tanker water.
    communities = [c for c in db.scalars(select(Community).where(Community.is_active.is_(True))) if supply_.tanker_need(c) > 0]
    if not communities:
        raise HTTPException(400, "No active community currently needs tanker water")
    weights = get_setting(db, "weights")
    ops = get_setting(db, "operations")
    supply = supply or fleet_supply(db, ops["tripsPerDay"])
    if supply <= 0:
        raise HTTPException(400, "No supply available: add tankers or specify totalSupply")

    demands, demand_source = forecast_demands(communities) if use_forecast else ({c.id: c.daily_demand for c in communities}, "baseline")
    full_demands = demands
    demands = {c.id: supply_.tanker_need(c, full_demands[c.id]) for c in communities}  # minus the piped baseline
    ctx = priority_context(db, communities)
    scores = {c.id: score_community(c, weights, ctx, demand_override=full_demands[c.id]) for c in communities}

    reference = latest_plan(db, ("Approved",))
    ref_alloc = {it.community_id: it.recommended for it in reference.items} if reference else {}
    protect_above = ops["protectVulnerabilityAbove"]

    inputs = [AllocationInput(
        community_id=c.id,
        name=c.name,
        demand=demands[c.id],
        population=c.population,
        priority=scores[c.id].score,
        vulnerability=c.vulnerability_score,
        current_allocation=c.allocated_water,
        protected_floor=(ref_alloc.get(c.id, c.allocated_water) if disruption and c.vulnerability_score >= protect_above else 0.0),
    ) for c in communities]
    res = optimise(inputs, supply, ops["survivalLitresPerPerson"], vuln_threshold=protect_above, min_coverage=ops["minCoveragePct"] / 100)

    db.execute(update(AllocationPlan).where(AllocationPlan.status == "Proposed").values(status="Superseded"))
    plan = AllocationPlan(
        status="Proposed",
        total_supply=res.supply,
        total_demand=res.total_demand,
        fairness_before=res.metrics_before["needWeightedEquity"],
        fairness_after=res.metrics_after["needWeightedEquity"],
        weights=weights,
        method=METHOD,
        demand_source=demand_source,
        disruption=disruption,
        details={"before": res.metrics_before, "after": res.metrics_after, "notes": res.notes},
        created_by=user.id if user else None,
    )
    db.add(plan)
    db.flush()

    for c in communities:
        x, d, floor = res.allocations[c.id], demands[c.id], res.floors[c.id]
        pr = scores[c.id]
        reason = f"{pr.explanation} Floor {floor:,} L guaranteed; allocated {x:,} L = {round(100 * x / d) if d else 0}% of {'forecast' if demand_source != 'baseline' else 'baseline'} demand {d:,} L."
        if disruption:
            prev = ref_alloc.get(c.id, c.allocated_water)
            if c.vulnerability_score >= protect_above and x >= prev:
                reason = f"PROTECTED (vulnerability {c.vulnerability_score:.0f} ≥ {protect_above:.0f}): allocation held during {disruption['tankerId']} disruption. " + reason
            elif x < prev:
                reason = f"Absorbs {prev - x:,} L of the {disruption['lostLitres']:,} L disruption shortfall. " + reason
        db.add(AllocationItem(
            plan_id=plan.id, community_id=c.id, demand=int(d), previous_allocation=c.allocated_water,
            priority_score=pr.score, survival_floor=floor, recommended=x, reason=reason,
            factors={"subscores": pr.subscores, "contributions": pr.contributions},
        ))
    audit(db, user, "allocation.run", "allocation_plan", plan.id, {"supply": res.supply, "fairnessAfter": plan.fairness_after, "disruption": disruption})
    db.commit()
    db.refresh(plan)
    hub.publish("allocation.changed", {"planId": plan.id})
    return plan


@router.get("/allocation/current")
def current_plan(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    plan = latest_plan(db)
    ops = get_setting(db, "operations")
    return {"plan": plan_view(plan) if plan else None, "fleetSupply": fleet_supply(db, ops["tripsPerDay"])}


@router.get("/allocation/history")
def plan_history(limit: int = 30, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    plans = db.scalars(select(AllocationPlan).order_by(AllocationPlan.created_at.desc()).limit(min(limit, 200)))
    return [{k: v for k, v in plan_view(p).items() if k != "items"} for p in plans]


@router.post("/allocation/run")
def run(body: AllocationRunIn, db: Session = Depends(get_db), user: User = Depends(require("run_allocation"))):
    return plan_view(run_plan(db, user, body.total_supply, body.use_forecast))


@router.post("/allocation/{plan_id}/approve")
def approve(plan_id: int, db: Session = Depends(get_db), user: User = Depends(require("approve_allocation"))):
    plan = db.get(AllocationPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    if plan.status != "Proposed":
        raise HTTPException(409, f"Plan is {plan.status}; only Proposed plans can be approved")
    db.execute(update(AllocationPlan).where(AllocationPlan.status == "Approved").values(status="Superseded"))
    plan.status, plan.approved_at = "Approved", utcnow()
    funded = set()
    for it in plan.items:
        c = db.get(Community, it.community_id)
        c.previous_allocation, c.allocated_water = c.allocated_water, it.recommended
        if it.recommended > 0:
            funded.add(c.id)
    n = db.execute(update(WaterRequest).where(WaterRequest.status == "Pending", WaterRequest.community_id.in_(funded))
                   .values(status="Allocated", updated_at=utcnow())).rowcount
    audit(db, user, "allocation.approve", "allocation_plan", plan.id, {"requestsAllocated": n})
    db.commit()
    hub.publish("allocation.changed", {"planId": plan.id})
    hub.publish("requests.changed")
    hub.publish("communities.changed")
    return {**plan_view(plan), "requestsAllocated": n}


@router.post("/tankers/{tanker_id}/breakdown")
def breakdown(tanker_id: str, body: BreakdownIn, db: Session = Depends(get_db), user: User = Depends(require("report_breakdown"))):
    t = db.get(Tanker, tanker_id)
    if not t:
        raise HTTPException(404, "Tanker not found")
    ops = get_setting(db, "operations")
    t.status, t.breakdown_note = TANKER_MAINTENANCE, body.note
    audit(db, user, "tanker.breakdown", "tanker", t.id, {"note": body.note})
    db.commit()
    hub.publish("tankers.changed")
    plan = None
    if body.reallocate:
        plan = run_plan(db, user, disruption={"tankerId": t.id, "lostLitres": t.capacity * ops["tripsPerDay"], "note": body.note})
    return {"tankerId": t.id, "plan": plan_view(plan) if plan else None}


@router.post("/tankers/{tanker_id}/restore")
def restore(tanker_id: str, db: Session = Depends(get_db), user: User = Depends(require("report_breakdown"))):
    t = db.get(Tanker, tanker_id)
    if not t:
        raise HTTPException(404, "Tanker not found")
    t.status, t.breakdown_note = TANKER_AVAILABLE, None
    audit(db, user, "tanker.restore", "tanker", t.id)
    db.commit()
    hub.publish("tankers.changed")
    return {"tankerId": t.id, "status": t.status}
