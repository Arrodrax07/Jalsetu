"""Model loading + inference glue between the API and the ``jalsetu_ml`` package."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ..config import get_settings

settings = get_settings()
os.environ.setdefault("JALSETU_ML_ARTIFACTS", str(settings.ml_artifacts_dir))

from jalsetu_ml import config as ml_config  # noqa: E402
from jalsetu_ml.complaints import ComplaintTriage, find_duplicates  # noqa: E402
from jalsetu_ml.demand import DemandForecaster  # noqa: E402
from jalsetu_ml.weather import climatology_fallback, fetch_forecast, fetch_forecast_many  # noqa: E402

log = logging.getLogger(__name__)

_lock = threading.Lock()
_triage: ComplaintTriage | None = None
_forecaster: DemandForecaster | None = None
_load_errors: dict[str, str] = {}


def triage() -> ComplaintTriage | None:
    global _triage
    if _triage is None and "complaints" not in _load_errors:
        with _lock:
            if _triage is None:
                try:
                    _triage = ComplaintTriage()
                    _triage.predict("warm up")  # loads the ONNX embedding session once
                except Exception as exc:  # noqa: BLE001
                    _load_errors["complaints"] = str(exc)
                    log.error("Complaint model unavailable: %s", exc)
    return _triage


def forecaster() -> DemandForecaster | None:
    global _forecaster
    if _forecaster is None and "demand" not in _load_errors:
        with _lock:
            if _forecaster is None:
                try:
                    _forecaster = DemandForecaster()
                except Exception as exc:  # noqa: BLE001
                    _load_errors["demand"] = str(exc)
                    log.error("Demand model unavailable: %s", exc)
    return _forecaster


def reload_models() -> None:
    global _triage, _forecaster
    with _lock:
        _triage = _forecaster = None
        _load_errors.clear()
    triage()
    forecaster()


def status() -> dict:
    t, f = triage(), forecaster()
    metrics = {}
    if ml_config.METRICS_PATH.exists():
        metrics = json.loads(ml_config.METRICS_PATH.read_text(encoding="utf-8"))
    return {
        "complaintClassifier": {"loaded": t is not None, "meta": t.meta if t else None, "error": _load_errors.get("complaints")},
        "demandForecaster": {"loaded": f is not None, "meta": f.meta if f else None, "error": _load_errors.get("demand")},
        "metrics": metrics,
    }


# ---------------------------------------------------------------------------
# Complaint triage
# ---------------------------------------------------------------------------
@dataclass
class ComplaintAnalysis:
    category: str
    category_confidence: float
    severity: str
    severity_confidence: float
    sentiment: str
    duplicate_of: int | None
    duplicate_probability: float
    similar_count: int
    recommended_action: str
    model_version: str
    category_probabilities: dict[str, float]


_SEVERITY_ORDER = ["Low", "Medium", "High", "Critical"]

PLAYBOOK = {
    "No Water": "Verify feeder/standpost status with ward engineer; schedule emergency tanker in next allocation run.",
    "Late Tanker": "Check live GPS of the assigned tanker and send the community representative an updated ETA.",
    "Insufficient Quantity": "Cross-check delivered litres against proof-of-delivery records; top-up if variance confirmed.",
    "Poor Water Quality": "Dispatch water-quality testing kit (residual chlorine, turbidity, E. coli); suspend source tanker until cleared.",
    "Missed Delivery": "Audit the trip's stop log and GPS trace; re-route the nearest tanker with spare load.",
    "Billing or Other": "Route to ward office helpdesk for information/billing follow-up.",
}


def analyse_complaint(text: str, recent: list[tuple[int, str, str]], similarity_threshold: float) -> ComplaintAnalysis:
    """``recent`` = [(complaint_id, description, category)] from the same community, last 72h, unresolved."""
    model = triage()
    if model is None:
        raise RuntimeError("Complaint model not loaded: " + _load_errors.get("complaints", "unknown error"))
    r = model.predict(text)

    # Semantic matches only count against complaints of the same predicted category.
    same_cat = [(str(cid), desc) for cid, desc, cat in recent if cat == r.category]
    other = [(str(cid), desc) for cid, desc, cat in recent if cat != r.category]
    dups = sorted(
        find_duplicates(text, same_cat, threshold=similarity_threshold, embedder=model.embedder)
        + find_duplicates(text, other, threshold=similarity_threshold),
        key=lambda h: -h[1],
    )
    duplicate_of = int(dups[0][0]) if dups else None
    dup_prob = dups[0][1] if dups else 0.0
    similar_count = sum(1 for _, _, cat in recent if cat == r.category)

    severity = r.severity
    # Repeated grievances from the same community escalate one level (max Critical).
    if similar_count >= 2 and severity != "Critical":
        severity = _SEVERITY_ORDER[_SEVERITY_ORDER.index(severity) + 1]

    sentiment = "Critical" if severity == "Critical" else ("Neutral" if r.category == "Billing or Other" and severity == "Low" else "Negative")

    if duplicate_of is not None:
        action = f"Likely duplicate of C-{2000 + duplicate_of} ({dup_prob:.0%} text similarity) - link tickets instead of dispatching again."
    else:
        action = PLAYBOOK[r.category]
        if severity == "Critical":
            action = "Escalate to ward officer immediately. " + action
        if similar_count >= 2:
            action += f" {similar_count} similar open complaints from this community in 72h."

    return ComplaintAnalysis(
        category=r.category,
        category_confidence=r.category_confidence,
        severity=severity,
        severity_confidence=r.severity_confidence,
        sentiment=sentiment,
        duplicate_of=duplicate_of,
        duplicate_probability=dup_prob,
        similar_count=similar_count,
        recommended_action=action,
        model_version=model.meta.get("trained_at", ""),
        category_probabilities=r.category_probabilities,
    )


# ---------------------------------------------------------------------------
# Demand forecasting with live weather
# ---------------------------------------------------------------------------
_weather_cache: dict[tuple[float, float, int], tuple[float, object, str]] = {}
WEATHER_TTL_S = 3 * 3600


def weather_for(lat: float, lng: float, days: int):
    key = (round(lat, 1), round(lng, 1), days)
    hit = _weather_cache.get(key)
    if hit and time.time() - hit[0] < WEATHER_TTL_S:
        return hit[1], hit[2]
    try:
        df = fetch_forecast(key[0], key[1], days=days, past_days=30, timeout=settings.weather_timeout_s)
        source = "open-meteo"
    except Exception as exc:  # noqa: BLE001
        log.warning("Open-Meteo forecast failed (%s); using climatology", exc)
        df = climatology_fallback(date.today() - timedelta(days=30), days + 30)
        source = "climatology-fallback"
    _weather_cache[key] = (time.time(), df, source)
    return df, source


# State-wide forecasts group places into ~28 km weather cells: daily forecast models are no finer than that, and
# 1,263 places fit in a few hundred cells fetched in a handful of multi-location requests.
GRID_DEG = 0.25
CELL_BATCH = 50          # cells per Open-Meteo request; a failed request only affects its own cells
FALLBACK_TTL_S = 600     # retry the live forecast soon after a failure instead of keeping climatology for hours
_grid_cache: dict[tuple[float, float, int], tuple[float, object, str]] = {}


def _cell(lat: float, lng: float) -> tuple[float, float]:
    return round(round(lat / GRID_DEG) * GRID_DEG, 2), round(round(lng / GRID_DEG) * GRID_DEG, 2)


def weather_for_cells(cells: list[tuple[float, float]], days: int) -> dict[tuple[float, float], tuple[object, str]]:
    now = time.time()
    out, missing = {}, []
    for c in dict.fromkeys(cells):
        hit = _grid_cache.get((c[0], c[1], days))
        if hit and now - hit[0] < WEATHER_TTL_S:
            out[c] = (hit[1], hit[2])
        else:
            missing.append(c)
    fallback = None
    for i in range(0, len(missing), CELL_BATCH):
        chunk = missing[i:i + CELL_BATCH]
        try:
            got = [(df, "open-meteo", WEATHER_TTL_S) for df in
                   fetch_forecast_many(chunk, days=days, past_days=30, timeout=max(30.0, settings.weather_timeout_s))]
        except Exception as exc:  # noqa: BLE001 — only this batch falls back, and only briefly
            log.warning("Open-Meteo batch forecast failed for %d cells (%s); using climatology", len(chunk), exc)
            if fallback is None:
                fallback = climatology_fallback(date.today() - timedelta(days=30), days + 30)
            got = [(fallback, "climatology-fallback", FALLBACK_TTL_S)] * len(chunk)
        for c, (df, src, ttl) in zip(chunk, got):
            _grid_cache[(c[0], c[1], days)] = (now - WEATHER_TTL_S + ttl, df, src)
            out[c] = (df, src)
    return out


def forecast_demand_many(items: list[tuple[float, float, float, float]], days: int = 7) -> tuple[list[list[dict]], set[str]]:
    """Forecasts for many (lat, lng, baseline, vulnerability) places, in input order, plus the weather sources used."""
    model = forecaster()
    if model is None:
        raise RuntimeError("Demand model not loaded: " + _load_errors.get("demand", "unknown error"))
    cells = [_cell(lat, lng) for lat, lng, _, _ in items]
    weather = weather_for_cells(cells, max(days, 7))  # one 7-day fetch serves allocation (1 day) and analytics alike
    by_cell: dict[tuple[float, float], list[int]] = {}
    for i, c in enumerate(cells):
        by_cell.setdefault(c, []).append(i)
    out: list[list[dict]] = [[] for _ in items]
    start = datetime.now().date()
    order = list(by_cell.items())
    groups = model.forecast_groups([(weather[c][0], [(items[i][2], items[i][3]) for i in idx]) for c, idx in order], start_date=start)
    for (_, idx), rows in zip(order, groups):
        for i, r in zip(idx, rows):
            out[i] = r[:days]
    return out, {weather[c][1] for c in by_cell}


def forecast_demand(lat: float, lng: float, baseline: float, vulnerability: float, days: int = 7) -> tuple[list[dict], str]:
    model = forecaster()
    if model is None:
        raise RuntimeError("Demand model not loaded: " + _load_errors.get("demand", "unknown error"))
    weather, source = weather_for(lat, lng, days)
    return model.forecast(weather, baseline, vulnerability, start_date=datetime.now().date()), source


def warm_state_forecast() -> None:
    """Fetch weather for every active place once at startup so the first forecast request does not wait on it."""
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Community

    try:
        with SessionLocal() as db:
            items = [(c.lat, c.lng, c.daily_demand, c.vulnerability_score)
                     for c in db.scalars(select(Community).where(Community.is_active.is_(True)))]
        if items:
            forecast_demand_many(items, days=7)
            log.info("Weather warmed for %d places", len(items))
    except Exception as exc:  # noqa: BLE001 — warming is best effort
        log.warning("Forecast warm-up failed: %s", exc)
