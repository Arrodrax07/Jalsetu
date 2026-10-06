"""Export the orbits of the satellites behind the landing page's imagery (Copernicus Sentinel-2A, 2B, 2C).

    python -m scripts.export_landing_satellites ../frontend/public/landing/satellites.json

Fetches each satellite's current mean orbital elements (CCSDS OMM as JSON) from CelesTrak and writes them with
the fetch date. The landing page propagates them itself (two-body orbit plus the J2 drift of the orbit plane), which
is good to a few tens of kilometres for weeks around the epoch: enough to draw where the satellites really are.
Re-run before a presentation to refresh the elements.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

SATELLITES = {40697: "Sentinel-2A", 42063: "Sentinel-2B", 60989: "Sentinel-2C"}
KEYS = ("EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "REV_AT_EPOCH")


def main(out: Path) -> None:
    sats = []
    with httpx.Client(timeout=30) as http:
        for norad, name in SATELLITES.items():
            r = http.get("https://celestrak.org/NORAD/elements/gp.php", params={"CATNR": norad, "FORMAT": "JSON"})
            r.raise_for_status()
            gp = r.json()[0]
            sats.append({"name": name, "norad": norad, **{k.lower(): gp[k] for k in KEYS}})
            print(f"{name}: epoch {gp['EPOCH']}")
    out.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "CelesTrak GP data (mean elements, CCSDS OMM)",
        "satellites": sats,
    }, indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/public/landing/satellites.json"))
