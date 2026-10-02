"""Health probes for sources that need credentials/agreements. They report the truth; they never fabricate data."""
from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from .base import SOURCES, ensure_source, set_status

settings = get_settings()


def probe_imd(db: Session) -> None:
    if not settings.imd_api_enabled:
        set_status(db, "imd_api", "awaiting_credentials", error="IMD API requires the server's public IP to be whitelisted. "
                   "IMD warnings currently arrive through NDMA SACHET.", access=SOURCES["imd_api"].access)
        db.commit()
        return
    try:
        r = httpx.get(f"{settings.imd_api_base}/warnings_district_api.php", timeout=15)
        if r.status_code == 401 or "whitelist" in r.text.lower():
            set_status(db, "imd_api", "awaiting_credentials", error=r.text.strip()[:300])
        elif r.status_code == 200:
            set_status(db, "imd_api", "connected")
        else:
            set_status(db, "imd_api", "degraded", error=f"HTTP {r.status_code}")
    except httpx.HTTPError as exc:
        set_status(db, "imd_api", "degraded", error=str(exc))
    db.commit()


def probe_static(db: Session) -> None:
    """Sources without a live adapter yet: state exactly what is missing."""
    if settings.cwc_api_url:
        set_status(db, "cwc_flood", "degraded", error="CWC_API_URL is set but no API contract is defined yet; awaiting CWC documentation.")
    else:
        set_status(db, "cwc_flood", "awaiting_credentials",
                   error="Formal CWC / India-WRIS data access required. CWC flood alerts already arrive via NDMA SACHET.")
    if settings.data_gov_in_api_key:
        set_status(db, "data_gov_in", "unknown", error="API key configured; no dataset adapter enabled yet.")
    else:
        set_status(db, "data_gov_in", "awaiting_credentials", error="Set DATA_GOV_IN_API_KEY (free registration at data.gov.in).")
    set_status(db, "vltd", "awaiting_credentials",
               error="No VLTD / AIS-140 backend agreement configured. Vehicles currently report via the driver's phone GPS (labelled PHONE GPS).")
    for key in ("geoboundaries", "open_meteo", "osrm", "ndma_sachet"):
        ensure_source(db, key)
    db.commit()
