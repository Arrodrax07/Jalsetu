"""Site tanker depots on real water infrastructure, close to where water is needed.

Greedy k-median: candidates are imported ``WaterSource`` records (treatment plants, covered reservoirs,
water points, pumping stations, named dams and reservoirs; never sewage/drainage works). Each community
in crisis (crisis_score >= CRISIS_MIN) weighs in with crisis_score x sqrt(population): tanker relief
mostly reaches villages and small towns, and weighting by raw litres would let one megacity pull every
depot towards it. We repeatedly add the candidate that most reduces
sum(weight x min(distance to nearest chosen depot, CAP_KM)). Distances are straight-line; trips are routed on real roads at dispatch.

Re-siting deactivates earlier auto-sited depots that are no longer chosen (history keeps them) and
spreads Available tankers over the new depots in proportion to the need each one serves.
"""
from __future__ import annotations

import math
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import TANKER_AVAILABLE
from ..models import Community, Depot, GeoDistrict, Tanker, WaterSource
from . import supply
from .common import haversine_m
from .geo import name_key
from .realtime import hub

CRISIS_MIN = 30.0
CAP_KM = 150.0
SERVICE_KM = 75.0
NOT_DRINKING = ("sewage", "sewer", "drainage", "nala", "nallah", "effluent", "stp", "waste", "rainwater")
GENERIC_NAMES = {"well", "watertank", "watertower", "tank", "reservoir", "waterworks", "waterpurificationplant",
                 "watertreatmentplant", "pumphouse", "pumpingstation"}


def usable(w: WaterSource) -> bool:
    n = w.name.lower()
    return not any(re.search(r"\b" + x + r"\b", n) for x in NOT_DRINKING) and name_key(w.name) != "well"


def label(w: WaterSource, district: GeoDistrict | None) -> str:
    generic = name_key(w.name) in GENERIC_NAMES or "unnamed" in w.name
    base = w.kind.replace("_", " ").capitalize() if generic else w.name
    return f"{base}, {district.name}" if district and (generic or district.name.lower() not in w.name.lower()) else base


def choose(cands: list[tuple[int, float, float]], demand: list[tuple[str, float, float, float]], k: int) -> list[int]:
    """Pure greedy k-median. cands: (id, lat, lng); demand: (id, lat, lng, weight). Returns chosen candidate ids."""
    if not cands or not demand:
        return []
    dist = {c[0]: [min(CAP_KM, haversine_m(c[1], c[2], d[1], d[2]) / 1000) for d in demand] for c in cands}
    best = [CAP_KM] * len(demand)
    chosen: list[int] = []
    for _ in range(min(k, len(cands))):
        def cost(cid: int) -> float:
            return sum(w * min(b, x) for (_, _, _, w), b, x in zip(demand, best, dist[cid]))
        pick = min((c[0] for c in cands if c[0] not in chosen), key=cost)
        chosen.append(pick)
        best = [min(b, x) for b, x in zip(best, dist[pick])]
    return chosen


def site_depots(db: Session, k: int | None = None, keep_tankers: tuple[str, ...] = ()) -> dict:
    k = k or 6
    sources = [w for w in db.scalars(select(WaterSource).where(WaterSource.data_origin == "external")) if usable(w)]
    need = [c for c in db.scalars(select(Community).where(Community.is_active.is_(True), Community.crisis_score >= CRISIS_MIN))
            if supply.tanker_need(c) > 0]
    demand = [(c.id, c.lat, c.lng, c.crisis_score * math.sqrt(c.population)) for c in need]
    picked = choose([(w.id, w.lat, w.lng) for w in sources], demand, k)
    if not picked:
        return {"depots": [], "note": "No communities in crisis or no water sources imported"}
    ws = {w.id: w for w in sources}

    # Serve each crisis community from its nearest chosen site.
    served: dict[int, list[Community]] = {p: [] for p in picked}
    for c in need:
        p = min(picked, key=lambda i: haversine_m(ws[i].lat, ws[i].lng, c.lat, c.lng))
        served[p].append(c)

    existing = {d.water_source_id: d for d in db.scalars(select(Depot).where(Depot.water_source_id.is_not(None)))}
    depots: list[tuple[Depot, list[Community]]] = []
    for p in picked:
        w, comms = ws[p], served[p]
        near = [c for c in comms if haversine_m(w.lat, w.lng, c.lat, c.lng) <= SERVICE_KM * 1000]
        mean_km = (sum(haversine_m(w.lat, w.lng, c.lat, c.lng) for c in comms) / len(comms) / 1000) if comms else 0
        d = existing.get(p) or Depot(water_source_id=p, data_origin="external")
        district = db.get(GeoDistrict, w.district_id) if w.district_id else None
        d.name = f"{label(w, district)} depot"[:120]
        d.lat, d.lng, d.district_id, d.is_active = w.lat, w.lng, w.district_id, True
        d.placement_note = (f"Auto-sited on {w.kind.replace('_', ' ')} '{w.name}' ({w.source}, {w.source_url}). Nearest depot for "
                            f"{len(comms)} communities in crisis ({sum(c.population for c in comms):,} people, "
                            f"{sum(supply.tanker_need(c) for c in comms):,} L/day tanker need); {len(near)} within {SERVICE_KM:.0f} km; "
                            f"mean distance {mean_km:.0f} km{f'; {district.name} district' if district else ''}.")
        db.add(d)
        depots.append((d, comms))
    for d in existing.values():
        if d.water_source_id not in picked:
            d.is_active = False
    db.flush()

    # Spread Available tankers over depots in proportion to the need they serve (largest remainder).
    tankers = [t for t in db.scalars(select(Tanker).where(Tanker.status == TANKER_AVAILABLE).order_by(Tanker.id)) if t.id not in keep_tankers]
    weights = [sum(c.crisis_score * math.sqrt(c.population) for c in comms) for _, comms in depots]
    total = sum(weights) or 1
    quota = [len(tankers) * w / total for w in weights]
    counts = [int(q) for q in quota]
    for i in sorted(range(len(depots)), key=lambda i: quota[i] - counts[i], reverse=True)[: len(tankers) - sum(counts)]:
        counts[i] += 1
    it = iter(tankers)
    moved = []
    for (d, _), n in zip(depots, counts):
        for _ in range(n):
            t = next(it)
            t.depot_id = d.id
            moved.append({"tanker": t.vehicle_number, "depot": d.name})
    db.commit()
    hub.publish("tankers.changed")
    return {"depots": [{"id": d.id, "name": d.name, "note": d.placement_note} for d, _ in depots], "tankersMoved": moved,
            "keptInPlace": list(keep_tankers)}
