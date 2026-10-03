"""Impact replay: the same stream of water requests served two ways, day by day.

Inputs (all read from the database, nothing invented here):
  * every water request raised in the window, in arrival order (real records, plus labelled synthetic demo
    history when the caller includes it; the response reports how many of each were used);
  * the communities those requests came from (the same fields the live priority score uses);
  * the real fleet: each operational tanker's capacity and depot.

Both strategies run the same fleet under the same physical limits each day: a tanker makes at most
``tripsPerDay`` trips and drives at most ``tankerShiftHours``; a trip takes road km / ``fallbackSpeedKmh`` plus
``stopServiceMinutes`` per stop (filling and unloading). Road km = straight line x ``roadCircuityFactor``.
Whatever is not served carries over to the next day.

Strategy A, first come first served (a phone-in tanker service without JalSetu):
  the dispatcher works down the queue in arrival order. Each request gets whole loads, one place per trip, from
  whichever tanker can still fit the round trip into its day (nearest depot first). A repeat call for a place
  that is already waiting is a separate request and is served again in its turn.

Strategy B, JalSetu:
  a repeat request for a place with an open request (same place, within ``requestDuplicateHours``) is merged.
  Loads are then planned round by round with the live auto-dispatch planner (``services.dispatch.plan``:
  priority x crisis x how much one load helps / distance, nearby places combined up to ``maxStops``).

Priority scores use each place's current data, not a reconstruction of each past day. Both strategies see
identical requests, fleet, depots and limits, so the difference between the results comes from the policy.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import SYNTHETIC, TANKER_MAINTENANCE
from ..models import Community, Depot, Tanker, WaterRequest, utcnow
from .allocation import jain_index
from .common import get_setting, haversine_m
from .dispatch import plan as dispatch_plan
from .priority import score_community
from .views import priority_context

IST = timedelta(hours=5, minutes=30)
VULNERABLE_FROM = 65  # vulnerability score at which services.priority.vulnerability_level says "High"


@dataclass
class Req:
    id: int
    community_id: str
    litres: int
    created_at: datetime
    synthetic: bool


@dataclass
class Place:
    id: str
    name: str
    lat: float
    lng: float
    priority: int
    crisis: float
    vulnerability: float

    @property
    def vulnerable(self) -> bool:
        return self.vulnerability >= VULNERABLE_FROM


@dataclass
class Truck:
    id: str
    capacity: int
    lat: float
    lng: float
    depot: str
    hours_left: float = 0.0
    trips_left: int = 0


@dataclass
class Limits:
    trips_per_day: int
    shift_hours: float
    speed_kmh: float
    stop_hours: float
    circuity: float


@dataclass
class Outcome:
    delivered: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    useful: dict[str, int] = field(default_factory=lambda: defaultdict(int))  # toward deduplicated need
    km: float = 0.0
    trips: int = 0
    capacity_sent: int = 0
    carried: int = 0
    hours: float = 0.0
    waits_h: list[float] = field(default_factory=list)
    served_requests: int = 0
    duplicates_served: int = 0
    duplicate_litres: int = 0
    first_day: dict[str, int] = field(default_factory=dict)
    daily: list[dict] = field(default_factory=list)


def ist_day(dt: datetime) -> datetime:
    local = dt + IST
    return datetime(local.year, local.month, local.day) - IST


def route_km(start: tuple[float, float], stops: list[tuple[float, float]], circuity: float) -> float:
    """Depot -> stops in nearest-neighbour order -> depot; straight line x circuity."""
    pos, left, km = start, list(stops), 0.0
    while left:
        nxt = min(left, key=lambda p: haversine_m(pos[0], pos[1], p[0], p[1]))
        km += haversine_m(pos[0], pos[1], nxt[0], nxt[1]) / 1000
        pos = nxt
        left.remove(nxt)
    return (km + haversine_m(pos[0], pos[1], start[0], start[1]) / 1000) * circuity


def mark_duplicates(reqs: list[Req], hours: int) -> dict[int, int]:
    """request id -> the earlier request for the same place it repeats (the live intake rule, applied to the stream)."""
    dup: dict[int, int] = {}
    last: dict[str, Req] = {}
    for r in reqs:
        prev = last.get(r.community_id)
        if prev and hours > 0 and r.created_at - prev.created_at <= timedelta(hours=hours):
            dup[r.id] = prev.id
            continue
        last[r.community_id] = r
    return dup


def _start_day(fleet: list[Truck], lim: Limits) -> None:
    for t in fleet:
        t.hours_left, t.trips_left = lim.shift_hours, lim.trips_per_day


def _trip_hours(km: float, stops: int, lim: Limits) -> float:
    return km / lim.speed_kmh + lim.stop_hours * stops


def _deliver(o: Outcome, place: Place, litres: int, day_i: int, need: dict[str, int]) -> None:
    o.delivered[place.id] += litres
    o.useful[place.id] += max(0, min(litres, need[place.id] - o.useful[place.id]))
    o.first_day.setdefault(place.id, day_i)


def _wait(day: datetime, r: Req) -> float:
    return max(0.0, (day + timedelta(hours=14) - r.created_at).total_seconds() / 3600)  # served around mid-afternoon IST


def run_fcfs(days: list[datetime], reqs: list[Req], places: dict[str, Place], fleet: list[Truck], lim: Limits,
             need: dict[str, int], dup: dict[int, int]) -> Outcome:
    o = Outcome()
    arrivals = defaultdict(list)
    for r in reqs:
        arrivals[ist_day(r.created_at)].append(r)
    queue: list[list] = []
    for i, day in enumerate(days):
        queue.extend([r, r.litres] for r in arrivals.get(day, []))
        _start_day(fleet, lim)
        sent = 0
        for item in queue:
            r, left = item
            p = places[r.community_id]
            while left > 0:
                options = []
                for t in fleet:
                    if t.trips_left <= 0:
                        continue
                    km = route_km((t.lat, t.lng), [(p.lat, p.lng)], lim.circuity)
                    h = _trip_hours(km, 1, lim)
                    if h <= t.hours_left:
                        options.append((km, h, t))
                if not options:
                    break
                km, h, t = min(options, key=lambda x: x[0])
                give = min(t.capacity, left)
                left -= give
                t.trips_left -= 1
                t.hours_left -= h
                o.km += km
                o.hours += h
                o.trips += 1
                o.capacity_sent += t.capacity
                o.carried += give
                sent += give
                _deliver(o, p, give, i, need)
                if r.id in dup:
                    o.duplicate_litres += give
            item[1] = left
            if left == 0:
                o.served_requests += 1
                o.waits_h.append(_wait(day, r))
                o.duplicates_served += r.id in dup
        queue = [q for q in queue if q[1] > 0]
        o.daily.append({"delivered": sent, "backlog": sum(q[1] for q in queue)})
    o.still_waiting = len(queue)  # type: ignore[attr-defined]
    return o


def _feasible(t: Truck, p: Place, lim: Limits) -> bool:
    return _trip_hours(route_km((t.lat, t.lng), [(p.lat, p.lng)], lim.circuity), 1, lim) <= t.hours_left


def run_jalsetu(days: list[datetime], reqs: list[Req], places: dict[str, Place], fleet: list[Truck], lim: Limits,
                need: dict[str, int], dup: dict[int, int], dcfg: dict, on_trip=None) -> Outcome:
    """``on_trip(day_index, truck, [(place_id, litres)], km, hours)`` is called for every trip (used by the demo
    history script so its synthetic trips follow exactly this policy and these limits)."""
    o = Outcome()
    arrivals = defaultdict(list)
    for r in reqs:
        arrivals[ist_day(r.created_at)].append(r)
    by_id = {r.id: r for r in reqs}
    owed: dict[str, int] = defaultdict(int)
    open_reqs: dict[str, list[Req]] = defaultdict(list)

    def cand(pid: str) -> dict:
        p = places[pid]
        return {"id": pid, "name": p.name, "lat": p.lat, "lng": p.lng, "priorityScore": p.priority,
                "crisisScore": p.crisis, "shortfall": owed[pid]}

    def tdict(t: Truck) -> dict:
        return {"id": t.id, "capacity": t.capacity, "lat": t.lat, "lng": t.lng, "depot": t.depot}

    for i, day in enumerate(days):
        for r in arrivals.get(day, []):
            if r.id in dup and by_id[dup[r.id]] in open_reqs[r.community_id]:
                owed[r.community_id] += max(0, r.litres - by_id[dup[r.id]].litres)  # merged: only extra litres count
                continue
            owed[r.community_id] += r.litres
            open_reqs[r.community_id].append(r)
        _start_day(fleet, lim)
        sent = 0
        while True:
            trucks = [t for t in fleet if t.trips_left > 0 and t.hours_left > lim.stop_hours]
            waiting = [pid for pid, n in owed.items() if n > 0]
            if not trucks or not waiting:
                break
            plans = dispatch_plan([tdict(t) for t in trucks], [cand(pid) for pid in waiting], dcfg)
            tmap = {t.id: t for t in trucks}
            planned = {pl["tanker"]["id"]: pl for pl in plans}
            progressed = False
            for t in trucks:
                pl = planned.get(t.id)
                stops = [(s["id"], min(s["litres"], owed[s["id"]])) for s in pl["stops"] if owed[s["id"]] > 0] if pl else []
                km = route_km((t.lat, t.lng), [(places[pid].lat, places[pid].lng) for pid, _ in stops], lim.circuity) if stops else 0
                if not stops or _trip_hours(km, len(stops), lim) > t.hours_left:
                    # Its first choice no longer fits today: re-plan this truck over places it can still reach and return from.
                    reach = [cand(pid) for pid in waiting if owed[pid] > 0 and _feasible(t, places[pid], lim)]
                    alt = dispatch_plan([tdict(t)], reach, {**dcfg, "maxStops": 1}) if reach else []
                    if not alt:
                        t.trips_left = 0
                        continue
                    stops = [(s["id"], min(s["litres"], owed[s["id"]])) for s in alt[0]["stops"]]
                    km = route_km((t.lat, t.lng), [(places[pid].lat, places[pid].lng) for pid, _ in stops], lim.circuity)
                h = _trip_hours(km, len(stops), lim)
                t.trips_left -= 1
                t.hours_left -= h
                o.km += km
                o.hours += h
                o.trips += 1
                o.capacity_sent += t.capacity
                for pid, give in stops:
                    owed[pid] -= give
                    o.carried += give
                    sent += give
                    _deliver(o, places[pid], give, i, need)
                if on_trip:
                    on_trip(i, t, stops, km, h)
                progressed = True
            if not progressed:
                break
        for pid in list(open_reqs):
            if owed[pid] <= 0 and open_reqs[pid]:
                for r in open_reqs[pid]:
                    o.served_requests += 1
                    o.waits_h.append(_wait(day, r))
                open_reqs[pid] = []
                owed[pid] = 0
        o.daily.append({"delivered": sent, "backlog": sum(max(0, n) for n in owed.values())})
    o.still_waiting = sum(len(v) for v in open_reqs.values())  # type: ignore[attr-defined]
    o.open_requests = open_reqs  # type: ignore[attr-defined]
    return o


def summary(o: Outcome, need: dict[str, int], places: dict[str, Place], n_unique: int, fuel: dict) -> dict:
    total = sum(need.values()) or 1
    useful = sum(min(o.useful[p], need[p]) for p in need)
    coverage = sorted(min(1.0, o.useful[p] / need[p]) if need[p] else 1.0 for p in need)
    vulnerable = [p for p in need if places[p].vulnerable]
    worst = coverage[: max(1, len(coverage) // 5)]
    km = o.km
    fuel_l = km / fuel["kmPerLitre"] if fuel["kmPerLitre"] else 0.0
    waits = sorted(o.waits_h)
    return {
        "litresDelivered": sum(o.delivered.values()),
        "litresTowardNeed": useful,
        "unmetLitres": total - useful,
        "unmetPct": round(100 * (total - useful) / total, 1),
        "requestsFullyServed": o.served_requests,
        "requestsStillWaiting": getattr(o, "still_waiting", None),
        "uniqueNeeds": n_unique,
        "medianWaitHours": round(waits[len(waits) // 2], 1) if waits else None,
        "avgWaitHours": round(sum(waits) / len(waits), 1) if waits else None,
        "fairnessJain": round(100 * jain_index(coverage), 1) if coverage else None,
        "worstFifthCoveragePct": round(100 * sum(worst) / len(worst), 1) if worst else None,
        "placesReached": sum(1 for p in need if o.delivered.get(p, 0) > 0),
        "placesTotal": len(need),
        "vulnerablePlaces": len(vulnerable),
        "vulnerablePlacesReached": sum(1 for p in vulnerable if o.delivered.get(p, 0) > 0),
        "vulnerableCoveragePct": round(100 * sum(min(o.useful[p], need[p]) for p in vulnerable)
                                       / max(sum(need[p] for p in vulnerable), 1), 1) if vulnerable else None,
        "trips": o.trips,
        "kmDriven": round(km, 1),
        "drivingHours": round(o.hours, 1),
        "fuelLitres": round(fuel_l, 1),
        "fuelInr": round(fuel_l * fuel["pricePerLitre"]),
        "co2Kg": round(fuel_l * fuel["co2PerLitre"], 1),
        "loadUtilisationPct": round(100 * o.carried / o.capacity_sent, 1) if o.capacity_sent else None,
        "litresPerKm": round(useful / km, 1) if km else None,
        "duplicateRequestsServed": o.duplicates_served,
        "litresOnDuplicates": o.duplicate_litres,
    }


def replay(db: Session, days: int = 30, include_synthetic: bool = True) -> dict:
    ops = get_setting(db, "operations")
    dcfg = get_setting(db, "dispatch")
    weights = get_setting(db, "weights")
    now = utcnow()
    end = ist_day(now) + timedelta(days=1)
    start = end - timedelta(days=days)

    q = (select(WaterRequest).where(WaterRequest.created_at >= start, WaterRequest.created_at < end)
         .order_by(WaterRequest.created_at, WaterRequest.id))
    if not include_synthetic:
        q = q.where(WaterRequest.data_origin != SYNTHETIC)
    reqs = [Req(r.id, r.community_id, int(r.requested_amount), r.created_at, r.data_origin == SYNTHETIC) for r in db.scalars(q)]
    # Requested litres are what the caller asked for at the time; a merged row's amount may have been raised later,
    # but the original requested figure is kept in its assessment-free column, so use it as stored.

    depots = {d.id: d for d in db.scalars(select(Depot).where(Depot.is_active.is_(True)))}
    tankers = [t for t in db.scalars(select(Tanker).where(Tanker.status != TANKER_MAINTENANCE)) if t.depot_id in depots]
    lim = Limits(int(ops["tripsPerDay"]), float(ops["tankerShiftHours"]), float(ops["fallbackSpeedKmh"]),
                 float(ops["stopServiceMinutes"]) / 60, float(ops["roadCircuityFactor"]))

    base = {
        "windowDays": days, "from": start.isoformat() + "Z", "to": end.isoformat() + "Z", "includeSynthetic": include_synthetic,
        "requests": {"total": len(reqs), "synthetic": sum(r.synthetic for r in reqs), "real": sum(not r.synthetic for r in reqs)},
        "fleet": {"tankers": len(tankers), "depots": len({t.depot_id for t in tankers}), "tripsPerDay": lim.trips_per_day,
                  "shiftHours": lim.shift_hours, "speedKmh": lim.speed_kmh, "stopMinutes": ops["stopServiceMinutes"],
                  "capacityLitres": sum(t.capacity for t in tankers)},
    }
    if not reqs or not tankers:
        return {**base, "available": False,
                "reason": "No water requests in this window." if not reqs else "No operational tanker at an active depot."}

    comms = {c.id: c for c in db.scalars(select(Community).where(Community.id.in_({r.community_id for r in reqs})))}
    ctx = priority_context(db, list(db.scalars(select(Community).where(Community.is_active.is_(True)))))
    places = {}
    for cid, c in comms.items():
        places[cid] = Place(cid, c.name, c.lat, c.lng, score_community(c, weights, ctx).score, float(c.crisis_score or 0),
                            float(c.vulnerability_score))

    dup = mark_duplicates(reqs, int(ops["requestDuplicateHours"]))
    by_id = {r.id: r for r in reqs}
    need: dict[str, int] = defaultdict(int)
    for r in reqs:
        need[r.community_id] += max(0, r.litres - by_id[dup[r.id]].litres) if r.id in dup else r.litres
    need = dict(need)

    day_list = [start + timedelta(days=i) for i in range(days)]
    fuel = {"kmPerLitre": ops["tankerKmPerLitre"], "pricePerLitre": ops["dieselPricePerLitre"], "co2PerLitre": ops["co2KgPerLitreDiesel"]}

    def fleet() -> list[Truck]:
        return [Truck(t.id, t.capacity, depots[t.depot_id].lat, depots[t.depot_id].lng, depots[t.depot_id].name) for t in tankers]

    a = run_fcfs(day_list, reqs, places, fleet(), lim, need, dup)
    b = run_jalsetu(day_list, reqs, places, fleet(), lim, need, dup, dcfg)
    n_unique = len(reqs) - len(dup)
    sa, sb = summary(a, need, places, n_unique, fuel), summary(b, need, places, n_unique, fuel)

    daily, cum_a, cum_b = [], 0, 0
    for i, d in enumerate(day_list):
        cum_a += a.daily[i]["delivered"]
        cum_b += b.daily[i]["delivered"]
        daily.append({"date": (d + IST).date().isoformat(), "requests": sum(1 for r in reqs if ist_day(r.created_at) == d),
                      "fcfsDelivered": a.daily[i]["delivered"], "jalsetuDelivered": b.daily[i]["delivered"],
                      "fcfsCumulative": cum_a, "jalsetuCumulative": cum_b,
                      "fcfsBacklog": a.daily[i]["backlog"], "jalsetuBacklog": b.daily[i]["backlog"]})

    per_place = []
    for pid, n in need.items():
        p = places[pid]
        per_place.append({
            "communityId": pid, "name": p.name, "priority": p.priority, "vulnerability": round(p.vulnerability), "vulnerable": p.vulnerable,
            "crisis": round(p.crisis), "needLitres": n,
            "requests": sum(1 for r in reqs if r.community_id == pid), "repeats": sum(1 for r in reqs if r.community_id == pid and r.id in dup),
            "fcfsCoveragePct": round(100 * min(1.0, a.useful.get(pid, 0) / n), 1) if n else 100.0,
            "jalsetuCoveragePct": round(100 * min(1.0, b.useful.get(pid, 0) / n), 1) if n else 100.0,
            "fcfsFirstServedDay": a.first_day.get(pid), "jalsetuFirstServedDay": b.first_day.get(pid),
        })
    per_place.sort(key=lambda r: -r["priority"])

    # Coverage distribution: how many places ended at each coverage level under each strategy.
    bands = [(0, 0), (1, 25), (26, 50), (51, 75), (76, 99), (100, 100)]
    dist = []
    for lo, hi in bands:
        label = "0%" if hi == 0 else ("100%" if lo == 100 else f"{lo}-{hi}%")
        dist.append({"band": label,
                     "fcfs": sum(1 for r in per_place if lo <= round(r["fcfsCoveragePct"]) <= hi),
                     "jalsetu": sum(1 for r in per_place if lo <= round(r["jalsetuCoveragePct"]) <= hi)})

    return {
        **base,
        "available": True,
        "needLitres": sum(need.values()),
        "places": len(need),
        "duplicates": {"requests": len(dup), "litresAsked": sum(by_id[i].litres for i in dup),
                       "fcfsServedAgain": a.duplicates_served, "fcfsLitresOnRepeats": a.duplicate_litres, "jalsetuMerged": len(dup)},
        "fcfs": sa,
        "jalsetu": sb,
        "daily": daily,
        "coverageBands": dist,
        "perPlace": per_place[:400],
        "assumptions": [
            f"Same {len(reqs):,} requests, same {len(tankers)} tankers and {base['fleet']['depots']} depots for both strategies.",
            f"Each tanker: at most {lim.trips_per_day} trips and {lim.shift_hours:g} driving hours a day, {lim.speed_kmh:g} km/h, "
            f"{ops['stopServiceMinutes']} min per stop for filling/unloading.",
            "First come first served: strict arrival order, whole loads, one place per trip, repeat calls served again.",
            f"JalSetu: repeats within {int(ops['requestDuplicateHours'])} h merged; loads planned by the live auto-dispatch planner "
            f"(up to {int(dcfg['maxStops'])} stops within {dcfg['clusterRadiusKm']:g} km, reach {dcfg['maxDistanceKm']:g} km).",
            f"Road km = straight line x {lim.circuity:g} (estimate). Fuel at {ops['tankerKmPerLitre']:g} km/L, Rs {ops['dieselPricePerLitre']:g}/L.",
            "Priority uses each place's current data, not each past day's. Need = litres asked; a repeat adds only what it asks beyond the original.",
            f"\"Vulnerable\" = vulnerability score {VULNERABLE_FROM}+ (High or Very High).",
        ],
        "method": "Deterministic day-by-day replay (backend/app/services/impact.py)",
        "generatedAt": now.isoformat(timespec="seconds") + "Z",
    }
