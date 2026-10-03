"""Import Maharashtra's real settlements and water infrastructure from OpenStreetMap.

Communities: every city/town, plus every village/suburb/hamlet, that carries a usable ``population``
tag (in India these are mostly Census 2011 figures added by mappers). Places without a population are
skipped rather than guessed. Each row links back to its OSM object.

Derived numbers are labelled, never presented as measured:
* daily_demand   = population x official norm: 135 L/person/day for cities and suburbs (CPHEEO,
                   metropolitan with sewerage), 70 for towns (CPHEEO, without sewerage), 55 for villages
                   and hamlets (Jal Jeevan Mission). Recorded in ``demand_basis``.
* vulnerability  = settlement-type baseline (rural 65-70, town 50, city 35-40) until socio-economic
                   data (SECC / NFHS) is attached. Live crisis signals are scored separately.
* baseline_supply starts equal to demand (no shortage known); services.crisis lowers it from evidence.

Water sources: water works, covered reservoirs, water points and named dams/reservoirs/pumping stations
(unnamed water towers are distribution, not tanker filling points, and are skipped).

Overpass is flaky for large queries, so the import uses several small queries, rotates between
mirrors with back-off, and caches every raw response under ``var/cache``. If Overpass is down, the
last cached response is used and the run is marked degraded.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Community, GeoDistrict, GeoState, IngestionRun, WaterSource
from ..services import geography
from ..services.geo import name_key
from .base import run

log = logging.getLogger("jalsetu.ingestion.maharashtra")

MIRRORS = ("https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter",
           "https://overpass-api.de/api/interpreter")
CACHE = Path(__file__).resolve().parents[2] / "var" / "cache"
AREA = 'area["ISO3166-2"="IN-MH"]->.a;'
QUERIES = {
    "places_towns": AREA + 'node["place"~"^(city|town)$"](area.a);',
    "places_villages": AREA + 'node["place"~"^(village|suburb|hamlet)$"]["population"](area.a);',
    "water_sources": AREA + '(nwr["man_made"~"^(water_works|reservoir_covered|pumping_station)$"](area.a);'
                            'nwr["amenity"="water_point"](area.a);nwr["water"="reservoir"]["name"](area.a);'
                            'nwr["waterway"="dam"]["name"](area.a););',
}

NORM_LPCD = {"city": (135, "CPHEEO norm, city with sewerage"), "suburb": (135, "CPHEEO norm, city with sewerage"),
             "town": (70, "CPHEEO norm, town without sewerage"), "village": (55, "Jal Jeevan Mission rural norm"),
             "hamlet": (55, "Jal Jeevan Mission rural norm")}
VULNERABILITY_BASELINE = {"city": 35.0, "suburb": 40.0, "town": 50.0, "village": 65.0, "hamlet": 70.0}
MIN_POPULATION = 100
STATE_NAME = "maharashtra"


def overpass(name: str, body: str, *, max_age_s: float = 7 * 86400) -> tuple[list[dict], bool]:
    """(elements, fresh). Falls back to the cached response when every mirror fails."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"osm_mh_{name}.json"
    if path.exists() and time.time() - path.stat().st_mtime < max_age_s:
        return json.loads(path.read_text(encoding="utf-8"))["elements"], True
    query = f"[out:json][timeout:170];{body}out tags center;"
    last: Exception | None = None
    for attempt in range(6):
        for url in MIRRORS:
            try:
                r = httpx.post(url, data={"data": query}, timeout=180,
                               headers={"User-Agent": "JalSetu/1.0 (municipal water operations; ingestion)"})
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    data = r.json()
                    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                    return data["elements"], True
                last = RuntimeError(f"{url}: HTTP {r.status_code} {r.text[:120]!r}")
            except (httpx.HTTPError, ValueError) as exc:
                last = exc
            time.sleep(min(20, 3 * (attempt + 1)))
    if path.exists():
        log.warning("Overpass unavailable (%s); using cached %s", last, path.name)
        return json.loads(path.read_text(encoding="utf-8"))["elements"], False
    raise RuntimeError(f"Overpass unavailable and no cache for {name}: {last}")


def parse_population(tags: dict) -> int | None:
    raw = (tags.get("population") or tags.get("census:population") or "").replace(",", "").strip()
    return int(raw) if re.fullmatch(r"\d{1,9}", raw) else None


def osm_url(el: dict) -> str:
    return f"https://www.openstreetmap.org/{el['type']}/{el['id']}"


def point(el: dict) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def english_name(tags: dict) -> str:
    return (tags.get("name:en") or tags.get("name") or "").strip()


def community_fields(el: dict) -> dict | None:
    """Pure mapping from one OSM place node to Community fields (None when unusable)."""
    tags = el.get("tags", {})
    kind = tags.get("place")
    pop, name, pt = parse_population(tags), english_name(tags), point(el)
    if kind not in NORM_LPCD or not name or not pt or pop is None or pop < MIN_POPULATION:
        return None
    lpcd, basis = NORM_LPCD[kind]
    demand = pop * lpcd
    return {
        "id": f"osm-{el['type'][0]}{el['id']}",
        "external_id": f"osm:{el['type']}/{el['id']}",
        "name": name[:120],
        "settlement_type": kind,
        "population": pop,
        "daily_demand": demand,
        "demand_basis": f"{pop:,} people x {lpcd} L/day ({basis})",
        "vulnerability_score": VULNERABILITY_BASELINE[kind],
        "lat": pt[0], "lng": pt[1],
        "source": "OpenStreetMap place + population tag" + (f" ({tags['source:population']})" if tags.get("source:population") else ""),
        "source_url": osm_url(el),
    }


WATER_KIND = {"water_works": "treatment_plant", "reservoir_covered": "covered_reservoir", "pumping_station": "pumping_station",
              "water_point": "water_point", "reservoir": "reservoir", "dam": "dam"}


def water_source_fields(el: dict) -> dict | None:
    tags = el.get("tags", {})
    raw = tags.get("man_made") or tags.get("amenity") or ("reservoir" if tags.get("water") == "reservoir" else tags.get("waterway"))
    kind, pt = WATER_KIND.get(raw or ""), point(el)
    if not kind or not pt:
        return None
    name = english_name(tags)
    if not name and kind in ("pumping_station", "reservoir", "dam"):
        return None
    label = {"treatment_plant": "Water treatment plant", "covered_reservoir": "Covered reservoir", "water_point": "Water point"}.get(kind, kind)
    return {"external_id": f"osm:{el['type']}/{el['id']}", "name": (name or f"{label} (unnamed)")[:160], "kind": kind,
            "lat": pt[0], "lng": pt[1], "source": "OpenStreetMap", "source_url": osm_url(el)}


def _state_id(db: Session) -> int | None:
    return next((s.id for s in db.scalars(select(GeoState)) if name_key(s.name) == STATE_NAME), None)


def ingest(db: Session, rec: IngestionRun, retire_seeded: bool = True) -> None:
    towns, fresh1 = overpass("places_towns", QUERIES["places_towns"])
    villages, fresh2 = overpass("places_villages", QUERIES["places_villages"])
    water, fresh3 = overpass("water_sources", QUERIES["water_sources"])
    rec.fetched = len(towns) + len(villages) + len(water)
    if not (fresh1 and fresh2 and fresh3):
        rec.error = "Overpass unreachable for part of the run; used cached OpenStreetMap responses"
    mh = _state_id(db)
    if mh is None:
        raise RuntimeError("State boundaries not imported; run `python -m app.ingestion geography` first")

    existing = {c.external_id: c for c in db.scalars(select(Community).where(Community.external_id.is_not(None)))}
    seen: set[str] = set()
    for el in towns + villages:
        f = community_fields(el)
        if not f or f["external_id"] in seen:
            rec.unchanged += 1
            continue
        state_id, district_id = geography.locate(db, f["lat"], f["lng"])
        if state_id != mh:  # Overpass area edges can include neighbours' border villages
            continue
        seen.add(f["external_id"])
        district = db.get(GeoDistrict, district_id) if district_id else None
        row = existing.get(f["external_id"])
        if row is None:
            row = Community(id=f["id"], allocated_water=0, previous_allocation=0, baseline_supply=f["daily_demand"],
                            data_origin="external", is_active=True)
            db.add(row)
            rec.created += 1
        else:
            rec.updated += 1
        for k in ("external_id", "name", "settlement_type", "population", "daily_demand", "demand_basis",
                  "vulnerability_score", "lat", "lng", "source", "source_url"):
            setattr(row, k, f[k])
        row.state_id, row.district_id = state_id, district_id
        row.ward = district.name if district else ""
        row.baseline_supply = min(row.baseline_supply or f["daily_demand"], f["daily_demand"])
    db.flush()

    ws_existing = {w.external_id: w for w in db.scalars(select(WaterSource).where(WaterSource.external_id.is_not(None)))}
    for el in water:
        f = water_source_fields(el)
        if not f:
            continue
        state_id, district_id = geography.locate(db, f["lat"], f["lng"])
        if state_id != mh:
            continue
        row = ws_existing.get(f["external_id"]) or WaterSource(data_origin="external")
        for k, v in f.items():
            setattr(row, k, v)
        row.district_id = district_id
        db.add(row)
        ws_existing[f["external_id"]] = row

    if retire_seeded:  # reference communities from the single-city demo; kept for history, hidden from operations
        for c in db.scalars(select(Community).where(Community.data_origin == "seeded", Community.is_active.is_(True))):
            c.is_active = False
    db.commit()


def run_maharashtra(db: Session) -> IngestionRun:
    return run(db, "osm_maharashtra", ingest)
