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
from jalsetu_ml.weather import climatology_fallback, fetch_forecast  # noqa: E402

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


def forecast_demand(lat: float, lng: float, baseline: float, vulnerability: float, days: int = 7) -> tuple[list[dict], str]:
    model = forecaster()
    if model is None:
        raise RuntimeError("Demand model not loaded: " + _load_errors.get("demand", "unknown error"))
    weather, source = weather_for(lat, lng, days)
    return model.forecast(weather, baseline, vulnerability, start_date=datetime.now().date()), source
