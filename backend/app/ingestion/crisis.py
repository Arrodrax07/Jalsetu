"""Crisis signals for Maharashtra: measured rainfall deficit + recent news reports.

rainfall_deficit
    Open-Meteo historical weather (ERA5). For each district centroid: this year's monsoon rainfall
    (1 Jun to the latest available day, at most 30 Sep) vs the mean of the same window over the
    previous 10 years. <= -40% Severe, <= -25% Moderate, <= -15% Minor; otherwise no signal.

news
    Google News RSS searches in English and Marathi, last 14 days. An article becomes a signal only if
    it mentions water stress AND a Maharashtra place:
      * a city/town by name (a village name counts only when its district is named in the same article,
        because many village names are also common words or personal names);
      * a district (current and former names: Beed/Bid, Dharashiv/Osmanabad, Chhatrapati
        Sambhajinagar/Aurangabad, Ahilyanagar/Ahmednagar ...), in English or Marathi;
      * a region (Marathwada, Vidarbha, Khandesh, Konkan), which counts half in scoring.
    Signals are unverified until an operator confirms or dismisses them; they expire after 21 days.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Community, CrisisSignal, GeoDistrict, GeoState, IngestionRun, utcnow
from ..services import crisis
from ..services.geo import name_key
from ..services.notify import notify
from ..services.realtime import hub
from .base import http_get, run

log = logging.getLogger("jalsetu.ingestion.crisis")

# --------------------------------------------------------------------------- places
DISTRICT_ALIASES: dict[str, list[str]] = {  # geoBoundaries name_key -> names used in the press
    "bid": ["Beed", "Bid"], "ahmadnagar": ["Ahmednagar", "Ahmadnagar", "Ahilyanagar"],
    "aurangabad": ["Chhatrapati Sambhajinagar", "Sambhajinagar", "Aurangabad"], "osmanabad": ["Dharashiv", "Osmanabad"],
    "raigarh": ["Raigad"], "gondiya": ["Gondia", "Gondiya"], "buldana": ["Buldhana", "Buldana"],
    "mumbaisuburban": ["Mumbai Suburban"],
}
DISTRICT_MARATHI: dict[str, list[str]] = {
    "ahmadnagar": ["अहमदनगर", "अहिल्यानगर"], "akola": ["अकोला"], "amravati": ["अमरावती"], "aurangabad": ["संभाजीनगर", "औरंगाबाद"],
    "bhandara": ["भंडारा"], "bid": ["बीड"], "buldana": ["बुलढाणा"], "chandrapur": ["चंद्रपूर"], "dhule": ["धुळे"],
    "gadchiroli": ["गडचिरोली"], "gondiya": ["गोंदिया"], "hingoli": ["हिंगोली"], "jalgaon": ["जळगाव"], "jalna": ["जालना"],
    "kolhapur": ["कोल्हापूर"], "latur": ["लातूर"], "mumbai": ["मुंबई"], "nagpur": ["नागपूर"], "nanded": ["नांदेड"],
    "nandurbar": ["नंदुरबार"], "nashik": ["नाशिक"], "osmanabad": ["धाराशिव", "उस्मानाबाद"], "palghar": ["पालघर"],
    "parbhani": ["परभणी"], "pune": ["पुणे"], "raigarh": ["रायगड"], "ratnagiri": ["रत्नागिरी"], "sangli": ["सांगली"],
    "satara": ["सातारा"], "sindhudurg": ["सिंधुदुर्ग"], "solapur": ["सोलापूर"], "thane": ["ठाणे"], "wardha": ["वर्धा"],
    "washim": ["वाशिम"], "yavatmal": ["यवतमाळ"],
}
REGIONS: dict[str, list[str]] = {
    "Marathwada": ["aurangabad", "jalna", "bid", "latur", "osmanabad", "nanded", "parbhani", "hingoli"],
    "Vidarbha": ["nagpur", "wardha", "bhandara", "gondiya", "chandrapur", "gadchiroli", "amravati", "akola", "washim", "buldana", "yavatmal"],
    "Khandesh": ["dhule", "jalgaon", "nandurbar"],
    "Konkan": ["thane", "palghar", "raigarh", "ratnagiri", "sindhudurg"],
}
REGION_MARATHI = {"Marathwada": "मराठवाडा", "Vidarbha": "विदर्भ", "Khandesh": "खान्देश", "Konkan": "कोकण"}
NAME_STOPWORDS = {"nagar", "station", "colony", "camp", "road", "market", "city", "gaon", "wadi", "central", "new", "old", "india",
                  "water", "river", "dam", "lake", "temple", "sangam", "ganesh", "shivaji", "anand"}

# --------------------------------------------------------------------------- relevance
SEVERE = ("drought", "tanker", "parched", "no water", "dried up", "dry up", "dried", "migrat", "दुष्काळ", "टँकर", "पाणीटंचाई")
MODERATE = ("shortage", "scarcity", "water crisis", "water cut", "dead storage", "टंचाई", "पाणीकपात")  # stock-level reports are neutral
MINOR = ("water supply", "pipeline burst", "पाणीपुरवठा")

NEWS_QUERIES = [
    ("en", "water shortage Maharashtra"), ("en", "water tanker Maharashtra village"), ("en", "drought Maharashtra taluka"),
    ("en", "water crisis Marathwada"), ("en", "water crisis Vidarbha"), ("en", "water cut Maharashtra city"),
    ("en", "dam water storage Maharashtra"),
    ("mr", "पाणीटंचाई"), ("mr", "टँकर पाणीपुरवठा"), ("mr", "दुष्काळ"),
]
NEWS_WINDOW_DAYS, NEWS_TTL_DAYS = 14, 21


def severity_of(text: str) -> str | None:
    t = text.lower()
    if any(k in t for k in SEVERE):
        return "Severe"
    if any(k in t for k in MODERATE):
        return "Moderate"
    if any(k in t for k in MINOR):
        return "Minor"
    return None


def _word(name: str) -> re.Pattern:
    guard = r"(?<!Navi )" if name == "Mumbai" else ""  # Navi Mumbai is in Thane district
    return re.compile(guard + r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])")


class PlaceMatcher:
    """Finds Maharashtra communities, districts and regions mentioned in a piece of text."""

    def __init__(self, communities: list[Community], districts: list[GeoDistrict]):
        self.district_terms: list[tuple[int, re.Pattern | str, str]] = []
        key_to_id = {}
        for d in districts:
            k = name_key(d.name)
            key_to_id[k] = d.id
            for alias in DISTRICT_ALIASES.get(k, [d.name]):
                self.district_terms.append((d.id, _word(alias), alias))
            for mr in DISTRICT_MARATHI.get(k, []):
                self.district_terms.append((d.id, mr, mr))
        self.regions = {r: [key_to_id[k] for k in ks if k in key_to_id] for r, ks in REGIONS.items()}
        self.community_terms: list[tuple[Community, re.Pattern]] = []
        for c in communities:
            n = c.name.strip()
            if name_key(n) in NAME_STOPWORDS or len(n) < 4 or (len(n) < 5 and c.population < 100_000):
                continue
            # "Beed district" is about the district, not Beed town
            self.community_terms.append((c, re.compile(_word(n).pattern + r"(?!\s+(?:[Dd]istrict|जिल्ह))")))

    def match(self, text: str) -> tuple[list[str], list[int], list[dict]]:
        districts, terms = set(), []
        for did, pat, label in self.district_terms:
            hit = (pat in text) if isinstance(pat, str) else bool(pat.search(text))
            if hit:
                districts.add(did)
                terms.append({"term": label, "scope": "district"})
        communities = []
        for c, pat in self.community_terms:
            if not pat.search(text):
                continue
            if c.settlement_type in ("village", "hamlet") and c.district_id not in districts:
                continue  # ambiguous village name without its district
            communities.append(c.id)
            terms.append({"term": c.name, "scope": "community"})
        if not districts and not communities:
            for region, ids in self.regions.items():
                if _word(region).search(text) or REGION_MARATHI[region] in text:
                    districts.update(ids)
                    terms.append({"term": region, "scope": "region"})
        return communities, sorted(districts), terms


# --------------------------------------------------------------------------- news
def _strip(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_rss(xml_text: str) -> list[dict]:
    items = []
    for it in ET.fromstring(xml_text).iter("item"):
        src = it.find("source")
        try:
            published = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc).replace(tzinfo=None)
        except (TypeError, ValueError):
            published = None
        title = _strip(it.findtext("title") or "")
        publisher = (src.text or "").strip() if src is not None else ""
        if publisher and title.endswith(" - " + publisher):
            title = title[: -len(publisher) - 3]
        items.append({"title": title, "url": (it.findtext("link") or "").strip(), "publisher": publisher,
                      "published": published, "summary": _strip(it.findtext("description") or "")})
    return items


def fetch_news() -> list[dict]:
    seen, out = set(), []
    for lang, q in NEWS_QUERIES:
        hl, ceid = ("mr-IN", "IN:mr") if lang == "mr" else ("en-IN", "IN:en")
        url = f"https://news.google.com/rss/search?q={quote_plus(q + f' when:{NEWS_WINDOW_DAYS}d')}&hl={hl}&gl=IN&ceid={ceid}"
        try:
            r = http_get(url, timeout=20)
            r.raise_for_status()
            items = parse_rss(r.text)
        except Exception as exc:  # noqa: BLE001 — one failing query must not sink the others
            log.warning("news query %r failed: %s", q, exc)
            continue
        for it in items:
            key = it["title"].lower()
            if it["url"] and key not in seen:
                seen.add(key)
                out.append(it)
    return out


def ingest_news(db: Session, rec: IngestionRun) -> None:
    communities = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    districts = maharashtra_districts(db)
    matcher = PlaceMatcher(communities, districts)
    names = {c.id: c.name for c in communities}
    cutoff = utcnow() - timedelta(days=NEWS_WINDOW_DAYS)
    items = fetch_news()
    rec.fetched = len(items)
    if not items:
        raise RuntimeError("No news items returned by any query")
    for it in items:
        if it["published"] and it["published"] < cutoff:
            continue
        text = f"{it['title']}. {it['summary']}"
        sev = severity_of(text)
        if not sev:
            continue
        cids, dids, terms = matcher.match(text)
        if not cids and not dids:
            continue
        ext = "news:" + hashlib.sha1(it["title"].lower().encode()).hexdigest()[:24]
        row = db.scalar(select(CrisisSignal).where(CrisisSignal.external_id == ext))
        if row:
            rec.unchanged += 1
            continue
        published = it["published"] or utcnow()
        row = CrisisSignal(kind="news", external_id=ext, title=it["title"][:1000], summary=it["summary"][:2000], url=it["url"][:1000],
                           publisher=it["publisher"][:200], published_at=published, severity=sev, community_ids=cids,
                           district_ids=dids, matched_terms=terms, expires_at=published + timedelta(days=NEWS_TTL_DAYS))
        db.add(row)
        db.flush()
        rec.created += 1
        if sev == "Severe" and cids:
            where = ", ".join(names[c] for c in cids[:3])
            notify(db, "crisis_signal", "warning", f"News: water crisis reported in {where}", f"{it['title']} ({it['publisher']}). Unverified: review in Crisis signals.",
                   "crisis_signal", str(row.id), dedupe_key=f"crisis:{ext}")
    db.commit()


# --------------------------------------------------------------------------- rainfall
def maharashtra_districts(db: Session) -> list[GeoDistrict]:
    mh = next((s.id for s in db.scalars(select(GeoState)) if name_key(s.name) == "maharashtra"), None)
    return list(db.scalars(select(GeoDistrict).where(GeoDistrict.state_id == mh))) if mh else []


def monsoon_window(today: date) -> tuple[date, date] | None:
    """1 Jun .. min(today - 6 days archive lag, 30 Sep) of the most recent monsoon with >= 14 days of data."""
    year = today.year if today >= date(today.year, 6, 21) else today.year - 1
    start, end = date(year, 6, 1), min(today - timedelta(days=6), date(year, 9, 30))
    return (start, end) if (end - start).days >= 14 else None


def deviation(daily_time: list[str], daily_mm: list[float | None], window: tuple[date, date], years: int = 10) -> float | None:
    """% deviation of the window total in window-year from the mean of the same window over the previous `years`."""
    (start, end), totals = window, defaultdict(float)
    md0, md1 = (start.month, start.day), (end.month, end.day)
    for t, v in zip(daily_time, daily_mm):
        if v is None:
            continue
        y, m, d = int(t[:4]), int(t[5:7]), int(t[8:10])
        if md0 <= (m, d) <= md1:
            totals[y] += v
    base = [totals[y] for y in range(start.year - years, start.year) if y in totals]
    if len(base) < years // 2 or start.year not in totals:
        return None
    mean = sum(base) / len(base)
    return round(100 * (totals[start.year] - mean) / mean, 1) if mean > 0 else None


def rain_severity(dev: float | None) -> str | None:
    if dev is None:
        return None
    return "Severe" if dev <= -40 else "Moderate" if dev <= -25 else "Minor" if dev <= -15 else None


def ingest_rainfall(db: Session, rec: IngestionRun) -> None:
    districts = [d for d in maharashtra_districts(db) if d.centroid_lat is not None]
    window = monsoon_window(datetime.now(timezone.utc).date())
    if not districts or not window:
        raise RuntimeError("No Maharashtra districts imported or no monsoon window yet")
    start = date(window[0].year - 10, 6, 1)
    r = http_get("https://archive-api.open-meteo.com/v1/archive", timeout=180, params={
        "latitude": ",".join(f"{d.centroid_lat:.3f}" for d in districts),
        "longitude": ",".join(f"{d.centroid_lng:.3f}" for d in districts),
        "start_date": start.isoformat(), "end_date": window[1].isoformat(),
        "daily": "precipitation_sum", "timezone": "Asia/Kolkata"})
    r.raise_for_status()
    data = r.json()
    data = data if isinstance(data, list) else [data]
    rec.fetched = len(data)
    label = f"{window[0]:%d %b}–{window[1]:%d %b %Y}"
    for d, loc in zip(districts, data):
        dev = deviation(loc["daily"]["time"], loc["daily"]["precipitation_sum"], window)
        sev = rain_severity(dev)
        ext = f"rain:{d.id}:{window[0].year}"
        row = db.scalar(select(CrisisSignal).where(CrisisSignal.external_id == ext))
        if not sev:
            if row and row.status != "dismissed":
                row.expires_at = utcnow()  # recovered: stop counting
            continue
        if row is None:
            row = CrisisSignal(kind="rainfall_deficit", external_id=ext)
            db.add(row)
            rec.created += 1
        else:
            rec.updated += 1
        row.title = f"{d.name}: monsoon rainfall {abs(dev):.0f}% below 10-year average"
        row.summary = (f"Measured rainfall over the district centre, {label}, vs the mean of the same period in "
                       f"{window[0].year - 10}–{window[0].year - 1} (Open-Meteo ERA5 reanalysis).")
        row.url = (f"https://open-meteo.com/en/docs/historical-weather-api?latitude={d.centroid_lat:.3f}&longitude={d.centroid_lng:.3f}"
                   f"&start_date={window[0]}&end_date={window[1]}&daily=precipitation_sum")
        row.publisher, row.severity, row.metric = "Open-Meteo (ERA5)", sev, dev
        row.district_ids, row.community_ids = [d.id], []
        row.matched_terms = [{"term": d.name, "scope": "district"}]
        row.published_at, row.retrieved_at = utcnow(), utcnow()
        row.expires_at = utcnow() + timedelta(days=30)
    db.commit()


# --------------------------------------------------------------------------- entry points
def run_crisis(db: Session) -> dict:
    """Refresh both signal sources, then re-score every community. Each source fails independently."""
    rain = run(db, "rainfall_deficit", ingest_rainfall)
    news = run(db, "news_crisis", ingest_news)
    summary = crisis.recompute(db)
    hub.publish("communities.changed")
    return {"rainfall": {"status": rain.status, "created": rain.created, "updated": rain.updated, "error": rain.error},
            "news": {"status": news.status, "fetched": news.fetched, "created": news.created, "error": news.error},
            **summary}
