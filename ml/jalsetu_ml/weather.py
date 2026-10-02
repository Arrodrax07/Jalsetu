"""Real weather data from Open-Meteo (free, no API key).

* ``fetch_history`` pulls daily ERA5-based reanalysis from the archive API and caches it as CSV.
* ``fetch_forecast`` pulls the 16-day daily forecast used at inference time.
"""
from __future__ import annotations

import logging
from datetime import date

import httpx
import pandas as pd

from . import config

log = logging.getLogger(__name__)

_COLUMN_MAP = {
    "time": "date",
    "temperature_2m_max": "temp_max",
    "temperature_2m_min": "temp_min",
    "precipitation_sum": "precip",
    "relative_humidity_2m_mean": "humidity",
}


def _to_frame(payload: dict) -> pd.DataFrame:
    daily = payload.get("daily")
    if not daily:
        raise ValueError(f"Open-Meteo response has no daily block: {payload}")
    df = pd.DataFrame(daily).rename(columns=_COLUMN_MAP)
    df["date"] = pd.to_datetime(df["date"])
    for col in ("temp_max", "temp_min", "precip", "humidity"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    # Archive occasionally has gaps; interpolate short ones, precipitation gaps -> 0.
    df["precip"] = df["precip"].fillna(0.0)
    df[["temp_max", "temp_min", "humidity"]] = df[["temp_max", "temp_min", "humidity"]].interpolate(limit_direction="both")
    return df


def history_cache_path(lat: float, lng: float):
    return config.RAW_DIR / f"weather_{lat:.2f}_{lng:.2f}_{config.WEATHER_HISTORY_START}_{config.WEATHER_HISTORY_END}.csv"


def fetch_history(
    lat: float = config.DEFAULT_LAT,
    lng: float = config.DEFAULT_LNG,
    start: str = config.WEATHER_HISTORY_START,
    end: str = config.WEATHER_HISTORY_END,
    use_cache: bool = True,
) -> pd.DataFrame:
    config.ensure_dirs()
    cache = history_cache_path(lat, lng)
    if use_cache and cache.exists():
        return pd.read_csv(cache, parse_dates=["date"])

    log.info("Downloading Open-Meteo history %s..%s for (%.3f, %.3f)", start, end, lat, lng)
    params = {
        "latitude": lat,
        "longitude": lng,
        "start_date": start,
        "end_date": end,
        "daily": ",".join(config.WEATHER_DAILY_VARS),
        "timezone": "Asia/Kolkata",
    }
    resp = httpx.get(config.OPEN_METEO_ARCHIVE_URL, params=params, timeout=60)
    resp.raise_for_status()
    df = _to_frame(resp.json())
    df.to_csv(cache, index=False)
    return df


def fetch_forecast(lat: float, lng: float, days: int = 7, past_days: int = 30, timeout: float = 10.0) -> pd.DataFrame:
    """Forecast horizon plus ``past_days`` of recent observed weather (needed for rolling rain features)."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": ",".join(config.WEATHER_DAILY_VARS),
        "forecast_days": max(1, min(days, 16)),
        "past_days": max(0, min(past_days, 92)),
        "timezone": "Asia/Kolkata",
    }
    resp = httpx.get(config.OPEN_METEO_FORECAST_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    return _to_frame(resp.json())


def climatology_fallback(start: date, days: int) -> pd.DataFrame:
    """Mumbai monthly climate normals, used only if the forecast API is unreachable."""
    # (temp_max, temp_min, precip mm/day, humidity %) by month — IMD Santacruz normals, rounded.
    normals = {
        1: (31, 17, 0.0, 60), 2: (32, 18, 0.0, 60), 3: (33, 21, 0.0, 64), 4: (33, 24, 0.0, 69),
        5: (34, 27, 0.6, 71), 6: (32, 26, 18.0, 81), 7: (30, 25, 27.0, 87), 8: (30, 25, 18.0, 86),
        9: (31, 25, 11.0, 83), 10: (33, 24, 2.5, 75), 11: (34, 21, 0.4, 64), 12: (33, 19, 0.0, 60),
    }
    rows = []
    for d in pd.date_range(start, periods=days, freq="D"):
        tmax, tmin, p, h = normals[d.month]
        rows.append({"date": d, "temp_max": tmax, "temp_min": tmin, "precip": p, "humidity": h})
    return pd.DataFrame(rows)
