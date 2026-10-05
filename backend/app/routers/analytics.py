"""Read-only analytics. Every number is computed from stored records; when there is no data
yet the value is null and the UI says so, instead of showing a placeholder."""
from __future__ import annotations

import threading
import time
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


_forecast_memo: dict[tuple, tuple[float, dict]] = {}
_forecast_lock = threading.Lock()
FORECAST_MEMO_S = 300  # weather refreshes every 3 h; the memo only spares concurrent and repeat page loads


@router.get("/analytics/forecast")
def city_forecast(days: int = Query(7, ge=1, le=14), per_place: bool = Query(False, alias="perPlace"),
                  db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    communities = db.scalars(select(Community).where(Community.is_active.is_(True))).all()
    if not communities:
        return {"days": [], "communities": [], "weatherSource": None}
    # Any change to the places or their demand changes the key, so an edit is never served stale
    key = (days, per_place, hash(tuple((c.id, c.lat, c.lng, c.daily_demand, c.vulnerability_score) for c in communities)))
    with _forecast_lock:  # concurrent page loads wait for one computation instead of each running it
        hit = _forecast_memo.get(key)
        if hit and time.time() - hit[0] < FORECAST_MEMO_S:
            return hit[1]
        try:
            forecasts, sources = ml.forecast_demand_many(
                [(c.lat, c.lng, c.daily_demand, c.vulnerability_score) for c in communities], days=days)
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        total: dict[str, dict] = {}
        per = []
        for c, rows in zip(communities, forecasts):
            if per_place:
                per.append({"communityId": c.id, "name": c.name, "baseline": c.daily_demand, "days": rows})
            for r in rows:
                agg = total.setdefault(r["date"], {"date": r["date"], "p10": 0, "p50": 0, "p90": 0, "baseline": 0,
                                                   "tempMax": r["temp_max"], "precipMm": r["precip_mm"]})
                agg["p10"] += r["litres_p10"]
                agg["p50"] += r["litres_p50"]
                agg["p90"] += r["litres_p90"]
                agg["baseline"] += c.daily_demand
        out = {"days": sorted(total.values(), key=lambda r: r["date"]), "places": len(communities), "communities": per,
               "weatherSource": ",".join(sorted(sources)) or None, "model": (ml.forecaster().meta if ml.forecaster() else None)}
        _forecast_memo.clear()
        _forecast_memo[key] = (time.time(), out)
        return out


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


_shortage_memo: dict[tuple, tuple[float, dict]] = {}


@router.get("/analytics/shortage")
def shortage(days: int = Query(28, ge=7, le=90), origin: str = Query("all", pattern="^(all|real)$"),
             db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """Demand and shortage analysis for the places the fleet plans for (the allocation plan's default scope).

    trend      requests per day (repeats merged into an open request counted apart), litres asked for and delivered.
               origin=real leaves out the labelled synthetic history.
    outlook    next 7 days: forecast tanker need (ML demand forecast minus the estimated piped supply), the survival
               floor (drinking + cooking for every resident) and what the fleet can carry. A day whose survival
               floor is above fleet capacity is a shortage day.
    underserved places in scope ranked by the same priority score the planner uses, with coverage, shortfall and
               the last delivery, so the list explains itself.
    """
    from .allocation import CRISIS_SCOPE_MIN, fleet_supply, plan_candidates
    from ..services import supply as supply_
    from ..services.priority import FACTOR_LABELS, score_community
    from ..services.views import priority_context

    now = utcnow()
    ops = get_setting(db, "operations")

    # ---- trend
    since = now - timedelta(days=days)
    rq = select(WaterRequest).where(WaterRequest.created_at >= since)
    if origin == "real":
        rq = rq.where(WaterRequest.data_origin != SYNTHETIC)
    reqs = db.scalars(rq).all()
    dq = select(Delivery.delivered_at, Delivery.delivered_amount).where(Delivery.delivered_at >= since)
    if origin == "real":
        dq = dq.where(Delivery.data_origin != SYNTHETIC)
    start = (since + IST).date()
    trend = {(start + timedelta(days=i)).isoformat(): {"requests": 0, "repeats": 0, "citizen": 0, "litresRequested": 0, "litresDelivered": 0}
             for i in range(days + 1)}
    for r in reqs:
        d = trend.get((r.created_at + IST).date().isoformat())
        if d is None:
            continue
        if r.status == "Merged":
            d["repeats"] += 1
        else:
            d["requests"] += 1
            d["litresRequested"] += r.requested_amount
        d["citizen"] += r.source == "citizen"
    for at, litres in db.execute(dq).all():
        d = trend.get((at + IST).date().isoformat())
        if d is not None:
            d["litresDelivered"] += litres
    rows = [{"date": k, **v} for k, v in trend.items()]
    last7, prev7 = rows[-7:], rows[-14:-7]
    asked = lambda rs: sum(r["requests"] for r in rs)  # noqa: E731

    # ---- scope, underserved
    scope = plan_candidates(db, "crisis_reach")
    capacity = fleet_supply(db, ops["tripsPerDay"])
    weights = get_setting(db, "weights")
    ctx = priority_context(db, scope) if scope else None
    ids = [c.id for c in scope]
    last_delivery = dict(db.execute(select(Delivery.community_id, func.max(Delivery.delivered_at))
                                    .where(Delivery.community_id.in_(ids), Delivery.data_origin != SYNTHETIC)
                                    .group_by(Delivery.community_id)).all()) if ids else {}
    open_reqs = Counter(db.scalars(select(WaterRequest.community_id).where(
        WaterRequest.community_id.in_(ids), WaterRequest.status.in_(("Pending", "Allocated", "Dispatched")),
        WaterRequest.duplicate_of_id.is_(None), WaterRequest.data_origin != SYNTHETIC)).all()) if ids else Counter()
    places = []
    for c in scope:
        pr = score_community(c, weights, ctx)
        cov = supply_.coverage_pct(c)
        top = max(pr.contributions.items(), key=lambda kv: kv[1])[0]
        last = last_delivery.get(c.id)
        places.append({
            "id": c.id, "name": c.name, "district": c.district.name if c.district else None, "settlementType": c.settlement_type,
            "population": c.population, "coveragePct": cov, "shortfall": supply_.shortfall(c), "tankerNeed": supply_.tanker_need(c),
            "delivered7d": ctx.delivered_7d.get(c.id, 0), "lastDeliveryAt": iso(last),
            "daysSinceDelivery": (now - last).days if last else None, "openRequests": open_reqs.get(c.id, 0),
            "vulnerability": round(c.vulnerability_score), "crisis": round(c.crisis_score or 0), "priority": pr.score,
            "topReason": FACTOR_LABELS[top], "underserved": cov < 75,
        })
    places.sort(key=lambda p: (-p["priority"], p["coveragePct"]))

    # ---- outlook (memoised: the forecast pulls weather for every place in scope)
    survival_lpcd = ops["survivalLitresPerPerson"]
    key = (tuple((c.id, c.daily_demand, c.baseline_supply, c.population) for c in scope), capacity, survival_lpcd)
    hit = _shortage_memo.get(key)
    if hit and time.time() - hit[0] < FORECAST_MEMO_S:
        outlook = hit[1]
    else:
        outlook = {"days": [], "source": "baseline", "note": None}
        if scope:
            survival = sum(min(supply_.tanker_need(c), c.population * survival_lpcd) for c in scope)
            try:
                fc, sources = ml.forecast_demand_many([(c.lat, c.lng, c.daily_demand, c.vulnerability_score) for c in scope], days=7)
                outlook["source"] = "forecast: " + ",".join(sorted(sources))
            except Exception as exc:  # noqa: BLE001 - the panel still shows today's baseline need
                fc = None
                outlook["note"] = f"Forecast unavailable ({exc}); baseline demand shown."
            for i in range(7):
                date = ((now + IST).date() + timedelta(days=i)).isoformat()
                if fc and all(len(r) > i for r in fc):
                    p50 = sum(supply_.tanker_need(c, r[i]["litres_p50"]) for c, r in zip(scope, fc))
                    p90 = sum(supply_.tanker_need(c, r[i]["litres_p90"]) for c, r in zip(scope, fc))
                    date = fc[0][i].get("date", date)
                else:
                    p50 = p90 = sum(supply_.tanker_need(c) for c in scope)
                outlook["days"].append({"date": date, "needP50": p50, "needP90": p90, "survival": survival, "capacity": capacity,
                                        "gapP50": max(0, p50 - capacity), "survivalMet": capacity >= survival})
        _shortage_memo.clear()
        _shortage_memo[key] = (time.time(), outlook)

    need_today = outlook["days"][0]["needP50"] if outlook["days"] else 0
    return {
        "windowDays": days, "origin": origin,
        "trend": rows,
        "trendSummary": {"last7": asked(last7), "prev7": asked(prev7), "changePct": _pct_change(asked(last7), asked(prev7)),
                         "repeatsMerged": sum(r["repeats"] for r in rows), "citizenRequests": sum(r["citizen"] for r in rows),
                         "syntheticIncluded": origin == "all" and any(r.data_origin == SYNTHETIC for r in reqs)},
        "scope": {"label": f"Towns and villages in crisis (score {CRISIS_SCOPE_MIN}+) within tanker reach, plus places with an open request",
                  "places": len(scope), "people": sum(c.population for c in scope),
                  "underserved": sum(p["underserved"] for p in places)},
        "fleetCapacity": capacity,
        "outlook": outlook,
        "coverOfNeedPct": round(100 * capacity / need_today, 1) if need_today else None,
        "shortageDays": sum(not d["survivalMet"] for d in outlook["days"]),
        "underserved": places[:15],
    }
