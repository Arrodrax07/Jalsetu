"""Read-only analytics. Every number is computed from stored records; when there is no data
yet the value is null and the UI says so, instead of showing a placeholder."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..domain import SYNTHETIC
from ..models import AllocationPlan, Community, Complaint, Delivery, Tanker, Trip, User, WaterRequest, utcnow
from ..security import require
from ..services import ml
from ..services.allocation import AllocationInput, fairness_metrics
from ..services.common import get_setting
from ..services.views import community_views, iso

router = APIRouter(tags=["analytics"])

IST = timedelta(hours=5, minutes=30)


def _pct_change(cur: float, prev: float) -> float | None:
    if prev == 0:
        return None
    return round(100 * (cur - prev) / prev, 1)


def current_fairness(views: list[dict]) -> dict:
    items = [AllocationInput(v["id"], v["name"], v["dailyDemand"], v["population"], v["priorityScore"], v["vulnerabilityScore"], v["allocatedWater"]) for v in views]
    return fairness_metrics(items, {v["id"]: v["allocatedWater"] for v in views}) if items else {}


@router.get("/analytics/dashboard")
def dashboard(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    now = utcnow()
    views = community_views(db)
    tankers = db.scalars(select(Tanker)).all()

    req_times = db.scalars(select(WaterRequest.created_at).where(WaterRequest.created_at >= now - timedelta(hours=48), WaterRequest.data_origin != SYNTHETIC)).all()
    req_24 = sum(1 for t in req_times if t >= now - timedelta(hours=24))
    resolved_24 = db.scalars(select(Complaint.id).where(Complaint.resolved_at >= now - timedelta(hours=24))).all()

    recent_deliv = db.scalars(select(Delivery.trip_minutes).where(Delivery.delivered_at >= now - timedelta(days=7), Delivery.trip_minutes.is_not(None), Delivery.data_origin != SYNTHETIC)).all()
    prev_deliv = db.scalars(select(Delivery.trip_minutes).where(Delivery.delivered_at >= now - timedelta(days=14), Delivery.delivered_at < now - timedelta(days=7), Delivery.trip_minutes.is_not(None), Delivery.data_origin != SYNTHETIC)).all()
    avg_del = round(sum(recent_deliv) / len(recent_deliv)) if recent_deliv else None
    avg_prev = round(sum(prev_deliv) / len(prev_deliv)) if prev_deliv else None

    trips = db.scalars(select(Trip).where(Trip.created_at >= now - timedelta(days=30), Trip.status != "Cancelled", Trip.data_origin != SYNTHETIC)).all()
    saved_km = [max(0.0, t.baseline_distance_km - t.distance_km) for t in trips]
    ops = get_setting(db, "operations")
    fairness = current_fairness(views)
    last_plan = db.scalar(select(AllocationPlan).where(AllocationPlan.status == "Approved").order_by(AllocationPlan.approved_at.desc()))

    return {
        "fleetTotal": len(tankers),
        "fleetOperational": sum(1 for t in tankers if t.status != "Maintenance"),
        "tankersActive": sum(1 for t in tankers if t.status in ("On Trip", "Assigned")),
        "communitiesTotal": len(views),
        "communitiesServed": sum(1 for v in views if v["currentCoverage"] >= 85),
        "underserved": sum(1 for v in views if v["currentCoverage"] < 75 or v["status"] == "Critical"),
        "requestsLast24h": req_24,
        "requestsChangePct": _pct_change(req_24, len(req_times) - req_24),
        "complaintsResolved24h": len(resolved_24),
        "avgDeliveryMinutes": avg_del,
        "avgDeliveryChangeMin": (avg_del - avg_prev) if avg_del is not None and avg_prev is not None else None,
        "coverageBalance": fairness.get("needWeightedEquity"),
        "coverageEquality": fairness.get("coverageEquality"),
        "minCoveragePct": fairness.get("minCoveragePct"),
        "lastPlanFairnessGain": round(last_plan.fairness_after - last_plan.fairness_before, 1) if last_plan else None,
        "routeTrips30d": len(trips),
        "routeAvgKmSaved": round(sum(saved_km) / len(saved_km), 2) if saved_km else None,
        "routeAvgFuelSavedInr": round(sum(saved_km) / len(saved_km) / ops["tankerKmPerLitre"] * ops["dieselPricePerLitre"]) if saved_km else None,
    }


@router.get("/analytics/activity")
def activity(window: str = Query("7d", alias="range", pattern="^(today|7d|30d)$"), origin: str = Query("all", pattern="^(all|real)$"),
             db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """Requests + complaints by hour of day (IST) and by day. origin=real leaves out labelled synthetic history."""
    now = utcnow()
    since = {"today": now - timedelta(hours=24), "7d": now - timedelta(days=7), "30d": now - timedelta(days=30)}[window]
    rq = select(WaterRequest.created_at).where(WaterRequest.created_at >= since)
    reqs = db.scalars(rq.where(WaterRequest.data_origin != SYNTHETIC) if origin == "real" else rq).all()
    synthetic = db.scalar(select(func.count(WaterRequest.id)).where(WaterRequest.created_at >= since, WaterRequest.data_origin == SYNTHETIC)) if origin == "all" else 0
    comps = db.scalars(select(Complaint.created_at).where(Complaint.created_at >= since)).all()
    hourly = [{"hour": f"{h:02d}:00", "requests": 0, "complaints": 0} for h in range(24)]
    daily: dict[str, dict] = defaultdict(lambda: {"requests": 0, "complaints": 0})
    for t in reqs:
        local = t + IST
        hourly[local.hour]["requests"] += 1
        daily[local.date().isoformat()]["requests"] += 1
    for t in comps:
        local = t + IST
        hourly[local.hour]["complaints"] += 1
        daily[local.date().isoformat()]["complaints"] += 1
    return {"range": window, "origin": origin, "syntheticRecords": synthetic,
            "hourly": hourly, "daily": [{"date": k, **v} for k, v in sorted(daily.items())]}


@router.get("/analytics/forecast")
def city_forecast(days: int = Query(7, ge=1, le=14), db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    communities = db.scalars(select(Community).where(Community.is_active.is_(True))).all()
    if not communities:
        return {"days": [], "communities": [], "weatherSource": None}
    total: dict[str, dict] = {}
    per = []
    source = None
    try:
        for c in communities:
            rows, source = ml.forecast_demand(c.lat, c.lng, c.daily_demand, c.vulnerability_score, days=days)
            per.append({"communityId": c.id, "name": c.name, "baseline": c.daily_demand, "days": rows})
            for r in rows:
                agg = total.setdefault(r["date"], {"date": r["date"], "p10": 0, "p50": 0, "p90": 0, "baseline": 0,
                                                   "tempMax": r["temp_max"], "precipMm": r["precip_mm"]})
                agg["p10"] += r["litres_p10"]
                agg["p50"] += r["litres_p50"]
                agg["p90"] += r["litres_p90"]
                agg["baseline"] += c.daily_demand
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"days": sorted(total.values(), key=lambda r: r["date"]), "communities": per, "weatherSource": source,
            "model": (ml.forecaster().meta if ml.forecaster() else None)}


@router.get("/analytics/impact")
def impact(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    ops = get_setting(db, "operations")

    plans = db.scalars(select(AllocationPlan).where(AllocationPlan.status.in_(("Approved", "Superseded"))).order_by(AllocationPlan.created_at)).all()
    approved = [p for p in plans if p.approved_at]
    fairness_series = [{"date": iso(p.approved_at), "before": p.fairness_before, "after": p.fairness_after,
                        "minCoverageAfter": (p.details or {}).get("after", {}).get("minCoveragePct")} for p in approved]

    latest = db.scalar(select(AllocationPlan).where(AllocationPlan.status == "Approved").options(joinedload(AllocationPlan.items)).order_by(AllocationPlan.approved_at.desc()))
    coverage_compare = []
    if latest:
        for it in latest.items:
            coverage_compare.append({
                "community": it.community.name,
                "before": round(100 * min(it.previous_allocation, it.demand) / it.demand) if it.demand else 0,
                "after": round(100 * min(it.recommended, it.demand) / it.demand) if it.demand else 0,
                "vulnerability": round(it.community.vulnerability_score),
            })

    complaints = db.scalars(select(Complaint)).all()
    dup = sum(1 for c in complaints if c.duplicate_of_id is not None)
    resolved = [c for c in complaints if c.resolved_at]
    res_hours = [(c.resolved_at - c.created_at).total_seconds() / 3600 for c in resolved]
    verified_labels = [c for c in complaints if c.label_verified]

    trips = db.scalars(select(Trip).where(Trip.status != "Cancelled")).all()
    km_saved = sum(max(0.0, t.baseline_distance_km - t.distance_km) for t in trips)
    km_base = sum(t.baseline_distance_km for t in trips)
    fuel_saved_l = km_saved / ops["tankerKmPerLitre"]

    deliveries = db.scalars(select(Delivery)).all()
    req = db.scalars(select(WaterRequest)).all()

    return {
        "fairnessSeries": fairness_series,
        "coverageComparison": coverage_compare,
        "complaints": {
            "total": len(complaints),
            "duplicatesDetected": dup,
            "duplicateRatePct": round(100 * dup / len(complaints), 1) if complaints else None,
            "resolved": len(resolved),
            "avgResolutionHours": round(sum(res_hours) / len(res_hours), 1) if res_hours else None,
            "byCategory": dict(Counter(c.category for c in complaints)),
            "bySeverity": dict(Counter(c.severity for c in complaints)),
            "officerVerifiedLabels": len(verified_labels),
            "modelAgreementPct": round(100 * sum(c.predicted_category == c.category for c in verified_labels) / len(verified_labels), 1) if verified_labels else None,
        },
        "routing": {
            "trips": len(trips),
            "kmSaved": round(km_saved, 1),
            "kmSavedPct": round(100 * km_saved / km_base, 1) if km_base else None,
            "fuelSavedLitres": round(fuel_saved_l, 1),
            "fuelSavedInr": round(fuel_saved_l * ops["dieselPricePerLitre"]),
            "co2SavedKg": round(fuel_saved_l * ops["co2KgPerLitreDiesel"], 1),
        },
        "deliveries": {
            "total": len(deliveries),
            "litresDelivered": sum(d.delivered_amount for d in deliveries),
            "verified": sum(1 for d in deliveries if d.status == "Verified"),
            "mismatches": sum(1 for d in deliveries if d.status in ("Mismatch", "Under Investigation")),
            "geofencePassPct": round(100 * sum(d.gps_verified for d in deliveries) / len(deliveries), 1) if deliveries else None,
            "netVarianceLitres": sum(d.variance_amount for d in deliveries),
        },
        "requests": {
            "total": len(req),
            "delivered": sum(1 for r in req if r.status == "Delivered"),
            "open": sum(1 for r in req if r.status in ("Pending", "Allocated", "Dispatched")),
        },
    }


@router.get("/analytics/operations")
def operations_metrics(days: int = Query(30, ge=1, le=365), origin: str = Query("all", pattern="^(all|real)$"),
                       db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """Trip / delivery / response metrics from stored records. Null when there is no data for a metric.
    origin=all includes labelled synthetic demo history (counted separately in ``synthetic``); origin=real excludes it."""
    from ..models import Anomaly

    now = utcnow()
    since = now - timedelta(days=days)
    trips = db.scalars(select(Trip).where(Trip.created_at >= since)).all()
    deliveries = db.scalars(select(Delivery).where(Delivery.delivered_at >= since)).all()
    reqs = db.scalars(select(WaterRequest).where(WaterRequest.created_at >= since)).all()
    synthetic = {"trips": sum(t.data_origin == SYNTHETIC for t in trips), "deliveries": sum(d.data_origin == SYNTHETIC for d in deliveries),
                 "requests": sum(r.data_origin == SYNTHETIC for r in reqs)}
    if origin == "real":
        trips = [t for t in trips if t.data_origin != SYNTHETIC]
        deliveries = [d for d in deliveries if d.data_origin != SYNTHETIC]
        reqs = [r for r in reqs if r.data_origin != SYNTHETIC]
        synthetic = {k: 0 for k in synthetic}
    done = [t for t in trips if t.status == "Completed"]
    started = [t for t in trips if t.started_at]

    def avg(xs):
        xs = [x for x in xs if x is not None]
        return round(sum(xs) / len(xs), 1) if xs else None

    def mins(a, b):
        return (b - a).total_seconds() / 60 if a and b else None

    fulfilled = [r for r in reqs if r.fulfilled_at]
    anomalies = db.scalars(select(Anomaly).where(Anomaly.detected_at >= since)).all()
    tankers = db.scalars(select(Tanker)).all()
    # Utilisation: share of the window each vehicle spent between real trip start and completion/now.
    window_h = days * 24
    busy_h = sum(((t.completed_at or t.cancelled_at or now) - t.started_at).total_seconds() / 3600 for t in started)
    by_day: dict[str, dict] = defaultdict(lambda: {"trips": 0, "litres": 0})
    for t in done:
        by_day[(t.completed_at + IST).date().isoformat()]["trips"] += 1
    for d in deliveries:
        by_day[(d.delivered_at + IST).date().isoformat()]["litres"] += d.delivered_amount
    return {
        "windowDays": days, "origin": origin, "synthetic": synthetic,
        "tripsCreated": len(trips), "tripsStarted": len(started), "tripsCompleted": len(done),
        "tripsCancelled": sum(t.status == "Cancelled" for t in trips),
        "completionRatePct": round(100 * len(done) / len(started), 1) if started else None,
        "avgDispatchToStartMin": avg([mins(t.created_at, t.started_at) for t in started]),
        "avgStartToArrivalMin": avg([mins(t.started_at, t.arrived_at) for t in started]),
        "avgStartToCompletionMin": avg([mins(t.started_at, t.completed_at) for t in done]),
        "gpsKmTravelled": round(sum(t.distance_travelled_km for t in done), 2),
        "deliveries": len(deliveries), "deliveriesVerified": sum(d.status == "Verified" for d in deliveries),
        "litresDelivered": sum(d.delivered_amount for d in deliveries),
        "requestsCreated": len(reqs), "requestsFulfilled": len(fulfilled),
        "avgRequestToFulfilmentHours": avg([(r.fulfilled_at - r.created_at).total_seconds() / 3600 for r in fulfilled]),
        "fleetUtilisationPct": round(100 * busy_h / (window_h * max(len(tankers), 1)), 2) if started else None,
        "anomaliesByKind": dict(Counter(a.kind for a in anomalies)),
        "routeDeviations": sum(a.kind == "route_deviation" for a in anomalies),
        "daily": [{"date": k, **v} for k, v in sorted(by_day.items())],
    }


@router.get("/analytics/impact-replay")
def impact_replay(days: int = Query(30, ge=1, le=120), origin: str = Query("all", pattern="^(all|real)$"),
                  db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """First come first served vs JalSetu on the same requests, fleet and depots (see services/impact.py)."""
    from ..services.impact import replay

    return replay(db, days=days, include_synthetic=origin == "all")
