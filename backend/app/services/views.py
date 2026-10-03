"""Serialisers: ORM rows -> camelCase JSON matching ``frontend/src/types``.

Everything derived (coverage, shortfall, status, priority, ETA ...) is computed here from
real records rather than stored, so it can never drift from the underlying data.
"""
from __future__ import annotations

import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    AllocationPlan, Community, Complaint, Delivery, Depot, Tanker, WaterRequest, utcnow,
)
from . import supply
from .common import get_setting
from .priority import PriorityContext, score_community, vulnerability_level


def plain_name(s: str) -> str:
    """Boundary datasets carry transliteration marks ("Mahārāshtra"); show the everyday spelling."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


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
        max_demand=max((supply.tanker_need(c) for c in communities), default=1),
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
        coverage = supply.coverage_pct(c)
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
            "availableWater": supply.available(c),
            "baselineSupply": c.baseline_supply,
            "tankerNeed": supply.tanker_need(c),
            "shortfall": supply.shortfall(c),
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
            "dataOrigin": c.data_origin,
            "districtId": c.district_id,
            "districtName": c.district.name if c.district else None,
            "stateName": plain_name(c.state.name) if c.state else None,
            "crisisScore": round(c.crisis_score or 0),
            "settlementType": c.settlement_type or None,
            "source": c.source or None,
            "sourceUrl": c.source_url or None,
            "demandBasis": c.demand_basis or None,
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
        "dataOrigin": r.data_origin,
        "fulfilledAt": iso(r.fulfilled_at),
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
        "dataOrigin": c.data_origin,
    }


def depot_view(d: Depot | None) -> dict | None:
    return {"id": d.id, "name": d.name, "lat": d.lat, "lng": d.lng, "dataOrigin": d.data_origin,
            "stockLitres": d.stock_litres, "stockUpdatedAt": iso(d.stock_updated_at),
            "isActive": d.is_active, "placementNote": d.placement_note} if d else None


def tanker_views(db: Session) -> list[dict]:
    """Vehicle list. Position/liveness come exclusively from accepted telemetry (see services.tracking)."""
    from ..domain import TRIP_OPEN
    from .tracking import active_trip, vehicle_view

    ops = get_setting(db, "operations")
    now = utcnow()
    out = []
    for t in db.scalars(select(Tanker).order_by(Tanker.id)):
        trip = active_trip(db, t.id, TRIP_OPEN)
        v = vehicle_view(t, ops, trip, now)
        stops = trip.stops if trip else []
        v.update({
            "id": t.id,
            "vehicleNumber": t.vehicle_number,
            "driverPhone": t.driver_phone,
            "capacity": t.capacity,
            "currentLoad": t.current_load,
            "isDisrupted": t.status == "Maintenance" and bool(t.breakdown_note),
            "breakdownNote": t.breakdown_note,
            "activeTripId": trip.code if trip else None,
            "routeWaypoints": trip.route_geometry if trip else [],
            "stops": [s.community.name for s in stops],
            "progressPercent": round(100 * sum(s.status in ("Delivered", "Verified") for s in stops) / len(stops)) if stops else 0,
            "depot": depot_view(t.depot),
            "dataOrigin": t.data_origin,
        })
        out.append(v)
    return out


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
        "photoUrl": f"/api/deliveries/{d.code}/photo" if d.photo_path else None,
        "signatureUrl": f"/api/deliveries/{d.code}/signature" if d.signature_path else None,
        "tripMinutes": d.trip_minutes,
        "tripId": f"TR-{3000 + d.trip_id}" if d.trip_id else None,
        "receiverName": d.receiver_name,
        "receiverPhone": d.receiver_phone,
        "verifiedAt": iso(d.verified_at),
        "verificationNotes": d.verification_notes,
        "gpsDeviceTime": iso(d.gps_device_time),
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
