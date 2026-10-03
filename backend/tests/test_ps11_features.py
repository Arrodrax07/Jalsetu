"""PS 11 additions: request dedupe, distance factor, impact replay, tap schedules, offline complaints, public summary."""
from datetime import datetime, timedelta

from conftest import STAFF_PW  # noqa: F401  (fixtures come from conftest)

REQ = {"communityId": "c-govandi", "requestedAmount": 9000, "reason": "Standpost dry since Monday",
       "daysWithoutWater": 2, "contactPerson": "Asha Pawar", "phone": "9820000000"}


def test_public_summary_without_login(client):
    r = client.get("/api/public/summary")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict) and body  # shape is checked by the landing page; here: public, non-empty, cached
    assert client.get("/api/public/summary").json() == body


def test_water_access_factor_in_priority(client, admin):
    from app.db import SessionLocal
    from app.services import access

    with SessionLocal() as db:
        assert access.recompute(db) > 0
    rows = client.get("/api/communities", headers=admin).json()
    c = rows[0]
    assert c["waterAccessKm"] is not None and "straight line" in c["waterAccessNote"]
    assert "waterAccess" in c["priorityFactors"]
    assert c["priorityFactors"]["waterAccess"] == min(100.0, round(100 * c["waterAccessKm"] / 30, 1))


def test_request_duplicate_is_merged_and_can_be_overridden(client, operator):
    first = client.post("/api/requests", headers=operator, json=REQ)
    assert first.status_code == 201 and first.json()["status"] == "Pending"
    preview = client.post("/api/requests/assess", headers=operator, json={**REQ, "requestedAmount": 12000}).json()
    assert preview["possibleDuplicateOf"] == first.json()["id"]

    second = client.post("/api/requests", headers=operator, json={**REQ, "requestedAmount": 12000, "contactPerson": "Ravi Pawar"})
    body = second.json()
    assert body["status"] == "Merged" and body["duplicateOf"] == first.json()["id"] and "merged" in body["duplicateReason"]
    rows = {r["id"]: r for r in client.get("/api/requests", headers=operator).json()}
    assert rows[first.json()["id"]]["requestedAmount"] == 12000  # larger figure kept on the open request

    third = client.post("/api/requests", headers=operator, json={**REQ, "allowDuplicate": True})
    assert third.json()["status"] == "Pending" and "separate" in third.json()["duplicateReason"]

    split = client.patch(f"/api/requests/{body['id']}/status", headers=operator, json={"status": "Pending"})
    assert split.status_code == 200 and split.json()["duplicateOf"] is None


def test_offline_complaint_resend_is_idempotent(client):
    ref = "dev-12345678-offline-1"
    body = {"communityId": "c-dharavi", "description": "नळाला पाणी आलं नाही, तीन दिवस झाले", "language": "mr",
            "inputMode": "voice", "clientRef": ref, "queuedAt": (datetime.now() - timedelta(hours=3)).isoformat()}
    a = client.post("/api/public/complaints", json=body, headers={"X-Forwarded-For": "10.0.0.9"})
    assert a.status_code == 201 and a.json()["replayed"] is False
    b = client.post("/api/public/complaints", json=body)
    assert b.status_code == 201 and b.json()["replayed"] is True and b.json()["id"] == a.json()["id"]
    status = client.get(f"/api/public/complaints/{a.json()['id']}").json()
    assert status["status"] in ("Pending", "Escalated") and "reporterPhone" not in status


def test_tap_schedule_and_public_supply(client, operator, dispatcher):
    sched = {"communityId": "c-kurla", "pointName": "Ward L standpost near the market", "kind": "standpost",
             "days": [1, 3, 5], "startTime": "06:00", "endTime": "08:30"}
    assert client.post("/api/schedules", headers=dispatcher, json=sched).status_code == 403  # dispatchers do not publish
    assert client.post("/api/schedules", headers=operator, json={**sched, "startTime": "6am"}).status_code == 422
    r = client.post("/api/schedules", headers=operator, json=sched)
    assert r.status_code == 201
    s = r.json()
    assert s["daysLabel"] == "Mon, Wed, Fri" and s["next"]["startsAt"]
    notice = client.post("/api/supply-notices", headers=operator,
                         json={"communityId": "c-kurla", "kind": "interruption", "message": "Pipeline repair: no piped supply Thursday."})
    assert notice.status_code == 201

    pub = client.get("/api/public/supply/c-kurla").json()
    assert pub["community"]["name"] and pub["nextSupply"]["pointName"] == sched["pointName"]
    assert pub["notices"][0]["message"].startswith("Pipeline repair")
    assert 0 <= pub["estimatedCoveragePct"] <= 100
    assert any(p["id"] == "c-kurla" for p in client.get("/api/public/schedules").json())

    client.post(f"/api/supply-notices/{notice.json()['id']}/end", headers=operator)
    assert client.get("/api/public/supply/c-kurla").json()["notices"] == []
    assert client.delete(f"/api/schedules/{s['id']}", headers=operator).status_code == 204


def test_next_window_handles_overnight_and_weekdays():
    from app.models import TapSchedule
    from app.routers.schedules import next_window

    s = TapSchedule(days=[3], start_time="22:00", end_time="02:00")  # Wednesday night
    wed_23_ist = datetime(2026, 10, 7, 23, 0) - timedelta(hours=5, minutes=30)
    w = next_window(s, wed_23_ist)
    assert w["running"] is True
    thu_03_ist = datetime(2026, 10, 8, 3, 0) - timedelta(hours=5, minutes=30)
    assert next_window(s, thu_03_ist)["running"] is False


def test_impact_replay_strategies_on_same_stream():
    from app.services.impact import Limits, Place, Req, Truck, ist_day, mark_duplicates, run_fcfs, run_jalsetu, summary

    t0 = datetime(2026, 9, 1, 3, 0)
    places = {
        "near": Place("near", "Near village", 19.10, 72.90, priority=40, crisis=0, vulnerability=50),
        "far": Place("far", "Remote hamlet", 19.30, 73.10, priority=90, crisis=60, vulnerability=80),
    }
    reqs = [Req(1, "near", 10000, t0, True), Req(2, "near", 10000, t0 + timedelta(hours=2), True),  # repeat call
            Req(3, "far", 10000, t0 + timedelta(hours=3), True)]
    dup = mark_duplicates(reqs, 48)
    assert dup == {2: 1}
    need = {"near": 10000, "far": 10000}
    lim = Limits(trips_per_day=1, shift_hours=10, speed_kmh=30, stop_hours=0.5, circuity=1.3)
    days = [ist_day(t0) + timedelta(days=i) for i in range(2)]
    fleet = lambda: [Truck("T1", 10000, 19.05, 72.88, "Depot")]  # noqa: E731
    cfg = {"maxDistanceKm": 150, "clusterRadiusKm": 15, "maxStops": 3}
    fcfs = summary(run_fcfs(days, reqs, places, fleet(), lim, need, dup), need, places, 2, {"kmPerLitre": 4, "pricePerLitre": 90, "co2PerLitre": 2.68})
    js = summary(run_jalsetu(days, reqs, places, fleet(), lim, need, dup, cfg), need, places, 2, {"kmPerLitre": 4, "pricePerLitre": 90, "co2PerLitre": 2.68})
    # FCFS spends its second day's only load on the repeat call; JalSetu merges it and reaches the remote hamlet.
    assert fcfs["duplicateRequestsServed"] == 1 and fcfs["litresOnDuplicates"] == 10000
    assert js["duplicateRequestsServed"] == 0
    assert js["vulnerablePlacesReached"] == 1 and fcfs["vulnerablePlacesReached"] == 0
    assert js["unmetLitres"] == 0 and fcfs["unmetLitres"] == 10000


def test_synthetic_history_never_reaches_live_queues(client, operator):
    from app.db import SessionLocal
    from app.domain import SYNTHETIC
    from app.models import Trip, WaterRequest
    from scripts.demo_history import generate, remove

    with SessionLocal() as db:
        made = generate(db, days=5, seed=3, pressure=1.2, area_km=100)
        assert made["requests"] > 0
        assert db.query(WaterRequest).filter(WaterRequest.data_origin == SYNTHETIC,
                                             WaterRequest.status.in_(("Pending", "Allocated", "Dispatched"))).count() == 0
        assert db.query(Trip).filter(Trip.data_origin == SYNTHETIC, Trip.status != "Completed").count() == 0
    assert all(r["dataOrigin"] != SYNTHETIC for r in client.get("/api/requests", headers=operator).json())
    assert all("SYNTHETIC" not in (t.get("routingSource") or "").upper() for t in client.get("/api/trips", headers=operator).json())
    ops = client.get("/api/analytics/operations?days=30", headers=operator).json()
    assert ops["synthetic"]["trips"] >= 1
    real = client.get("/api/analytics/operations?days=30&origin=real", headers=operator).json()
    assert real["synthetic"]["trips"] == 0 and real["tripsCompleted"] <= ops["tripsCompleted"]
    replay = client.get("/api/analytics/impact-replay?days=10", headers=operator).json()
    assert replay["available"] and replay["requests"]["synthetic"] > 0
    assert set(replay["fcfs"]) == set(replay["jalsetu"])
    with SessionLocal() as db:
        assert remove(db)["requests"] == made["requests"]
