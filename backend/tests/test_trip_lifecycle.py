"""End-to-end trip lifecycle + telemetry rules, including the critical failure scenarios.

GPS fixes here are hand-written test fixtures (fixed coordinates near one destination). They exist only in this
test module and are posted through the same API a phone uses; nothing in the application generates positions.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import driver_id

DEST = (19.0390, 72.8619)     # c-sion (reference community)
NEAR = (19.0450, 72.8700)     # ~1.1 km away
INSIDE = (19.0392, 72.8620)   # ~25 m from destination


def ts(seconds_ago: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()


def fix(lat, lng, seconds_ago=0.0, acc=8.0, **kw):
    return {"lat": lat, "lng": lng, "accuracyM": acc, "deviceTime": ts(seconds_ago), **kw}


@pytest.fixture(scope="module")
def trip(client, dispatcher, driver):
    r = client.post("/api/trips", headers=dispatcher, json={"tankerId": "T-2045", "communityIds": ["c-sion"],
                                                            "driverUserId": driver_id(client, driver)})
    assert r.status_code == 201, r.text
    return r.json()


def post(client, headers, points, vehicle="T-2045", trip_id=None):
    body = {"vehicleId": vehicle, "source": "phone_gps", "points": points}
    if trip_id:
        body["tripId"] = trip_id
    return client.post("/api/tracking/telemetry", headers=headers, json=body)


def vehicle(client, headers, vid="T-2045"):
    return client.get(f"/api/tracking/vehicles/{vid}/latest", headers=headers).json()


def test_dispatch_is_not_start(client, trip, dispatcher):
    assert trip["status"] == "Assigned" and trip["startedAt"] is None
    v = vehicle(client, dispatcher)
    assert v["status"] == "Assigned"
    assert v["position"] is None and v["trackingState"] == "no_signal"   # never a default/depot position


def test_telemetry_rejected_before_start(client, trip, driver):
    assert post(client, driver, [fix(*NEAR)]).status_code == 409


def test_other_driver_cannot_accept_or_send(client, trip, driver2):
    assert client.post(f"/api/trips/{trip['id']}/accept", headers=driver2).status_code == 403
    assert post(client, driver2, [fix(*NEAR)]).status_code in (403, 409)


def test_staff_cannot_post_telemetry(client, trip, admin, dispatcher):
    assert post(client, admin, [fix(*NEAR)]).status_code == 403
    assert post(client, dispatcher, [fix(*NEAR)]).status_code == 403


def test_accept_and_start_requires_good_fresh_fix(client, trip, driver, dispatcher):
    assert client.post(f"/api/trips/{trip['id']}/accept", headers=driver).json()["status"] == "Accepted"
    poor = client.post(f"/api/trips/{trip['id']}/start", headers=driver, json={**fix(*NEAR, acc=900)})
    assert poor.status_code == 422 and "accuracy" in poor.json()["detail"]
    stale = client.post(f"/api/trips/{trip['id']}/start", headers=driver, json={**fix(*NEAR, seconds_ago=600)})
    assert stale.status_code == 422
    bad = client.post(f"/api/trips/{trip['id']}/start", headers=driver, json={**fix(95.0, 72.0)})
    assert bad.status_code == 422
    ok = client.post(f"/api/trips/{trip['id']}/start", headers=driver, json={**fix(*NEAR, seconds_ago=1), "deviceId": "phone-1"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "En Route" and ok.json()["startedAt"]
    v = vehicle(client, dispatcher)
    assert v["status"] == "On Trip" and v["trackingState"] == "live"
    assert v["position"]["lat"] == NEAR[0] and v["position"]["sourceLabel"] == "Phone GPS"


def test_wrong_vehicle_rejected(client, trip, driver):
    assert post(client, driver, [fix(*NEAR)], vehicle="T-1821").status_code == 409  # T-1821 has no started trip
    assert post(client, driver, [fix(*NEAR)], vehicle="NOPE").status_code == 404
    assert post(client, driver, [fix(*NEAR)], trip_id="TR-9999").status_code == 409


def test_invalid_and_duplicate_and_future(client, trip, driver):
    p = fix(19.0440, 72.8690, seconds_ago=0.5)
    r = post(client, driver, [p, p, fix(0, 0), fix(19.05, 72.87, seconds_ago=-3600)]).json()
    assert r["accepted"] == 1 and r["duplicates"] == 1
    reasons = {x["reason"] for x in r["rejected"]}
    assert {"null_island", "timestamp_in_future"} <= reasons
    again = post(client, driver, [p]).json()
    assert again["duplicates"] == 1 and again["accepted"] == 0   # idempotent retry (offline re-send)


def test_marker_moves_only_with_real_fixes(client, trip, driver, dispatcher):
    before = vehicle(client, dispatcher)["position"]
    post(client, driver, [fix(19.0430, 72.8680)])
    moved = vehicle(client, dispatcher)["position"]
    assert (moved["lat"], moved["lng"]) == (19.0430, 72.8680) != (before["lat"], before["lng"])
    # stationary: same coordinates -> same marker position
    post(client, driver, [fix(19.0430, 72.8680)])
    assert vehicle(client, dispatcher)["position"]["lat"] == 19.0430


def test_gps_jump_is_flagged_not_applied(client, trip, driver, dispatcher, admin):
    r = post(client, driver, [fix(28.6139, 77.2090)]).json()   # Delhi, one second later: impossible
    assert r["accepted"] == 0 and r["flagged"] == 1
    assert vehicle(client, dispatcher)["position"]["lat"] == 19.0430
    kinds = [a["kind"] for a in client.get("/api/anomalies", headers=admin).json()]
    assert "gps_jump" in kinds


def test_button_cannot_create_arrival(client, trip, driver):
    r = client.post(f"/api/trips/{trip['id']}/confirm-arrival", headers=driver)
    assert r.status_code == 409 and "not been detected by GPS" in r.json()["detail"]


def test_arrival_needs_consecutive_accurate_fixes(client, trip, driver):
    assert post(client, driver, [fix(*INSIDE, acc=500)]).json()["tripStatus"] == "En Route"  # too inaccurate to count
    assert post(client, driver, [fix(*INSIDE)]).json()["tripStatus"] == "En Route"            # 1 of 2
    r = post(client, driver, [fix(INSIDE[0] + 0.00005, INSIDE[1])]).json()                    # 2 of 2
    assert r["tripStatus"] == "Arrived" and r["arrivedAt"] == "Sion"


def test_delivery_requires_confirmation_and_receiver(client, trip, driver):
    early = client.post(f"/api/trips/{trip['id']}/deliveries", headers=driver, data={"deliveredAmount": 500, "receiverName": "X Y"})
    assert early.status_code == 409   # arrival not yet confirmed
    assert client.post(f"/api/trips/{trip['id']}/confirm-arrival", headers=driver).json()["status"] == "Delivering"
    no_rx = client.post(f"/api/trips/{trip['id']}/deliveries", headers=driver, data={"deliveredAmount": 500})
    assert no_rx.status_code == 422
    sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    stop = trip["stops"][0]
    r = client.post(f"/api/trips/{trip['id']}/deliveries", headers=driver,
                    data={"deliveredAmount": stop["allocatedLitres"], "receiverName": "Ward Representative", "signature": sig})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["trip"]["status"] == "Delivered"
    assert body["delivery"]["status"] == "Pending Verification" and body["delivery"]["gpsVerified"]
    assert body["delivery"]["signatureUrl"]


def test_driver_cannot_verify_and_completion_is_backend_controlled(client, trip, driver, operator, dispatcher):
    d = client.get("/api/deliveries", headers=operator).json()[0]
    assert client.post(f"/api/deliveries/{d['id']}/verify", headers=driver, json={}).status_code == 403
    assert client.post(f"/api/trips/{trip['id']}/end", headers=driver).json()["status"] == "Delivered"  # awaiting verification
    assert vehicle(client, dispatcher)["status"] == "On Trip"
    r = client.post(f"/api/deliveries/{d['id']}/verify", headers=operator, json={"notes": "Meter photo matches"})
    assert r.status_code == 200 and r.json()["tripCompleted"] is True
    t = client.get(f"/api/trips/{trip['id']}", headers=operator).json()
    assert t["status"] == "Completed" and t["completedAt"] and t["verifiedAt"]
    assert t["distanceTravelledKm"] > 0 and t["actualPointCount"] >= 5
    assert vehicle(client, dispatcher)["status"] == "Available"


def test_telemetry_closed_after_end(client, trip, driver):
    assert post(client, driver, [fix(*INSIDE)]).status_code == 409


def test_history_persists_and_excludes_rejected(client, trip, admin):
    from app.db import SessionLocal
    from app.models import Telemetry

    hist = client.get("/api/tracking/vehicles/T-2045/history", headers=admin).json()
    assert all(p["accepted"] for p in hist) and len(hist) >= 5
    with SessionLocal() as db:   # independent session = what survives a backend restart
        assert db.query(Telemetry).filter(Telemetry.vehicle_id == "T-2045").count() >= len(hist)
    full = client.get("/api/tracking/vehicles/T-2045/history?include_rejected=true", headers=admin).json()
    assert any("jump" in p["flags"] for p in full)


def test_overview_counts_completed_trip(client, operator):
    o = client.get("/api/overview", headers=operator).json()
    assert o["tripsCompletedToday"] >= 1 and o["deliveriesToday"] >= 1


def test_stale_offline_states_from_real_timestamps(client, dispatcher, driver2):
    """A second trip goes silent: state degrades LIVE -> STALE -> OFFLINE purely from timestamps; marker frozen."""
    from app.db import SessionLocal
    from app.models import Tanker
    from app.services.tracking import sweep

    t = client.post("/api/trips", headers=dispatcher, json={"tankerId": "T-1821", "communityIds": ["c-wadala"],
                                                           "driverUserId": driver_id(client, driver2)}).json()
    client.post(f"/api/trips/{t['id']}/accept", headers=driver2)
    assert client.post(f"/api/trips/{t['id']}/start", headers=driver2, json=fix(19.02, 72.85)).status_code == 200
    v = vehicle(client, dispatcher, "T-1821")
    assert v["trackingState"] == "live"
    with SessionLocal() as db:
        tk = db.get(Tanker, "T-1821")
        tk.last_ping_at -= timedelta(seconds=90)
        tk.last_device_time -= timedelta(seconds=90)
        db.commit()
    v = vehicle(client, dispatcher, "T-1821")
    assert v["trackingState"] == "stale" and v["position"]["lat"] == 19.02
    with SessionLocal() as db:
        tk = db.get(Tanker, "T-1821")
        tk.last_ping_at -= timedelta(seconds=600)
        tk.last_device_time -= timedelta(seconds=600)
        from app.models import Trip
        tr = db.get(Trip, t["dbId"])
        tr.started_at -= timedelta(seconds=900)
        db.commit()
        sweep(db)
    v = vehicle(client, dispatcher, "T-1821")
    assert v["trackingState"] == "offline" and v["position"]["lat"] == 19.02
    kinds = [a["kind"] for a in client.get("/api/anomalies", headers=dispatcher).json()]
    assert "telemetry_stale" in kinds
    # reconnect: fresh fix resolves the stale anomaly and the state is live again
    post(client, driver2, [fix(19.021, 72.851)], vehicle="T-1821")
    assert vehicle(client, dispatcher, "T-1821")["trackingState"] == "live"
    open_kinds = [a["kind"] for a in client.get("/api/anomalies", headers=dispatcher).json()]
    assert "telemetry_stale" not in open_kinds


def test_route_deviation_detected(client, driver2, dispatcher):
    # Planned route is the straight start->stop line (OSRM unreachable in tests). Drive ~500 m off it at a plausible speed.
    for i, ahead in enumerate((30, 35, 40)):
        r = post(client, driver2, [fix(19.0225 + i * 0.0001, 72.8455 - i * 0.0001, seconds_ago=-ahead)], vehicle="T-1821").json()
        assert r["accepted"] == 1, r
    kinds = [a["kind"] for a in client.get("/api/anomalies", headers=dispatcher).json()]
    assert "route_deviation" in kinds


def test_cancel_returns_tanker(client, dispatcher, driver2):
    trips = client.get("/api/trips?active=true", headers=dispatcher).json()
    t = next(x for x in trips if x["tankerId"] == "T-1821")
    r = client.post(f"/api/trips/{t['id']}/cancel", headers=dispatcher, json={"reason": "Test cancellation"})
    assert r.json()["status"] == "Cancelled"
    assert vehicle(client, dispatcher, "T-1821")["status"] == "Available"


def test_audit_records_before_after_and_device(client, admin):
    rows = client.get("/api/audit?entity=trip", headers=admin).json()
    start = next((r for r in rows if r["action"] == "trip.start"), None)
    if start is None:
        raise AssertionError("trip.start audit entry missing")
    assert start["before"]["status"] == "Accepted" and start["after"]["status"] == "En Route"
    assert start["deviceId"].startswith("test-")


def test_operations_metrics_from_real_trips(client, operator, driver):
    m = client.get("/api/analytics/operations?days=7", headers=operator).json()
    assert m["windowDays"] == 7
    assert m["tripsStarted"] >= 2 and m["tripsCompleted"] >= 1 and m["tripsCancelled"] >= 1
    assert 0 < m["completionRatePct"] <= 100
    assert m["avgStartToArrivalMin"] is not None and m["avgStartToCompletionMin"] is not None
    assert m["gpsKmTravelled"] > 0
    assert m["deliveries"] >= 1 and m["deliveriesVerified"] >= 1 and m["litresDelivered"] > 0
    assert m["fleetUtilisationPct"] > 0
    assert m["routeDeviations"] >= 1 and m["anomaliesByKind"]["gps_jump"] >= 1
    assert sum(d["trips"] for d in m["daily"]) == m["tripsCompleted"]
    assert client.get("/api/analytics/operations", headers=driver).status_code == 403
    assert client.get("/api/analytics/operations?days=0", headers=operator).status_code == 422


def test_trips_csv_report(client, operator, driver):
    r = client.get("/api/reports/trips.csv", headers=operator)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("Trip,Vehicle,Driver,Status")
    assert any(",Completed," in ln and "Sion" in ln for ln in lines[1:])
    assert any(",Cancelled," in ln and "Test cancellation" in ln for ln in lines[1:])
    assert client.get("/api/reports/trips.csv", headers=driver).status_code == 403
