"""Export the real places and the real road the landing page's camera travels along.

    python -m scripts.export_landing_journey ../frontend/public/landing/journey.json [focus] [next]

focus (default Beed): the place the film descends to. Its serving depot is the nearest active depot (the same
straight-line rule the dispatch planner starts from), and the route is the OSRM driving route depot -> place on
OpenStreetMap roads. next (default: the place with the highest planner priority after the focus): where the camera
dives again after pulling back out to the atmosphere.

The file is a dated snapshot (the landing page's live numbers still come from /api/public/summary).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Community, Depot
from app.services.common import get_setting, haversine_m
from app.services.priority import score_community
from app.services.routing import Point, route_geometry
from app.services.views import priority_context


def place(c: Community) -> dict:
    return {"id": c.id, "name": c.name, "lat": round(c.lat, 5), "lng": round(c.lng, 5), "crisis": round(c.crisis_score or 0),
            "population": c.population, "district": c.district.name if c.district else None, "type": c.settlement_type}


def main(out: Path, focus_name: str = "Beed", next_name: str | None = None) -> None:
    db = SessionLocal()
    try:
        active = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
        focus = next(c for c in active if c.name.lower() == focus_name.lower())
        depots = [d for d in db.scalars(select(Depot).where(Depot.is_active.is_(True)))]
        depot = min(depots, key=lambda d: haversine_m(d.lat, d.lng, focus.lat, focus.lng))
        latlngs, dist_m, dur_s, source = route_geometry([Point("depot", depot.name, depot.lat, depot.lng), Point(focus.id, focus.name, focus.lat, focus.lng)])
        if next_name:
            nxt = next(c for c in active if c.name.lower() == next_name.lower())
        else:
            ctx, weights = priority_context(db, active), get_setting(db, "weights")
            towns = [c for c in active if c.id != focus.id and c.settlement_type in ("town", "village")]
            nxt = max(towns, key=lambda c: score_community(c, weights, ctx).score)
        data = {
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "focus": place(focus),
            "depot": {"name": depot.name, "lat": round(depot.lat, 5), "lng": round(depot.lng, 5)},
            "route": {"source": source, "km": round(dist_m / 1000, 1), "minutes": round(dur_s / 60),
                      "lngLat": [[lng, lat] for lat, lng in latlngs]},
            "next": place(nxt),
            "depots": [{"name": d.name, "lat": round(d.lat, 5), "lng": round(d.lng, 5)} for d in depots],
            "attribution": "Route: OSRM on OpenStreetMap roads (ODbL). Places: OpenStreetMap, Census 2011 populations.",
        }
    finally:
        db.close()
    out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"{data['focus']['name']} <- {data['depot']['name']}: {data['route']['km']} km ({source}, "
          f"{len(data['route']['lngLat'])} points); next: {data['next']['name']}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(Path(sys.argv[1]), *(sys.argv[2:4]))
