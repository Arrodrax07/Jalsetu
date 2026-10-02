"""Shared constants and filesystem locations for the JalSetu ML package."""
from __future__ import annotations

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ML_ROOT = PACKAGE_DIR.parent

# Trained model artifacts. Overridable so the backend container can mount them elsewhere.
ARTIFACTS_DIR = Path(os.environ.get("JALSETU_ML_ARTIFACTS", ML_ROOT / "artifacts"))
DATA_DIR = Path(os.environ.get("JALSETU_ML_DATA", ML_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

COMPLAINT_MODEL_PATH = ARTIFACTS_DIR / "complaint_classifier.joblib"
DEMAND_MODEL_PATH = ARTIFACTS_DIR / "demand_forecaster.joblib"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"

# Label spaces — must stay in sync with backend enums.
COMPLAINT_CATEGORIES = [
    "No Water",
    "Late Tanker",
    "Insufficient Quantity",
    "Poor Water Quality",
    "Missed Delivery",
    "Billing or Other",
]
SEVERITIES = ["Low", "Medium", "High", "Critical"]

# Default geography (Mumbai). Weather history is fetched for this point.
DEFAULT_LAT = 19.07
DEFAULT_LNG = 72.88
WEATHER_HISTORY_START = "2019-01-01"
WEATHER_HISTORY_END = "2025-12-31"

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_DAILY_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "relative_humidity_2m_mean",
]


def ensure_dirs() -> None:
    for d in (ARTIFACTS_DIR, RAW_DIR, PROCESSED_DIR):
        d.mkdir(parents=True, exist_ok=True)
