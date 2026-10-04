"""Export simplified boundary outlines for the public landing page.

The landing page is public and cannot call the authenticated geography endpoints, so it ships a small static file:
India's state outlines and Maharashtra's district outlines (with names, to match the public rainfall-deficit list),
simplified for drawing at country scale. Reference data from geoBoundaries; attribution is embedded in the file.

    python -m scripts.export_landing_geo ../frontend/public/landing/geo.json
"""
from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

from shapely.geometry import shape
from sqlalchemy import select

from app.db import SessionLocal
from app.models import GeoDistrict, GeoState


def plain(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()


def rings(geometry: dict | None, tolerance: float, min_area: float) -> list[list[list[float]]]:
    """Exterior rings only, simplified and rounded to ~100 m; tiny islands dropped."""
    if not geometry:
        return []
    g = shape(geometry).simplify(tolerance, preserve_topology=True)
    polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    out = []
    for p in polys:
        if p.is_empty or p.area < min_area:
            continue
        out.append([[round(x, 3), round(y, 3)] for x, y in p.exterior.coords])
    return out


def main(out: str) -> None:
    with SessionLocal() as db:
        states = db.scalars(select(GeoState)).all()
        mh = next(s for s in states if plain(s.name).startswith("maharashtra"))
        districts = db.scalars(select(GeoDistrict).where(GeoDistrict.state_id == mh.id)).all()
        payload = {
            "source": "geoBoundaries IND ADM1/ADM2 (William & Mary geoLab)",
            "license": "ADM1: CC BY 2.5 IN; ADM2: ODbL 1.0",
            "note": "Reference outlines, simplified for display. Not survey-grade.",
            "states": [{"name": s.name, "rings": rings(s.geometry, 0.05, 0.02)} for s in states],
            "maharashtra": mh.name,
            "districts": [{"name": d.name, "key": plain(d.name), "c": [round(d.centroid_lng or 0, 3), round(d.centroid_lat or 0, 3)],
                           "rings": rings(d.geometry, 0.02, 0.005)} for d in districts],
        }
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    pts = sum(len(r) for s in payload["states"] for r in s["rings"]) + sum(len(r) for d in payload["districts"] for r in d["rings"])
    print(f"wrote {path} ({path.stat().st_size // 1024} KB, {len(states)} states, {len(districts)} districts, {pts} points)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/landing/geo.json")
