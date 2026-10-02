"""Ingestion framework: source registry, run logging, retries, health status.

Every external source is described here — including the ones awaiting credentials — so the
system-health panel shows the true state of each integration instead of hiding it.
"""
from __future__ import annotations

import logging
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from ..models import DataSource, IngestionRun, utcnow

log = logging.getLogger("jalsetu.ingestion")


@dataclass(frozen=True)
class SourceSpec:
    key: str
    name: str
    provider: str
    kind: str
    url: str
    access: str            # how access is obtained
    auth: str              # auth method
    frequency: str         # expected update frequency / our polling
    license: str
    env: str = ""          # env variable(s) that enable it


SOURCES: dict[str, SourceSpec] = {s.key: s for s in [
    SourceSpec("ndma_sachet", "NDMA SACHET (CAP alerts)", "National Disaster Management Authority", "disaster_alerts",
               "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
               "Public RSS + CAP 1.2 XML per alert", "none", "continuous; polled every 5 min", "Public domain (feed declares it)",
               "SACHET_RSS_URL, SACHET_POLL_SECONDS"),
    SourceSpec("imd_api", "IMD district warnings API", "India Meteorological Department", "weather_warnings",
               "https://mausam.imd.gov.in/api/warnings_district_api.php",
               "Server public IP must be whitelisted by IMD (request via IMD / mausam.imd.gov.in)", "IP whitelist",
               "several times daily", "IMD terms of use", "IMD_API_ENABLED, IMD_API_BASE"),
    SourceSpec("cwc_flood", "CWC flood forecasting (direct)", "Central Water Commission", "river_levels",
               "https://ffs.india-water.gov.in/", "No documented public API; formal data-sharing request to CWC / India-WRIS",
               "to be issued by CWC", "hourly during monsoon", "per agreement", "CWC_API_URL"),
    SourceSpec("data_gov_in", "data.gov.in (OGD) datasets", "NIC / MeitY Open Government Data", "reference_data",
               "https://api.data.gov.in/", "Free API key after registration at data.gov.in", "api-key query parameter",
               "dataset-specific", "Government Open Data License - India", "DATA_GOV_IN_API_KEY"),
    SourceSpec("vltd", "VLTD / AIS-140 vehicle trackers", "State transport VLTD backends", "vehicle_telemetry",
               "(state-specific)", "Agreement with state transport dept. / device vendor backend", "gateway token / mTLS",
               "every 10-60 s per vehicle", "per agreement", "VLTD_GATEWAY_TOKEN"),
    SourceSpec("geoboundaries", "geoBoundaries IND ADM1/ADM2", "William & Mary geoLab (sources: DataMeet / ECI / LGD-based)", "boundaries",
               "https://www.geoboundaries.org/api/current/gbOpen/IND/", "Open download", "none", "static release",
               "ADM1: CC BY 2.5 IN; ADM2: ODbL 1.0"),
    SourceSpec("open_meteo", "Open-Meteo weather", "Open-Meteo", "weather", "https://api.open-meteo.com/",
               "Open API", "none", "hourly", "CC BY 4.0"),
    SourceSpec("osrm", "OSRM routing", "Project OSRM (public demo server)", "routing", "https://router.project-osrm.org",
               "Open demo server; self-host for production", "none", "on demand", "OSM data ODbL", "OSRM_URL"),
]}


def ensure_source(db: Session, key: str) -> DataSource:
    spec = SOURCES[key]
    row = db.get(DataSource, key)
    if row is None:
        row = DataSource(key=key, name=spec.name, provider=spec.provider, kind=spec.kind, status="unknown", detail={})
        db.add(row)
        db.flush()
    return row


def set_status(db: Session, key: str, status: str, error: str | None = None, **detail) -> None:
    row = ensure_source(db, key)
    row.status, row.last_attempt_at = status, utcnow()
    if status == "connected":
        row.last_success_at, row.last_error = utcnow(), None
    elif error:
        row.last_error = error[:2000]
    row.detail = {**(row.detail or {}), **detail}


def http_get(url: str, *, params: dict | None = None, timeout: float = 20.0, attempts: int = 3) -> httpx.Response:
    """GET with bounded exponential back-off on network errors and 5xx."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            r = httpx.get(url, params=params, timeout=timeout, follow_redirects=True,
                          headers={"User-Agent": "JalSetu/1.0 (municipal water operations; ingestion)"})
            if r.status_code >= 500:
                raise httpx.HTTPStatusError(f"{r.status_code} from {url}", request=r.request, response=r)
            return r
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            last = exc
            time.sleep(min(8, 1.5 * 2 ** i))
    raise last  # type: ignore[misc]


def run(db: Session, key: str, fn: Callable[[Session, IngestionRun], None]) -> IngestionRun:
    """Execute one ingestion job with a run record and health update. Never raises."""
    ensure_source(db, key)
    rec = IngestionRun(source_key=key, status="running")
    db.add(rec)
    db.commit()
    try:
        fn(db, rec)
        rec.status = "success"
        if rec.error:  # partial success (e.g. provider throttled part of the run)
            set_status(db, key, "degraded", error=rec.error, fetched=rec.fetched, created=rec.created)
            row = db.get(DataSource, key)
            row.last_success_at = utcnow()
        else:
            set_status(db, key, "connected", fetched=rec.fetched, created=rec.created, updated=rec.updated)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        rec = db.get(IngestionRun, rec.id)
        rec.status, rec.error = "failed", f"{type(exc).__name__}: {exc}"[:2000]
        set_status(db, key, "degraded", error=rec.error)
        log.warning("ingestion %s failed: %s\n%s", key, exc, traceback.format_exc(limit=3))
    rec.finished_at = utcnow()
    db.commit()
    return rec
