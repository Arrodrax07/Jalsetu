"""Import India state (ADM1) and district (ADM2) boundaries from geoBoundaries (gbOpen).

Licences (verified 2026-10-02 via the geoBoundaries API): ADM1 CC BY 2.5 IN (DataMeet / Election
Commission of India); ADM2 ODbL 1.0 (Pathways Data / lgdirectory.gov.in). Note: these community
datasets do not necessarily match Survey of India's official depiction of international boundaries.
LGD codes are not included; ``import_lgd_csv`` attaches them from an official LGD export.
"""
from __future__ import annotations

import csv
import logging
import re
from pathlib import Path

from shapely.geometry import shape
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Community, GeoDistrict, GeoState, IngestionRun, utcnow
from ..services import geography
from ..services.geo import simplified, summary
from .base import http_get, run

log = logging.getLogger("jalsetu.ingestion.geo")
API = "https://www.geoboundaries.org/api/current/gbOpen/IND/{level}/"


def _features(level: str) -> tuple[dict, list[dict]]:
    meta = http_get(API.format(level=level), timeout=30).json()
    fc = http_get(meta["simplifiedGeometryGeoJSON"], timeout=120).json()
    return meta, fc["features"]


def _valid(geom):
    g = shape(geom)
    return g if g.is_valid else g.buffer(0)


def ingest(db: Session, rec: IngestionRun) -> None:
    now = utcnow()
    meta1, states = _features("ADM1")
    meta2, districts = _features("ADM2")
    rec.fetched = len(states) + len(districts)
    state_shapes = []
    for f in states:
        g = _valid(f["geometry"])
        ext = f["properties"]["shapeID"]
        row = db.scalar(select(GeoState).where(GeoState.external_id == ext)) or GeoState(external_id=ext)
        created = row.id is None
        row.name = f["properties"]["shapeName"]
        row.geometry = simplified(g, 0.01)
        row.bbox, row.centroid_lat, row.centroid_lng = summary(g)
        row.source, row.source_url = "geoBoundaries gbOpen IND ADM1", meta1["simplifiedGeometryGeoJSON"]
        row.license, row.retrieved_at = meta1.get("boundaryLicense", ""), now
        db.add(row)
        db.flush()
        state_shapes.append((row.id, g))
        rec.created += created
        rec.updated += not created
    for f in districts:
        g = _valid(f["geometry"])
        ext = f["properties"]["shapeID"]
        row = db.scalar(select(GeoDistrict).where(GeoDistrict.external_id == ext)) or GeoDistrict(external_id=ext)
        created = row.id is None
        rp = g.representative_point()
        row.state_id = next((sid for sid, sg in state_shapes if sg.covers(rp)), None)
        row.name = f["properties"]["shapeName"]
        row.geometry = simplified(g, 0.003)
        row.bbox, row.centroid_lat, row.centroid_lng = summary(g)
        row.source, row.source_url = "geoBoundaries gbOpen IND ADM2", meta2["simplifiedGeometryGeoJSON"]
        row.license, row.retrieved_at = meta2.get("boundaryLicense", ""), now
        db.add(row)
        rec.created += created
        rec.updated += not created
    db.commit()
    geography.invalidate()
    for c in db.scalars(select(Community)):  # place existing communities in the hierarchy
        c.state_id, c.district_id = geography.locate(db, c.lat, c.lng)
    db.commit()


def run_geoboundaries(db: Session) -> IngestionRun:
    return run(db, "geoboundaries", ingest)


def _norm(s: str) -> str:
    from ..services.geo import name_key
    return name_key(s)


def import_lgd_csv(db: Session, path: Path) -> dict:
    """Attach LGD district codes from an official LGD districts CSV (lgdirectory.gov.in -> Download Directory).
    Matches on normalised (state, district) names and returns unmatched rows for manual review. Never guesses."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return {"matched": 0, "unmatched": []}
    cols = {c.lower().strip(): c for c in rows[0]}

    def pick(*names):
        return next((cols[n] for n in names if n in cols), None)

    c_code = pick("district code", "district lgd code", "districtcode", "lgd code")
    c_name = pick("district name (in english)", "district name", "districtname")
    c_state = pick("state name (in english)", "state name", "statename")
    if not (c_code and c_name):
        raise ValueError(f"CSV needs district code + name columns; found {list(rows[0])}")
    states = {s.id: _norm(s.name) for s in db.scalars(select(GeoState))}
    by_key = {(states.get(d.state_id, ""), _norm(d.name)): d for d in db.scalars(select(GeoDistrict))}
    matched, unmatched = 0, []
    for r in rows:
        st, nm = (_norm(r.get(c_state, "")) if c_state else ""), _norm(r[c_name])
        d = by_key.get((st, nm)) or next((v for (s2, n2), v in by_key.items() if n2 == nm and (not st or s2 == st)), None)
        if d:
            d.lgd_code = str(r[c_code]).strip()
            matched += 1
        else:
            unmatched.append({"code": r[c_code], "district": r[c_name], "state": r.get(c_state, "")})
    db.commit()
    return {"matched": matched, "unmatched": unmatched}
