"""Fleet simulator — for testing/training without physical GPS devices.

Drives every dispatched trip along its real road geometry by posting GPS pings and
proof-of-delivery records through the same HTTP API the driver app uses. It is a client
of the API, not a back door: everything it does is audited like a real driver.

    python -m scripts.simulate_fleet --api http://localhost:8000/api --email admin@jalsetu.local --password ...
        [--speed-kmh 28] [--tick 2] [--time-scale 10] [--short-delivery-rate 0.15]
"""
from __future__ import annotations

import argparse
import math
import random
import time

import httpx


def hav_m(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def densify(path, step_m):
    """Resample a polyline every ~step_m metres."""
    out = [path[0]]
    for a, b in zip(path, path[1:]):
        d = hav_m(a, b)
        n = max(1, int(d // step_m))
        for k in range(1, n + 1):
            out.append([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000/api")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--speed-kmh", type=float, default=28)
    ap.add_argument("--tick", type=float, default=2.0, help="seconds between pings")
    ap.add_argument("--time-scale", type=float, default=10.0, help="simulated seconds per real second")
    ap.add_argument("--short-delivery-rate", type=float, default=0.15, help="probability a stop is short-delivered")
    a = ap.parse_args()

    c = httpx.Client(base_url=a.api, timeout=15)
    tok = c.post("/auth/login", json={"email": a.email, "password": a.password}).raise_for_status().json()["accessToken"]
    c.headers["Authorization"] = f"Bearer {tok}"

    state: dict[str, dict] = {}
    print("simulator running — Ctrl+C to stop")
    while True:
        trips = c.get("/trips", params={"active": True}).raise_for_status().json()
        for trip in trips:
            st = state.get(trip["id"])
            if st is None:
                step = a.speed_kmh / 3.6 * a.tick * a.time_scale
                path = densify(trip["routeGeometry"] or [[s["lat"], s["lng"]] for s in trip["stops"]], step)
                # Each stop is served at the closest point of the (road-snapped) route, in stop order.
                arrive, start = {}, 0
                for s in trip["stops"]:
                    j = min(range(start, len(path)), key=lambda k: hav_m(path[k], (s["lat"], s["lng"])))
                    arrive[s["id"]], start = j, j
                st = state[trip["id"]] = {"path": path, "i": 0, "arrive": arrive}
            path, i = st["path"], st["i"]
            if i >= len(path):
                continue
            pos = path[i]
            c.post("/tracking/ping", json={"tankerId": trip["tankerId"], "lat": pos[0], "lng": pos[1],
                                           "speedKmh": a.speed_kmh + random.uniform(-6, 6)})
            for stop in trip["stops"]:
                if stop["status"] == "Pending" and i >= st["arrive"][stop["id"]]:
                    litres = stop["allocatedLitres"]
                    if random.random() < a.short_delivery_rate:
                        litres = int(litres * random.uniform(0.6, 0.9) // 100 * 100)
                    r = c.post("/deliveries", data={"tripStopId": stop["id"], "deliveredAmount": litres, "lat": pos[0], "lng": pos[1],
                                                    "notes": "simulated"})
                    print(f"{trip['id']} delivered {litres} L at {stop['communityName']}: {r.status_code} {r.json().get('status')}", flush=True)
                    stop["status"] = "Delivered"
            st["i"] = i + 1
        time.sleep(a.tick)


if __name__ == "__main__":
    main()
