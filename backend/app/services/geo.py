"""Geometry helpers (shapely). Coordinates in GeoJSON are [lng, lat]; polylines stored on trips are [[lat, lng], ...]."""
from __future__ import annotations

import math
import re
import unicodedata

from shapely.geometry import LineString, Point, mapping, shape
from shapely.geometry.base import BaseGeometry

from .common import EARTH_RADIUS_M, haversine_m

M_PER_DEG_LAT = 111_320.0


def _local_xy(lat0: float, lng0: float, lat: float, lng: float) -> tuple[float, float]:
    """Equirectangular projection to metres around (lat0, lng0); accurate to <0.5% within tens of km."""
    return (lng - lng0) * M_PER_DEG_LAT * math.cos(math.radians(lat0)), (lat - lat0) * M_PER_DEG_LAT


def distance_to_polyline_m(lat: float, lng: float, polyline: list[list[float]]) -> float | None:
    """Shortest distance (m) from a point to a [[lat, lng], ...] polyline; None if the line is unusable."""
    if not polyline or len(polyline) < 2:
        return None
    pts = [_local_xy(lat, lng, p[0], p[1]) for p in polyline]
    return float(LineString(pts).distance(Point(0.0, 0.0)))


def polyline_length_km(points: list[tuple[float, float]]) -> float:
    return sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:])) / 1000.0


def geom(geojson: dict | None) -> BaseGeometry | None:
    if not geojson:
        return None
    try:
        g = shape(geojson)
        return g if g.is_valid else g.buffer(0)
    except Exception:  # noqa: BLE001
        return None


def contains(geojson: dict | None, lat: float, lng: float, bbox: list | None = None) -> bool:
    if bbox and not (bbox[0] <= lng <= bbox[2] and bbox[1] <= lat <= bbox[3]):
        return False
    g = geom(geojson)
    return bool(g is not None and g.covers(Point(lng, lat)))


def line_intersects(geojson: dict | None, polyline: list[list[float]], bbox: list | None = None) -> bool:
    g = geom(geojson)
    if g is None or not polyline or len(polyline) < 2:
        return False
    line = LineString([(p[1], p[0]) for p in polyline])
    if bbox:
        minx, miny, maxx, maxy = line.bounds
        if maxx < bbox[0] or minx > bbox[2] or maxy < bbox[1] or miny > bbox[3]:
            return False
    return g.intersects(line)


def simplified(g: BaseGeometry, tolerance_deg: float) -> dict:
    s = g.simplify(tolerance_deg, preserve_topology=True)
    if s.is_empty:
        s = g
    return mapping(s)


def summary(g: BaseGeometry) -> tuple[list[float], float, float]:
    """bbox [minLng, minLat, maxLng, maxLat], centroid lat, centroid lng (representative point: always inside)."""
    minx, miny, maxx, maxy = g.bounds
    rp = g.representative_point()
    return [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)], round(rp.y, 5), round(rp.x, 5)


def name_key(s: str | None) -> str:
    """Accent/case/punctuation-insensitive key for matching place names ("Mahārāshtra" == "Maharashtra")."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z]", "", s.lower().replace("&", "and"))


def bearing_label(deg: float | None) -> str | None:
    if deg is None or math.isnan(deg):
        return None
    names = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"]
    return names[int(((deg % 360) + 22.5) // 45) % 8]


__all__ = ["EARTH_RADIUS_M", "haversine_m", "distance_to_polyline_m", "polyline_length_km", "geom", "contains",
           "line_intersects", "simplified", "summary", "bearing_label", "name_key"]
