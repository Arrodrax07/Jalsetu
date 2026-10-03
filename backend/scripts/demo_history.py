"""Clearly labelled SYNTHETIC demo history, so trend charts and the impact replay have something to show.

    python -m scripts.demo_history                 # 28 days ending yesterday (IST)
    python -m scripts.demo_history --days 42 --seed 11 --pressure 1.5
    python -m scripts.demo_history --remove        # delete every synthetic record

What it writes (every row has data_origin="synthetic" and says so in its text fields):
  * water requests from REAL communities that currently need tanker water and lie within a tanker's local
    service area (``--area-km`` of an active depot), weighted towards places with live crisis signals and higher
    priority; about one in seven is a repeat call for a place already waiting, as happens on a phone line.
    Volume: litres asked per day ~ ``--pressure`` x what the real fleet can actually deliver in a day there,
    rising through the window as the season dries;
  * completed trips and verified deliveries for those requests, produced by the impact replay's JalSetu policy
    (services/impact.run_jalsetu: repeats merged, live auto-dispatch planner, real fleet and depots, the same
    driving-hour and trip limits), so the history and the impact page agree.

What it never writes: GPS telemetry (no position is ever invented), anything dated today or later, or anything
operational: synthetic requests are closed (Delivered / Merged / Rejected), synthetic trips are Completed, and
live queries (priority, dispatch, queues, overview counts) ignore data_origin="synthetic".
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.db import SessionLocal, init_db
from app.domain import SYNTHETIC, TANKER_MAINTENANCE
from app.models import Community, Delivery, Depot, Tanker, Trip, TripStop, WaterRequest
from app.services import supply
from app.services.common import get_setting, haversine_m
from app.services.impact import Limits, Place, Req, Truck, mark_duplicates, route_km, run_jalsetu
from app.services.priority import score_community, urgency_from_score
from app.services.views import priority_context

IST = timedelta(hours=5, minutes=30)
LABEL = "[SYNTHETIC demo history]"


def remove(db) -> dict:
    trip_ids = list(db.scalars(select(Trip.id).where(Trip.data_origin == SYNTHETIC)))
    n_del = db.execute(delete(Delivery).where(Delivery.data_origin == SYNTHETIC)).rowcount
    if trip_ids:
        db.execute(delete(TripStop).where(TripStop.trip_id.in_(trip_ids)))
    n_trip = db.execute(delete(Trip).where(Trip.data_origin == SYNTHETIC)).rowcount
    db.query(WaterRequest).filter(WaterRequest.data_origin == SYNTHETIC).update({WaterRequest.duplicate_of_id: None})
    n_req = db.execute(delete(WaterRequest).where(WaterRequest.data_origin == SYNTHETIC)).rowcount
    db.commit()
    return {"requests": n_req, "trips": n_trip, "deliveries": n_del}


def generate(db, days: int, seed: int, pressure: float, area_km: float) -> dict:
    rng = random.Random(seed)
    ops = get_setting(db, "operations")
    dcfg = get_setting(db, "dispatch")
    weights = get_setting(db, "weights")
    lim = Limits(int(ops["tripsPerDay"]), float(ops["tankerShiftHours"]), float(ops["fallbackSpeedKmh"]),
                 float(ops["stopServiceMinutes"]) / 60, float(ops["roadCircuityFactor"]))

    depots = {d.id: d for d in db.scalars(select(Depot).where(Depot.is_active.is_(True)))}
    tankers = [t for t in db.scalars(select(Tanker).where(Tanker.status != TANKER_MAINTENANCE)) if t.depot_id in depots]
    if not tankers:
        raise SystemExit("No operational tanker at an active depot: nothing could have delivered.")
    used_depots = {t.depot_id for t in tankers}
    active = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    ctx = priority_context(db, active)

    def depot_km(c) -> float:
        return min(haversine_m(c.lat, c.lng, depots[d].lat, depots[d].lng) for d in used_depots) / 1000

    pool = [c for c in active if supply.tanker_need(c) > 0 and depot_km(c) <= area_km]
    if not pool:
        raise SystemExit(f"No community with a tanker need within {area_km:g} km of a tanker's depot.")
    score = {c.id: score_community(c, weights, ctx) for c in pool}
    by_cid = {c.id: c for c in pool}
    # Likelihood of calling: crisis signals and priority, damped for big towns (they call the corporation).
    w = [(1 + (c.crisis_score or 0) / 25) * (score[c.id].score / 50) ** 2 / (1 + math.log10(max(c.population, 10)) / 6) for c in pool]

    # What the fleet can really deliver per day in this area: trips limited by time at the pool's typical distance.
    avg_km = sum(2 * depot_km(c) * lim.circuity for c in pool) / len(pool)
    trips_each = min(lim.trips_per_day, max(1.0, lim.shift_hours / (avg_km / lim.speed_kmh + lim.stop_hours)))
    deliverable = sum(t.capacity for t in tankers) * trips_each

    today = (datetime.now(timezone.utc).replace(tzinfo=None) + IST).date()
    first = today - timedelta(days=days)
    rows: list[WaterRequest] = []
    for i in range(days):
        day = first + timedelta(days=i)
        day0 = datetime(day.year, day.month, day.day) - IST
        ramp = pressure * (0.6 + 0.8 * i / max(1, days - 1))
        n = max(1, round(rng.gauss(ramp * deliverable / 11000, 1.5)) - (1 if day.isoweekday() == 7 else 0))
        recent = [r for r in rows if r.created_at >= day0 - timedelta(hours=36)]
        for _ in range(n):
            c = (by_cid[rng.choice(recent).community_id] if recent and rng.random() < 0.15
                 else rng.choices(pool, weights=w)[0])
            at = day0 + timedelta(hours=min(21, max(6, int(rng.gauss(10.5, 2.8)))), minutes=rng.randrange(60))
            amount = int(min(max(supply.tanker_need(c), 2000), rng.choice([5000, 8000, 10000, 12000, 15000, 20000])) // 500 * 500)
            pr = score[c.id]
            rows.append(WaterRequest(
                community_id=c.id, requested_amount=amount, urgency=urgency_from_score(pr.score), people_currently_served=0,
                reason=f"{LABEL} Tanker requested for {c.name}.", days_without_water=rng.choice([0, 0, 1, 1, 2, 3, 4]),
                contact_person="Synthetic caller", phone="SYNTHETIC", status="Pending", priority_score=pr.score,
                assessment={"synthetic": True, "priorityScore": pr.score, "factors": pr.subscores, "reasoning": pr.explanation},
                data_origin=SYNTHETIC, created_at=at, updated_at=at))
    rows.sort(key=lambda r: r.created_at)
    db.add_all(rows)
    db.flush()

    reqs = [Req(r.id, r.community_id, r.requested_amount, r.created_at, True) for r in rows]
    dup = mark_duplicates(reqs, int(ops["requestDuplicateHours"]))
    by_row = {r.id: r for r in rows}
    for rid, orig in dup.items():
        r = by_row[rid]
        r.status, r.duplicate_of_id = "Merged", orig
        r.duplicate_reason = f"{LABEL} Repeat call; merged into WR-{1000 + orig}."
    need: dict[str, int] = {}
    for r in reqs:
        need[r.community_id] = need.get(r.community_id, 0) + (max(0, r.litres - by_row[dup[r.id]].requested_amount) if r.id in dup else r.litres)
    pmap = {c.id: Place(c.id, c.name, c.lat, c.lng, score[c.id].score, float(c.crisis_score or 0), float(c.vulnerability_score))
            for c in pool if c.id in need}
    fleet = [Truck(t.id, t.capacity, depots[t.depot_id].lat, depots[t.depot_id].lng, depots[t.depot_id].name) for t in tankers]
    tank = {t.id: t for t in tankers}
    clock: dict[tuple[int, str], datetime] = {}
    day_starts = [datetime(d.year, d.month, d.day) - IST for d in (first + timedelta(days=i) for i in range(days))]
    counts = {"trips": 0, "deliveries": 0}
    delivered_at: dict[str, datetime] = {}

    def on_trip(day_i: int, truck: Truck, stops: list[tuple[str, int]], km: float, hours: float) -> None:
        t = tank[truck.id]
        start = clock.get((day_i, t.id), day_starts[day_i] + timedelta(hours=7)) + timedelta(minutes=rng.randrange(10, 30))
        end = start + timedelta(hours=hours)
        clock[(day_i, t.id)] = end
        single = sum(2 * haversine_m(truck.lat, truck.lng, pmap[p].lat, pmap[p].lng) / 1000 for p, _ in stops) * lim.circuity
        trip = Trip(tanker_id=t.id, status="Completed", origin_depot_id=t.depot_id, distance_km=round(km, 2),
                    duration_min=round(hours * 60, 1), baseline_distance_km=round(max(single, km), 2),
                    baseline_duration_min=round((max(single, km) / lim.speed_kmh + lim.stop_hours * len(stops)) * 60, 1),
                    routing_source="synthetic-estimate", created_at=start - timedelta(minutes=40), assigned_at=start - timedelta(minutes=35),
                    accepted_at=start - timedelta(minutes=15), started_at=start, driver_ended_at=end,
                    verified_at=end + timedelta(minutes=45), completed_at=end + timedelta(minutes=45), data_origin=SYNTHETIC)
        db.add(trip)
        db.flush()
        pos, elapsed = (truck.lat, truck.lng), 0.0
        for seq, (pid, litres) in enumerate(stops):
            p = pmap[pid]
            elapsed += route_km(pos, [(p.lat, p.lng)], lim.circuity) / 2 / lim.speed_kmh + lim.stop_hours  # one leg, not a round trip
            pos = (p.lat, p.lng)
            at = start + timedelta(hours=elapsed)
            if seq == 0:
                trip.arrived_at = at - timedelta(minutes=20)
            stop = TripStop(trip_id=trip.id, seq=seq, community_id=pid, allocated_litres=litres, status="Verified",
                            arrived_at=at - timedelta(minutes=20), delivered_at=at, verified_at=trip.verified_at)
            db.add(stop)
            db.flush()
            got = int(litres * rng.uniform(0.97, 1.0) // 100 * 100)
            db.add(Delivery(trip_stop_id=stop.id, trip_id=trip.id, tanker_id=t.id, community_id=pid, allocated_amount=litres,
                            delivered_amount=got, delivered_at=at, gps_verified=False, receiver_name="Synthetic record",
                            officer_verified=True, verified_by="synthetic demo history", verified_at=trip.verified_at,
                            status="Verified", variance_amount=got - litres, notes=f"{LABEL} No GPS: a position is never invented.",
                            trip_minutes=round(elapsed * 60, 1), recorded_by="scripts/demo_history.py", data_origin=SYNTHETIC))
            delivered_at[pid] = at
            counts["deliveries"] += 1
        counts["trips"] += 1

    out = run_jalsetu(day_starts, reqs, pmap, fleet, lim, need, dup, dcfg, on_trip=on_trip)
    still_open = {r.id for v in out.open_requests.values() for r in v}  # type: ignore[attr-defined]
    for r in rows:
        if r.status == "Merged":
            continue
        if r.id in still_open:
            r.status = "Rejected"
            r.reason += " Still unserved when the synthetic history window ended; closed so it never enters live queues."
        else:
            r.status, r.fulfilled_at = "Delivered", delivered_at.get(r.community_id)
    db.commit()
    return {"days": days, "from": first.isoformat(), "to": (today - timedelta(days=1)).isoformat(), "requests": len(rows),
            "merged": len(dup), "trips": counts["trips"], "deliveries": counts["deliveries"], "closedUnserved": len(still_open),
            "placesInArea": len(pool), "placesRequesting": len(need), "fleet": len(tankers),
            "deliverableLitresPerDay": round(deliverable), "pressure": pressure, "areaKm": area_km}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--pressure", type=float, default=1.3, help="litres asked / litres the fleet can deliver (window average)")
    ap.add_argument("--area-km", type=float, default=60, help="requests come from places this close to a tanker's depot")
    ap.add_argument("--remove", action="store_true", help="delete all synthetic history and exit")
    a = ap.parse_args()
    init_db()
    with SessionLocal() as db:
        print("removed previous synthetic history:", remove(db))
        if not a.remove:
            print("created:", generate(db, max(1, min(a.days, 120)), a.seed, a.pressure, a.area_km))


if __name__ == "__main__":
    main()
