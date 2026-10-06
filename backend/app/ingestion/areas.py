"""Import areas inside Maharashtra's big cities (OpenStreetMap suburbs, neighbourhoods and quarters).

    python -m app.ingestion areas

Each area becomes a community at level ``area`` linked to its city (``parent_id``). Which city: the nearest active
city of at least 300,000 people, if the area lies within that city's reach (3 km x sqrt(population / 100,000),
capped at 22 km). A city is split only when it has at least 5 areas.

Population: OpenStreetMap rarely tags population on neighbourhoods, so each area gets an ESTIMATED share of its
city's Census population, in proportion to the built land around it (each point of the city's reach, on a 250 m grid,
counts for its nearest area if that area is within 1.2 km; sea and open land count for no one). The estimate and its basis are stored in ``demand_basis`` and ``data_origin = derived``.
Demand uses the city's per-person norm; vulnerability and the piped-supply ratio start from the city's.
Areas are imported inactive; Admin -> Settings -> Community detail switches them on.
"""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Community, IngestionRun
from ..services import geography
from ..services.geo import name_key
from .base import run
from .maharashtra import AREA, NORM_LPCD, english_name, osm_url, overpass

MIN_CITY_POP = 300_000
MIN_AREAS = 5
GRID_KM = 0.25
NEAR_KM = 1.2  # land further than this from every mapped area (sea, forest, open land) holds no one


def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    return math.hypot((lat1 - lat2) * 111.32, (lng1 - lng2) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2)))


def reach_km(population: int) -> float:
    return min(3.0 * math.sqrt(population / 100_000), 22.0)


def shares(city: Community, areas: list[tuple[float, float]]) -> list[float]:
    """Each area's share of the city: the fraction of grid points within the city's reach nearest to it."""
    r = reach_km(city.population)
    steps = int(r / GRID_KM)
    counts = [0] * len(areas)
    dlat = GRID_KM / 111.32
    dlng = GRID_KM / (111.32 * math.cos(math.radians(city.lat)))
    for i in range(-steps, steps + 1):
        for k in range(-steps, steps + 1):
            if (i * GRID_KM) ** 2 + (k * GRID_KM) ** 2 > r * r:
                continue
            lat, lng = city.lat + i * dlat, city.lng + k * dlng
            dist, best = min((_km(lat, lng, areas[n][0], areas[n][1]), n) for n in range(len(areas)))
            if dist <= NEAR_KM:
                counts[best] += 1
    total = sum(counts) or 1
    # every area keeps at least a token share, so none is left at zero people
    raw = [max(c, total * 0.002) for c in counts]
    s = sum(raw)
    return [x / s for x in raw]


def ingest(db: Session, rec: IngestionRun) -> None:
    els, fresh = overpass("places_areas", AREA + 'node["place"~"^(suburb|neighbourhood|quarter)$"]["name"](area.a);')
    rec.fetched = len(els)
    if not fresh:
        rec.error = "Overpass unreachable; used the cached OpenStreetMap response"
    cities = list(db.scalars(select(Community).where(Community.level == "settlement", Community.settlement_type == "city",
                                                     Community.population >= MIN_CITY_POP, Community.parent_id.is_(None))))
    if not cities:
        raise RuntimeError("No cities imported; run `python -m app.ingestion maharashtra` first")
    # settlements already in the list under the same name nearby are not duplicated as areas
    settled = {(name_key(c.name), round(c.lat, 2), round(c.lng, 2)) for c in db.scalars(select(Community).where(Community.level == "settlement"))}

    by_city: dict[str, list[dict]] = {}
    for el in els:
        name = english_name(el.get("tags", {}))
        if not name or "lat" not in el:
            continue
        lat, lng = el["lat"], el["lon"]
        city = min(cities, key=lambda c: _km(lat, lng, c.lat, c.lng))
        if _km(lat, lng, city.lat, city.lng) > reach_km(city.population):
            continue
        if (name_key(name), round(lat, 2), round(lng, 2)) in settled:
            continue
        group = by_city.setdefault(city.id, [])
        if any(name_key(a["name"]) == name_key(name) and _km(lat, lng, a["lat"], a["lng"]) < 1.0 for a in group):
            continue  # the same neighbourhood mapped twice
        group.append({"el": el, "name": name[:120], "lat": lat, "lng": lng, "kind": el["tags"].get("place", "suburb")})

    existing = {c.external_id: c for c in db.scalars(select(Community).where(Community.level == "area"))}
    city_by_id = {c.id: c for c in cities}
    for cid, group in by_city.items():
        if len(group) < MIN_AREAS:
            rec.unchanged += len(group)
            continue
        city = city_by_id[cid]
        lpcd = NORM_LPCD.get(city.settlement_type, NORM_LPCD["city"])[0]
        supplied = (city.baseline_supply / city.daily_demand) if city.daily_demand else 1.0
        for a, share in zip(group, shares(city, [(a["lat"], a["lng"]) for a in group])):
            el = a["el"]
            ext = f"osm:{el['type']}/{el['id']}"
            pop = max(50, round(city.population * share))
            demand = pop * lpcd
            row = existing.get(ext)
            if row is None:
                row = Community(id=f"osm-{el['type'][0]}{el['id']}", external_id=ext, level="area", is_active=False,
                                allocated_water=0, previous_allocation=0, data_origin="derived")
                db.add(row)
                rec.created += 1
            else:
                rec.updated += 1
            state_id, district_id = geography.locate(db, a["lat"], a["lng"])
            row.name, row.lat, row.lng, row.parent_id = a["name"], a["lat"], a["lng"], city.id
            row.settlement_type = a["kind"]
            row.population, row.daily_demand = pop, demand
            row.baseline_supply = round(demand * supplied)
            row.vulnerability_score = city.vulnerability_score
            row.crisis_score = city.crisis_score
            row.state_id, row.district_id = state_id or city.state_id, district_id or city.district_id
            row.ward = city.name
            row.source, row.source_url = "OpenStreetMap place (suburb/neighbourhood)", osm_url(el)
            row.demand_basis = (f"ESTIMATE: {share * 100:.1f}% of {city.name}'s {city.population:,} people (Census 2011), "
                                f"split across its {len(group)} OpenStreetMap areas by land area; x {lpcd} L/day")
    db.commit()


def run_areas(db: Session) -> IngestionRun:
    return run(db, "osm_areas", ingest)
