"""Serialisers: ORM rows -> camelCase JSON matching ``frontend/src/types``.

Everything derived (coverage, shortfall, status, priority, ETA ...) is computed here from
real records rather than stored, so it can never drift from the underlying data.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    AllocationPlan, Community, Complaint, Delivery, Depot, Tanker, Trip, TripStop, WaterRequest, utcnow,
)
from .common import get_setting, haversine_m
from .priority import PriorityContext, score_community, vulnerability_level


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def priority_context(db: Session, communities: list[Community]) -> PriorityContext:
    since = utcnow() - timedelta(days=7)
    rows = db.execute(
        select(Delivery.community_id, func.sum(Delivery.delivered_amount))
        .where(Delivery.delivered_at >= since)
        .group_by(Delivery.community_id)
    ).all()
    return PriorityContext(
        max_demand=max((c.daily_demand for c in communities), default=1),
        max_population=max((c.population for c in communities), default=1),
        delivered_7d={cid: int(total or 0) for cid, total in rows},
    )


def community_views(db: Session, include_inactive: bool = False) -> list[dict]:
    q = select(Community).order_by(Community.name)
    if not include_inactive:
        q = q.where(Community.is_active.is_(True))
    communities = list(db.scalars(q))
    if not communities:
        return []
    weights = get_setting(db, "weights")
    ctx = priority_context(db, communities)

    open_c = Counter()
    repeated_c = Counter()
    for cid, sim, dup in db.execute(select(Complaint.community_id, Complaint.similar_count, Complaint.duplicate_of_id).where(Complaint.status != "Resolved")):
        open_c[cid] += 1
        if sim >= 1 or dup is not None:
            repeated_c[cid] += 1
    critical_req = Counter(cid for (cid,) in db.execute(
        select(WaterRequest.community_id).where(WaterRequest.urgency == "Critical", WaterRequest.status.in_(("Pending", "Allocated")))))
    last_delivery = dict(db.execute(select(Delivery.community_id, func.max(Delivery.delivered_at)).group_by(Delivery.community_id)).all())

    out = []
    now = utcnow()
    for c in communities:
        coverage = min(100, round(100 * c.allocated_water / c.daily_demand)) if c.daily_demand else 0
        last = last_delivery.get(c.id)
        if coverage < 65 or critical_req[c.id]:
            status = "Critical"
        elif coverage < 85:
            status = "High Demand"
        elif last and now - last < timedelta(hours=24):
            status = "Recently Served"
        else:
            status = "Normal"
        pr = score_community(c, weights, ctx)
        out.append({
            "id": c.id,
            "name": c.name,
            "ward": c.ward,
            "population": c.population,
            "dailyDemand": c.daily_demand,
            "allocatedWater": c.allocated_water,
            "availableWater": c.allocated_water,
            "shortfall": max(0, c.daily_demand - c.allocated_water),
            "vulnerability": vulnerability_level(c.vulnerability_score),
            "vulnerabilityScore": round(c.vulnerability_score),
            "previousAllocation": c.previous_allocation,
            "currentCoverage": coverage,
            "lastDelivery": iso(last),
            "openComplaints": open_c[c.id],
            "repeatedComplaints": repeated_c[c.id],
            "priorityScore": pr.score,
            "priorityFactors": pr.subscores,
            "lat": c.lat,
            "lng": c.lng,
            "status": status,
            "contactOfficer": c.contact_officer,
            "officerPhone": c.officer_phone,
            "isActive": c.is_active,
        })
    return out


def request_view(r: WaterRequest) -> dict:
    return {
        "id": r.code,
        "dbId": r.id,
        "communityId": r.community_id,
        "communityName": r.community.name if r.community else r.community_id,
        "requestedAmount": r.requested_amount,
        "urgency": r.urgency,
        "population": r.community.population if r.community else 0,
        "peopleCurrentlyServed": r.people_currently_served,
        "vulnerability": vulnerability_level(r.community.vulnerability_score) if r.community else "Medium",
        "reason": r.reason,
        "daysWithoutWater": r.days_without_water,
        "contactPerson": r.contact_person,
        "phone": r.phone,
        "submittedAt": iso(r.created_at),
        "status": r.status,
        "priorityScore": r.priority_score,
        "aiAssessment": r.assessment or None,
    }


def complaint_view(c: Complaint) -> dict:
    return {
        "id": c.code,
        "dbId": c.id,
        "communityId": c.community_id,
        "communityName": c.community.name if c.community else c.community_id,
        "category": c.category,
        "categoryConfidence": c.category_confidence,
        "description": c.description,
        "sentiment": c.sentiment,
        "severity": c.severity,
        "severityConfidence": c.severity_confidence,
        "isRepeated": c.similar_count > 0 or c.duplicate_of_id is not None,
        "similarComplaintsCount": c.similar_count,
        "duplicateOf": f"C-{2000 + c.duplicate_of_id}" if c.duplicate_of_id else None,
        "status": c.status,
        "assignedOfficer": c.assigned_officer,
        "submittedAt": iso(c.created_at),
        "resolvedAt": iso(c.resolved_at),
        "duplicateProbability": c.duplicate_probability,
        "recommendedAction": c.recommended_action,
        "labelVerified": c.label_verified,
        "source": c.source,
        "reporterName": c.reporter_name,
    }


def depot_view(d: Depot | None) -> dict | None:
    return {"id": d.id, "name": d.name, "lat": d.lat, "lng": d.lng} if d else None


def _nearest_place(lat: float, lng: float, communities: list[Community], depots: list[Depot]) -> str:
    best, best_d = None, float("inf")
    for c in communities:
        d = haversine_m(lat, lng, c.lat, c.lng)
        if d < best_d:
            best, best_d = c.name, d
    for dp in depots:
        d = haversine_m(lat, lng, dp.lat, dp.lng)
        if d < 300 and d < best_d:
            return f"At {dp.name}"
    if best is None:
        return "Unknown"
    return f"At {best}" if best_d < 200 else f"{best_d / 1000:.1f} km from {best}"


def tanker_views(db: Session) -> list[dict]:
    tankers = list(db.scalars(select(Tanker).order_by(Tanker.id)))
    communities = list(db.scalars(select(Community)))
    depots = list(db.scalars(select(Depot)))
    ops = get_setting(db, "operations")
    active_trips = {t.tanker_id: t for t in db.scalars(select(Trip).where(Trip.status.in_(("Planned", "En Route"))).order_by(Trip.created_at))}

    out = []
    now = utcnow()
    for t in tankers:
        trip = active_trips.get(t.id)
        lat = t.lat if t.lat is not None else (t.depot.lat if t.depot else 19.035)
        lng = t.lng if t.lng is not None else (t.depot.lng if t.depot else 72.898)
        stops = trip.stops if trip else []
        pending = [s for s in stops if s.status == "Pending"]
        next_stop = pending[0] if pending else None
        eta = None
        if next_stop and t.status == "En Route":
            km = haversine_m(lat, lng, next_stop.community.lat, next_stop.community.lng) / 1000 * ops["roadCircuityFactor"]
            speed = t.speed_kmh if t.speed_kmh and t.speed_kmh > 5 else ops["fallbackSpeedKmh"]
            eta = f"{max(1, round(km / speed * 60))} min"
        progress = round(100 * (len(stops) - len(pending)) / len(stops)) if stops else 0
        online = bool(t.last_ping_at and now - t.last_ping_at < timedelta(minutes=5))
        out.append({
            "id": t.id,
            "vehicleNumber": t.vehicle_number,
            "driverName": t.driver_name,
            "driverPhone": t.driver_phone,
            "driverUserId": t.driver_user_id,
            "capacity": t.capacity,
            "currentLoad": t.current_load,
            "status": t.status,
            "currentLocationName": _nearest_place(lat, lng, communities, depots),
            "destinationCommunity": next_stop.community.name if next_stop else ("Depot" if trip else "—"),
            "eta": eta or "—",
            "speedKmH": round(t.speed_kmh or 0),
            "progressPercent": progress,
            "currentCoordinates": [lat, lng],
            "routeWaypoints": trip.route_geometry if trip else [],
            "stops": [s.community.name for s in stops],
            "isDisrupted": t.status == "Maintenance" and bool(t.breakdown_note),
            "breakdownNote": t.breakdown_note,
            "activeTripId": trip.code if trip else None,
            "lastPingAt": iso(t.last_ping_at),
            "gpsOnline": online,
            "depot": depot_view(t.depot),
        })
    return out


def trip_view(trip: Trip) -> dict:
    return {
        "id": trip.code,
        "dbId": trip.id,
        "tankerId": trip.tanker_id,
        "vehicleNumber": trip.tanker.vehicle_number,
        "status": trip.status,
        "distanceKm": trip.distance_km,
        "durationMin": trip.duration_min,
        "baselineDistanceKm": trip.baseline_distance_km,
        "baselineDurationMin": trip.baseline_duration_min,
        "routingSource": trip.routing_source,
        "routeGeometry": trip.route_geometry,
        "createdAt": iso(trip.created_at),
        "startedAt": iso(trip.started_at),
        "completedAt": iso(trip.completed_at),
        "stops": [{
            "id": s.id,
            "seq": s.seq,
            "communityId": s.community_id,
            "communityName": s.community.name,
            "lat": s.community.lat,
            "lng": s.community.lng,
            "allocatedLitres": s.allocated_litres,
            "status": s.status,
        } for s in trip.stops],
    }


def delivery_view(d: Delivery) -> dict:
    return {
        "id": d.code,
        "dbId": d.id,
        "tankerId": d.tanker_id,
        "vehicleNumber": d.tanker.vehicle_number if d.tanker else d.tanker_id,
        "communityId": d.community_id,
        "communityName": d.community.name if d.community else d.community_id,
        "allocatedAmount": d.allocated_amount,
        "deliveredAmount": d.delivered_amount,
        "deliveryTime": iso(d.delivered_at),
        "gpsVerified": d.gps_verified,
        "geofenceDistanceM": round(d.geofence_distance_m) if d.geofence_distance_m is not None else None,
        "officerVerified": d.officer_verified,
        "verifiedBy": d.verified_by,
        "status": d.status,
        "varianceAmount": d.variance_amount,
        "notes": d.notes,
        "fieldOfficer": d.verified_by or "Awaiting sign-off",
        "recordedBy": d.recorded_by,
        "photoUrl": f"/api/deliveries/{d.id}/photo" if d.photo_path else None,
        "tripMinutes": d.trip_minutes,
    }


def plan_view(plan: AllocationPlan) -> dict:
    return {
        "id": plan.id,
        "status": plan.status,
        "totalSupply": plan.total_supply,
        "totalDemand": plan.total_demand,
        "fairnessBefore": plan.fairness_before,
        "fairnessAfter": plan.fairness_after,
        "weights": plan.weights,
        "method": plan.method,
        "demandSource": plan.demand_source,
        "disruption": plan.disruption,
        "metricsBefore": (plan.details or {}).get("before", {}),
        "metricsAfter": (plan.details or {}).get("after", {}),
        "notes": (plan.details or {}).get("notes", []),
        "createdAt": iso(plan.created_at),
        "approvedAt": iso(plan.approved_at),
        "items": [{
            "communityId": it.community_id,
            "communityName": it.community.name,
            "demand": it.demand,
            "available": it.previous_allocation,
            "previousAllocation": it.previous_allocation,
            "priorityScore": it.priority_score,
            "survivalFloor": it.survival_floor,
            "recommendedAllocation": it.recommended,
            "coveragePct": round(100 * it.recommended / it.demand) if it.demand else 0,
            "reason": it.reason,
            "status": "Approved" if plan.status == "Approved" else "Proposed",
            "factors": it.factors,
        } for it in plan.items],
    }


def group_count(rows) -> dict:
    d = defaultdict(int)
    for k in rows:
        d[k] += 1
    return dict(d)
