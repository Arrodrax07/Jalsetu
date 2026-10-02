"""Disaster intelligence: official alerts (as published), their operational impact, and explainable recommendations.

The issuing authority decides whether an event exists. JalSetu only intersects it with its own records.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import TANKER_AVAILABLE, TRIP_OPEN
from ..ingestion.sachet import SEVERITY_RANK, is_active
from ..models import Community, Depot, DisasterEvent, Recommendation, Tanker, Trip, User, WaterRequest, utcnow
from ..schemas import AckIn
from ..security import actor_from, require
from ..services.common import audit, get_setting, haversine_m
from ..services.geo import contains, line_intersects
from ..services.realtime import hub
from ..services.views import iso

router = APIRouter(tags=["disaster intelligence"])

WATER_GUIDANCE = {
    "flood": "Flooding can contaminate wells, borewells and piped supply. Standard practice: prioritise safe drinking water by tanker and schedule water-quality testing in affected communities.",
    "flash_flood": "Flash floods can cut roads and contaminate sources. Verify route passability before dispatch and prioritise safe drinking water.",
    "cyclone": "Cyclones disrupt power-dependent pumping and roads. Pre-position tanker capacity at depots outside the impact zone.",
    "heavy_rainfall": "Heavy rain may cause local waterlogging and source turbidity. Check route passability and water quality.",
    "heatwave": "Heatwaves raise drinking-water demand. Prioritise vulnerable communities and increase trips where capacity allows.",
    "drought": "Drought reduces local sources. Expect sustained tanker dependency; plan multi-day allocation.",
    "landslide": "Landslides block hill roads. Confirm route status before dispatch.",
}


def event_view(e: DisasterEvent, now=None) -> dict:
    now = now or utcnow()
    return {
        "id": e.id, "source": e.source, "sourceLabel": "NDMA SACHET" if e.source == "ndma_sachet" else e.source,
        "externalId": e.external_id, "provider": e.provider, "sourceUrl": e.source_url,
        "eventType": e.event_type, "eventRaw": e.event_raw, "category": e.category,
        "severity": e.severity, "urgency": e.urgency, "certainty": e.certainty, "msgType": e.msg_type,
        "headline": e.headline, "description": e.description, "instruction": e.instruction, "areaDesc": e.area_desc,
        "lgdDistrictCodes": e.lgd_district_codes, "hasGeometry": e.geometry is not None, "geometryStatus": e.geometry_status,
        "bbox": e.bbox, "centroid": None if e.centroid_lat is None else [e.centroid_lat, e.centroid_lng],
        "effectiveAt": iso(e.effective_at), "onsetAt": iso(e.onset_at), "expiresAt": iso(e.expires_at),
        "publishedAt": iso(e.published_at), "retrievedAt": iso(e.retrieved_at), "lastUpdated": iso(e.last_updated),
        "status": "active" if is_active(e, now) else ("cancelled" if e.msg_type == "Cancel" else "expired"),
        "acknowledgedBy": e.acknowledged_by, "acknowledgedAt": iso(e.acknowledged_at),
        "dataOrigin": "external",
    }


def _active_q(now):
    return select(DisasterEvent).where(DisasterEvent.msg_type != "Cancel", or_(DisasterEvent.expires_at.is_(None), DisasterEvent.expires_at > now))


@router.get("/disasters")
def list_events(status: str = Query("active", pattern="^(active|all)$"), event_type: str | None = None, min_severity: str | None = None,
                limit: int = 200, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    now = utcnow()
    q = _active_q(now) if status == "active" else select(DisasterEvent).where(DisasterEvent.published_at >= now - timedelta(days=7))
    if event_type:
        q = q.where(DisasterEvent.event_type == event_type)
    rows = list(db.scalars(q.order_by(DisasterEvent.published_at.desc()).limit(min(max(limit, 1), 1000))))
    if min_severity:
        rows = [r for r in rows if SEVERITY_RANK.get(r.severity, 0) >= SEVERITY_RANK.get(min_severity, 0)]
    return [event_view(e, now) for e in rows]


@router.get("/disasters/geojson")
def events_geojson(db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    """Active alert areas for the map (simplified polygons only; centroid points for alerts without geometry)."""
    now = utcnow()
    feats = []
    for e in db.scalars(_active_q(now)):
        props = {"id": e.id, "eventType": e.event_type, "severity": e.severity, "rank": SEVERITY_RANK.get(e.severity, 0),
                 "headline": e.headline[:200], "provider": e.provider}
        if e.geometry:
            feats.append({"type": "Feature", "geometry": e.geometry, "properties": props})
    return {"type": "FeatureCollection", "features": feats}


@router.get("/disasters/{event_id}")
def get_event(event_id: int, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    e = db.get(DisasterEvent, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    return {**event_view(e), "geometry": e.geometry}


def compute_impact(db: Session, e: DisasterEvent) -> dict:
    """Pure intersection of the official alert area with JalSetu records. Every number is a count of real rows."""
    ops = get_setting(db, "operations")
    codes = set(e.lgd_district_codes or [])
    method = "polygon" if e.geometry else ("lgd_district_codes" if codes else "none")

    def affected(c: Community) -> bool:
        if e.geometry:
            return contains(e.geometry, c.lat, c.lng, e.bbox)
        return bool(codes and c.district and c.district.lgd_code in codes)

    comms = [c for c in db.scalars(select(Community).where(Community.is_active.is_(True))) if affected(c)]
    ids = {c.id for c in comms}
    reqs = list(db.scalars(select(WaterRequest).where(WaterRequest.community_id.in_(ids), WaterRequest.status.in_(("Pending", "Allocated", "Dispatched"))))) if ids else []
    vulnerable = [c for c in comms if c.vulnerability_score >= ops["protectVulnerabilityAbove"]]

    trips_hit = []
    for t in db.scalars(select(Trip).where(Trip.status.in_(TRIP_OPEN))):
        stop_hit = any(s.community_id in ids for s in t.stops)
        route_hit = bool(e.geometry and line_intersects(e.geometry, t.route_geometry, e.bbox))
        if stop_hit or route_hit:
            trips_hit.append({"id": t.code, "status": t.status, "vehicle": t.tanker.vehicle_number, "routeIntersects": route_hit, "stopInArea": stop_hit})

    # Reference point: alert centroid, else centroid of affected communities.
    ref = (e.centroid_lat, e.centroid_lng) if e.centroid_lat is not None else (
        (sum(c.lat for c in comms) / len(comms), sum(c.lng for c in comms) / len(comms)) if comms else None)
    radius_km = 50
    tankers, depots = [], []
    if ref:
        for t in db.scalars(select(Tanker).where(Tanker.status == TANKER_AVAILABLE)):
            pos, basis = ((t.lat, t.lng), "last GPS fix") if t.lat is not None else (((t.depot.lat, t.depot.lng), "home depot") if t.depot else (None, None))
            if pos is None:
                continue
            km = haversine_m(ref[0], ref[1], pos[0], pos[1]) / 1000
            if km <= radius_km:
                tankers.append({"id": t.id, "vehicle": t.vehicle_number, "capacity": t.capacity, "distanceKm": round(km, 1), "basis": basis})
        for d in db.scalars(select(Depot)):
            km = haversine_m(ref[0], ref[1], d.lat, d.lng) / 1000
            if km <= radius_km:
                depots.append({"id": d.id, "name": d.name, "distanceKm": round(km, 1), "stockLitres": d.stock_litres})
    tankers.sort(key=lambda x: x["distanceKm"])
    depots.sort(key=lambda x: x["distanceKm"])

    return {
        "eventId": e.id, "method": method, "radiusKm": radius_km,
        "communities": [{"id": c.id, "name": c.name, "population": c.population, "vulnerabilityScore": c.vulnerability_score,
                         "dataOrigin": c.data_origin, "shortfall": max(0, c.daily_demand - c.allocated_water)} for c in comms],
        "populationInRecords": sum(c.population for c in comms),
        "openRequests": [{"id": r.code, "community": r.community.name, "litres": r.requested_amount, "status": r.status, "priority": r.priority_score} for r in reqs],
        "openRequestLitres": sum(r.requested_amount for r in reqs),
        "vulnerableCommunities": [c.name for c in vulnerable],
        "tripsAffected": trips_hit,
        "availableTankersNearby": tankers,
        "depotsNearby": depots,
        "computedAt": iso(utcnow()),
    }


def build_recommendation(e: DisasterEvent, imp: dict) -> tuple[str, list[str], list[dict]]:
    n_c, n_r, n_t, n_trip = len(imp["communities"]), len(imp["openRequests"]), len(imp["availableTankersNearby"]), len(imp["tripsAffected"])
    src = f"{e.provider} via NDMA SACHET"
    factors = [
        {"factor": "Official alert", "value": f"{e.severity} {e.event_raw or e.event_type} — {e.area_desc[:160]}", "source": src},
        {"factor": "Alert validity", "value": f"{iso(e.onset_at) or '?'} → {iso(e.expires_at) or 'open-ended'}", "source": src},
        {"factor": "Area matching", "value": {"polygon": "alert polygon", "lgd_district_codes": "LGD district codes", "none": "no area information"}[imp["method"]], "source": "JalSetu geometry check"},
        {"factor": "Registered communities in area", "value": n_c, "source": "JalSetu database"},
        {"factor": "Open water requests in area", "value": f"{n_r} ({imp['openRequestLitres']:,} L)", "source": "JalSetu database"},
        {"factor": "High-vulnerability communities in area", "value": len(imp["vulnerableCommunities"]), "source": "JalSetu database"},
        {"factor": f"Available tankers within {imp['radiusKm']} km", "value": n_t, "source": "JalSetu fleet state"},
        {"factor": "Open trips touching the area", "value": n_trip, "source": "JalSetu trips + planned routes"},
    ]
    actions: list[str] = []
    if n_c == 0:
        headline = "No registered communities inside the alert area. Monitor the alert."
        if imp["method"] == "none":
            actions.append("Alert has no polygon or district codes; impact cannot be computed automatically. Review the official alert text.")
        return headline, actions, factors
    headline = f"{e.severity} {e.event_type.replace('_', ' ')} alert affects {n_c} registered communit{'y' if n_c == 1 else 'ies'}"
    if n_r:
        top = sorted(imp["openRequests"], key=lambda r: -r["priority"])[:3]
        actions.append(f"Prioritise {n_r} open request(s) in the area ({imp['openRequestLitres']:,} L), starting with " + ", ".join(f"{r['id']} ({r['community']})" for r in top) + ".")
    if imp["vulnerableCommunities"]:
        actions.append("Protect high-vulnerability communities first: " + ", ".join(imp["vulnerableCommunities"][:5]) + ".")
    if n_t:
        t0 = imp["availableTankersNearby"][0]
        actions.append(f"{n_t} available tanker(s) within {imp['radiusKm']} km; nearest {t0['vehicle']} at {t0['distanceKm']} km ({t0['basis']}). Consider assigning to the affected communities.")
    elif n_r:
        actions.append(f"No available tanker within {imp['radiusKm']} km. Consider re-assigning capacity from lower-priority trips or requesting mutual aid.")
    if n_trip:
        actions.append(f"Review {n_trip} open trip(s) touching the alert area; confirm route safety with drivers before continuing.")
    if e.event_type in WATER_GUIDANCE:
        actions.append(WATER_GUIDANCE[e.event_type] + " (standard operating guidance, not derived from this alert)")
    return headline, actions, factors


@router.get("/disasters/{event_id}/impact")
def impact(event_id: int, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    e = db.get(DisasterEvent, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    imp = compute_impact(db, e)
    headline, actions, factors = build_recommendation(e, imp)
    return {**imp, "recommendation": {"headline": headline, "actions": actions, "factors": factors, "kind": "RULE-BASED"}}


@router.post("/disasters/{event_id}/recommendations", status_code=201)
def save_recommendation(event_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require("acknowledge"))):
    """Freeze the current recommendation with the full fact snapshot it was derived from (for audit)."""
    e = db.get(DisasterEvent, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    imp = compute_impact(db, e)
    headline, actions, factors = build_recommendation(e, imp)
    rec = Recommendation(event_id=e.id, created_by=user.name, headline=headline, actions=actions, factors=factors,
                         snapshot={"event": event_view(e), "impact": imp})
    db.add(rec)
    db.flush()
    audit(db, actor_from(request, user), "recommendation.create", "disaster", e.id, {"recommendation": rec.id, "headline": headline})
    db.commit()
    return {"id": rec.id, "createdAt": iso(rec.created_at), "headline": headline, "actions": actions, "factors": factors}


@router.get("/recommendations")
def list_recommendations(limit: int = 50, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    return [{"id": r.id, "eventId": r.event_id, "createdAt": iso(r.created_at), "createdBy": r.created_by, "headline": r.headline,
             "actions": r.actions, "factors": r.factors, "status": r.status}
            for r in db.scalars(select(Recommendation).order_by(Recommendation.created_at.desc()).limit(min(limit, 200)))]


@router.post("/disasters/{event_id}/acknowledge")
def acknowledge(event_id: int, body: AckIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require("acknowledge"))):
    e = db.get(DisasterEvent, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    before = {"acknowledgedBy": e.acknowledged_by}
    e.acknowledged_by, e.acknowledged_at = user.name, utcnow()
    audit(db, actor_from(request, user), "disaster.acknowledge", "disaster", e.id, {"note": body.note, "externalId": e.external_id},
          before=before, after={"acknowledgedBy": user.name})
    db.commit()
    hub.publish("disasters.changed")
    return event_view(e)
