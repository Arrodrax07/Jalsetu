"""NDMA SACHET adapter: RSS -> CAP 1.2 alerts -> normalised ``DisasterEvent`` rows.

Verified 2026-10-02: the public RSS lists ~24 h of alerts; each item links to a CAP XML
(``FetchXMLFile?identifier=``) with severity/urgency/certainty, onset/expiry, LGD district
codes and a ``Polygon URL`` parameter (``FetchPolygonXMLFile``) carrying lat,lon rings.
Idempotent: keyed on the CAP identifier; re-runs only fetch new identifiers.
"""
from __future__ import annotations

import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from shapely.geometry import Polygon
from shapely.ops import unary_union
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import DisasterEvent, IngestionRun, utcnow
from ..services.geo import simplified, summary
from ..services.notify import notify
from ..services.realtime import hub
from .base import http_get, run

log = logging.getLogger("jalsetu.ingestion.sachet")
settings = get_settings()
KEY = "ndma_sachet"
CAP_NS = "{urn:oasis:names:tc:emergency:cap:1.2}"
MAX_POLYGONS_PER_RUN = 10
REQUEST_SPACING_S = 1.0  # be a polite client: the provider's firewall blocks bursts (observed HTTP 403)


class ProviderBlocked(Exception):
    pass


def _polite_get(url: str, timeout: float):
    time.sleep(REQUEST_SPACING_S)
    r = http_get(url, timeout=timeout)
    if r.status_code in (401, 403, 429):
        raise ProviderBlocked(f"HTTP {r.status_code} from provider (rate-limited or blocked): {r.text[:120]}")
    r.raise_for_status()
    return r

# Ordered: first match wins. Normalised vocabulary used by the UI and impact rules.
EVENT_RULES = [
    ("flash_flood", r"flash\s*flood"),
    ("flood", r"flood|inundat|river.*(level|danger)|water level"),
    ("cyclone", r"cyclon|depression|deep depression|storm surge"),
    ("landslide", r"landslide|mudslide|debris flow"),
    ("heatwave", r"heat\s*wave|heatwave|hot and humid|high temperature"),
    ("cold_wave", r"cold\s*wave|cold day|frost"),
    ("drought", r"drought|dry spell|water scarcity"),
    ("tsunami", r"tsunami"),
    ("earthquake", r"earthquake"),
    ("severe_storm", r"squall|gust|hail|dust\s*storm|severe storm|strong wind"),
    ("thunderstorm_lightning", r"thunder|lightning"),
    ("heavy_rainfall", r"heavy|very heavy|extremely heavy|cloudburst"),
    ("rainfall", r"rain|shower|drizzle"),
    ("fire", r"fire"),
]
SEVERITY_RANK = {"Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1, "Unknown": 0}


def normalise_event(event: str, headline: str) -> str:
    text = f"{event} {headline}".lower()
    for name, pattern in EVENT_RULES:
        if re.search(pattern, text):
            return name
    return "other"


def _t(el: ET.Element | None, tag: str) -> str:
    if el is None:
        return ""
    x = el.find(CAP_NS + tag)
    return (x.text or "").strip() if x is not None and x.text else ""


def _dt(s: str) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return (d.astimezone(timezone.utc) if d.tzinfo else d).replace(tzinfo=None)


def _rss_date(s: str | None) -> datetime | None:
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc).replace(tzinfo=None) if s else None
    except (TypeError, ValueError):
        return None


def parse_cap(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    info = root.find(CAP_NS + "info")
    area = info.find(CAP_NS + "area") if info is not None else None
    params = {}
    for p in (info.findall(CAP_NS + "parameter") if info is not None else []):
        params[_t(p, "valueName")] = _t(p, "value")
    codes = []
    for gc in (area.findall(CAP_NS + "geocode") if area is not None else []):
        if "lgd" in _t(gc, "valueName").lower() and _t(gc, "value"):
            codes.append(_t(gc, "value"))
    inline_polys = [p.text.strip() for p in (area.findall(CAP_NS + "polygon") if area is not None else []) if p.text]
    event, headline = _t(info, "event"), _t(info, "headline")
    return {
        "identifier": _t(root, "identifier"),
        "sender": _t(root, "sender"),
        "sent": _dt(_t(root, "sent")),
        "status": _t(root, "status"),
        "msg_type": _t(root, "msgType") or "Alert",
        "category": _t(info, "category"),
        "event_raw": event,
        "event_type": normalise_event(event, headline),
        "urgency": _t(info, "urgency") or "Unknown",
        "severity": _t(info, "severity") or "Unknown",
        "certainty": _t(info, "certainty") or "Unknown",
        "effective": _dt(_t(info, "effective")),
        "onset": _dt(_t(info, "onset")),
        "expires": _dt(_t(info, "expires")),
        "headline": headline,
        "description": _t(info, "description"),
        "instruction": _t(info, "instruction"),
        "area_desc": _t(area, "areaDesc"),
        "lgd_codes": sorted(set(codes)),
        "polygon_url": params.get("Polygon URL"),
        "inline_polygons": inline_polys,
    }


def parse_polygon_rings(text: str) -> list[str]:
    """Polygon XML: <alert><identifier/><polygon>lat,lon lat,lon …</polygon>…</alert> (namespace-agnostic)."""
    root = ET.fromstring(text)
    return [el.text.strip() for el in root.iter() if el.tag.split("}")[-1] == "polygon" and el.text]


def rings_to_geometry(rings: list[str]):
    polys = []
    for ring in rings:
        pts = []
        for pair in ring.split():
            try:
                lat, lng = (float(v) for v in pair.split(",")[:2])
            except ValueError:
                continue
            pts.append((lng, lat))
        if len(pts) >= 4:
            p = Polygon(pts)
            polys.append(p if p.is_valid else p.buffer(0))
    if not polys:
        return None
    return unary_union(polys)


def is_active(e: DisasterEvent, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return e.msg_type != "Cancel" and (e.expires_at is None or e.expires_at > now)


def _apply_geometry(e: DisasterEvent, geometry) -> None:
    e.geometry = simplified(geometry, 0.005)  # ~500 m: enough for district-scale impact checks, small payload
    e.bbox, e.centroid_lat, e.centroid_lng = summary(geometry)
    e.geometry_status = "ok"


def ingest(db: Session, rec: IngestionRun) -> None:
    rss = http_get(settings.sachet_rss_url, timeout=25)
    rss.raise_for_status()
    items = ET.fromstring(rss.content).findall(".//item")
    rec.fetched = len(items)
    now = utcnow()
    known = {x for (x,) in db.execute(select(DisasterEvent.external_id).where(DisasterEvent.source == KEY))}
    new_severe = []

    for it in items:
        link = (it.findtext("link") or "").strip()
        guid = (it.findtext("guid") or "").strip()
        if not link:
            continue
        # CAP identifiers look like IN-<guid>_<n>; the RSS guid lets us skip known alerts without fetching.
        if guid and any(k == f"IN-{guid}" or k.startswith(f"IN-{guid}_") for k in known):
            rec.unchanged += 1
            continue
        try:
            cap = parse_cap(_polite_get(link, timeout=20).text)
        except ProviderBlocked:
            db.commit()
            raise
        except Exception as exc:  # noqa: BLE001 — one bad CAP file must not stop the run
            log.warning("CAP fetch/parse failed for %s: %s", link, exc)
            continue
        if not cap["identifier"] or cap["identifier"] in known:
            rec.unchanged += 1
            continue
        author = it.findtext("author") or ""
        provider = re.sub(r".*\((.*)\).*", r"\1", author) if "(" in author else (cap["sender"] or author)
        e = DisasterEvent(
            source=KEY, external_id=cap["identifier"], provider=provider, source_url=link, polygon_url=cap["polygon_url"],
            event_type=cap["event_type"], event_raw=cap["event_raw"][:200], category=cap["category"], severity=cap["severity"],
            urgency=cap["urgency"], certainty=cap["certainty"], msg_type=cap["msg_type"], headline=cap["headline"],
            description=cap["description"], instruction=cap["instruction"], area_desc=cap["area_desc"],
            lgd_district_codes=cap["lgd_codes"], effective_at=cap["effective"], onset_at=cap["onset"] or cap["effective"],
            expires_at=cap["expires"], published_at=_rss_date(it.findtext("pubDate")) or cap["sent"],
            retrieved_at=now, last_updated=cap["sent"] or now, geometry_status="pending" if (cap["polygon_url"] or cap["inline_polygons"]) else "unavailable",
        )
        if cap["inline_polygons"]:
            g = rings_to_geometry(cap["inline_polygons"])
            if g is not None:
                _apply_geometry(e, g)
        db.add(e)
        known.add(cap["identifier"])
        rec.created += 1
        if SEVERITY_RANK.get(e.severity, 0) >= 3 and is_active(e, now):
            new_severe.append(e)
    db.commit()

    # Polygons for active alerts (large files: bounded per run, retried next run).
    pending = db.scalars(select(DisasterEvent).where(DisasterEvent.source == KEY, DisasterEvent.polygon_url.is_not(None),
                                                     DisasterEvent.geometry_status.in_(("pending", "district_names")))
                         .order_by(DisasterEvent.published_at.desc())).all()
    fetched = 0
    for e in pending:
        if not is_active(e, now):
            if e.geometry_status == "pending":
                e.geometry_status = "not_needed"
            continue
        if fetched >= MAX_POLYGONS_PER_RUN or not e.polygon_url:
            continue
        fetched += 1
        try:
            g = rings_to_geometry(parse_polygon_rings(_polite_get(e.polygon_url, timeout=40).text))
            if g is None:
                e.geometry_status = "unavailable"
            else:
                _apply_geometry(e, g)
                rec.updated += 1
        except ProviderBlocked as exc:
            log.warning("SACHET blocked polygon requests (%s); will retry next run", exc)
            rec.error = f"Polygon fetch paused: {exc}"
            break
        except Exception as exc:  # noqa: BLE001
            log.warning("polygon fetch failed for %s: %s", e.external_id, exc)
        db.commit()
    db.commit()

    # Alerts still without an official polygon: derive an area from the district names in the official text.
    for e in db.scalars(select(DisasterEvent).where(DisasterEvent.source == KEY, DisasterEvent.geometry.is_(None),
                                                    DisasterEvent.geometry_status.in_(("pending", "unavailable")))):
        if is_active(e, now):
            match_districts_by_name(db, e)

    for e in new_severe:
        notify(db, "disaster_alert", "critical" if e.severity == "Extreme" else "warning",
               f"{e.severity} {e.event_type.replace('_', ' ')} alert ({e.provider})", e.headline[:500], "disaster", str(e.id),
               dedupe_key=f"disaster:{e.external_id}")
    db.commit()
    if rec.created or rec.updated:
        hub.publish("disasters.changed", {"created": rec.created})


def match_districts_by_name(db: Session, e: DisasterEvent) -> bool:
    """Fallback area: district names listed in the official areaDesc -> imported district boundaries.
    Labelled geometry_status='district_names' so the UI never presents it as the official polygon."""
    from shapely.ops import unary_union as _union

    from ..models import GeoDistrict, GeoState
    from ..services.geo import geom, name_key

    text = (e.area_desc or "").lower()
    if not text:
        return False
    norm = name_key
    states = [s for s in db.scalars(select(GeoState)) if norm(s.name) and norm(s.name) in norm(text)]
    q = select(GeoDistrict)
    if states:
        q = q.where(GeoDistrict.state_id.in_([s.id for s in states]))
    parts = {norm(p) for p in re.split(r",|\band\b|districts? of|district", text)}
    hits = [d for d in db.scalars(q) if norm(d.name) and norm(d.name) in parts]
    if not hits:
        return False
    g = _union([geom(d.geometry) for d in hits if d.geometry])
    if g.is_empty:
        return False
    _apply_geometry(e, g)
    e.geometry_status = "district_names"
    e.lgd_district_codes = e.lgd_district_codes or []
    return True


def run_sachet(db: Session) -> IngestionRun:
    return run(db, KEY, ingest)
