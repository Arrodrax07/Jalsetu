"""Tanker route optimisation on the real road network.

* Travel times/distances come from OSRM (``/table`` and ``/route``).  The public demo
  server is used by default; point ``OSRM_URL`` at a self-hosted instance for production.
  If OSRM is unreachable we fall back to haversine x circuity factor at a fallback speed,
  and say so in the response (``routingSource = "haversine-fallback"``).
* Stop sequencing minimises  total trip time + lambda * priority-weighted mean arrival time,
  so critical communities are reached early without large detours.  Exact (exhaustive)
  for up to 8 stops; nearest-neighbour + 2-opt beyond that.
* The tanker returns to its depot at the end (refill), and that leg is included.
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass

import httpx

from ..config import get_settings
from .common import haversine_m

log = logging.getLogger(__name__)
settings = get_settings()

URGENCY_LAMBDA = 0.5


@dataclass
class Point:
    key: str
    name: str
    lat: float
    lng: float
    weight: float = 1.0  # priority weight for arrival-time penalty


@dataclass
class Matrix:
    durations_s: list[list[float]]
    distances_m: list[list[float]]
    source: str


def _coords(points: list[Point]) -> str:
    return ";".join(f"{p.lng:.6f},{p.lat:.6f}" for p in points)


def travel_matrix(points: list[Point], fallback_speed_kmh: float, circuity: float) -> Matrix:
    try:
        r = httpx.get(
            f"{settings.osrm_url}/table/v1/driving/{_coords(points)}",
            params={"annotations": "duration,distance"},
            timeout=settings.routing_timeout_s,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") == "Ok" and data.get("distances"):
            return Matrix(data["durations"], data["distances"], "osrm")
        log.warning("OSRM table returned %s", data.get("code"))
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("OSRM table failed (%s); using haversine fallback", exc)

    n = len(points)
    dist = [[haversine_m(points[i].lat, points[i].lng, points[j].lat, points[j].lng) * circuity for j in range(n)] for i in range(n)]
    speed_ms = fallback_speed_kmh / 3.6
    return Matrix([[d / speed_ms for d in row] for row in dist], dist, "haversine-fallback")


def route_geometry(points: list[Point]) -> tuple[list[list[float]], float, float, str]:
    """Road geometry for an ordered list of points -> (latlngs, distance_m, duration_s, source)."""
    try:
        r = httpx.get(
            f"{settings.osrm_url}/route/v1/driving/{_coords(points)}",
            params={"overview": "full", "geometries": "geojson"},
            timeout=settings.routing_timeout_s,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") == "Ok":
            route = data["routes"][0]
            latlngs = [[round(lat, 6), round(lng, 6)] for lng, lat in route["geometry"]["coordinates"]]
            return latlngs, route["distance"], route["duration"], "osrm"
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        log.warning("OSRM route failed (%s); straight-line geometry", exc)
    return [[p.lat, p.lng] for p in points], 0.0, 0.0, "haversine-fallback"


def evaluate(order: list[int], m: Matrix, weights: list[float]) -> tuple[float, float, float]:
    """order excludes depot (index 0). Returns (objective, distance_m, duration_s) for depot -> stops -> depot."""
    t = dist = 0.0
    weighted_arrival = 0.0
    prev = 0
    for idx in order:
        t += m.durations_s[prev][idx]
        dist += m.distances_m[prev][idx]
        weighted_arrival += weights[idx] * t
        prev = idx
    t_total = t + m.durations_s[prev][0]
    dist += m.distances_m[prev][0]
    wsum = sum(weights[i] for i in order) or 1.0
    return t_total + URGENCY_LAMBDA * weighted_arrival / wsum, dist, t_total


def best_order(n_stops: int, m: Matrix, weights: list[float]) -> list[int]:
    idx = list(range(1, n_stops + 1))
    if n_stops <= 8:
        return list(min(itertools.permutations(idx), key=lambda o: evaluate(list(o), m, weights)[0]))

    # nearest neighbour on the combined cost, then 2-opt
    order, remaining, cur = [], set(idx), 0
    while remaining:
        nxt = min(remaining, key=lambda j: m.durations_s[cur][j] / max(weights[j], 0.1))
        order.append(nxt)
        remaining.remove(nxt)
        cur = nxt
    best = evaluate(order, m, weights)[0]
    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 1):
            for k in range(i + 1, len(order)):
                cand = order[:i] + order[i:k + 1][::-1] + order[k + 1:]
                c = evaluate(cand, m, weights)[0]
                if c + 1e-6 < best:
                    order, best, improved = cand, c, True
    return order


@dataclass
class RoutePlan:
    sequence: list[Point]
    distance_km: float
    duration_min: float
    baseline_distance_km: float
    baseline_duration_min: float
    geometry: list[list[float]]
    source: str


def optimise_route(depot: Point, stops: list[Point], fallback_speed_kmh: float, circuity: float) -> RoutePlan:
    pts = [depot] + stops
    m = travel_matrix(pts, fallback_speed_kmh, circuity)
    weights = [0.0] + [max(s.weight, 0.01) for s in stops]

    baseline_order = list(range(1, len(stops) + 1))  # dispatcher's entered order
    _, base_d, base_t = evaluate(baseline_order, m, weights)
    order = best_order(len(stops), m, weights)
    _, d, t = evaluate(order, m, weights)

    seq = [pts[i] for i in order]
    # Distances/times for both orders come from the same matrix so the comparison is like-for-like;
    # /route is used only for the drawable road geometry.
    geometry, _, _, _ = route_geometry([depot] + seq + [depot])
    return RoutePlan(
        sequence=seq,
        distance_km=round(d / 1000, 2),
        duration_min=round(t / 60, 1),
        baseline_distance_km=round(base_d / 1000, 2),
        baseline_duration_min=round(base_t / 60, 1),
        geometry=geometry,
        source=m.source,
    )
