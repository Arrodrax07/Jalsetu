"""End-to-end operational workflow through the HTTP API."""


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_auth_required_and_roles(client, driver):
    assert client.get("/api/communities").status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin@test.local", "password": "wrong"}).status_code == 401
    assert client.post("/api/allocation/run", json={}, headers=driver).status_code == 403
    assert client.get("/api/users", headers=driver).status_code == 403


def test_communities_have_derived_fields(client, admin):
    rows = client.get("/api/communities", headers=admin).json()
    assert len(rows) == 10
    c = next(r for r in rows if r["id"] == "c-shivaji")
    assert c["shortfall"] == c["dailyDemand"] - c["allocatedWater"]
    assert 0 <= c["priorityScore"] <= 100
    assert c["status"] in ("Critical", "High Demand", "Normal", "Recently Served")


def test_request_gets_explainable_priority(client, officer):
    body = {"communityId": "c-dharavi", "requestedAmount": 12000, "daysWithoutWater": 4, "reason": "Pump failure",
            "contactPerson": "Test Person", "phone": "+91 90000 00000"}
    r = client.post("/api/requests", json=body, headers=officer)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["id"].startswith("WR-") and j["status"] == "Pending"
    a = j["aiAssessment"]
    assert abs(sum(a["contributions"].values()) - a["priorityScore"]) <= 1
    assert a["factors"]["unmetNeed"] >= 100  # 4 days without water saturates unmet need


def test_complaint_triage_and_label_feedback(client, officer):
    r = client.post("/api/complaints", json={"communityId": "c-govandi", "description": "Tanker is late again, waiting since morning"}, headers=officer)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["category"] in ("Late Tanker", "Missed Delivery")
    assert 0 < c["categoryConfidence"] <= 1
    r2 = client.patch(f"/api/complaints/{c['id']}", json={"category": "Late Tanker", "status": "Assigned", "assignedOfficer": "Officer X"}, headers=officer)
    assert r2.json()["labelVerified"] is True and r2.json()["category"] == "Late Tanker"


def test_public_complaint_portal(client):
    r = client.post("/api/public/complaints", json={"communityId": "c-mankhurd", "description": "पाणी गढूळ येत आहे", "reporterName": "Citizen"})
    assert r.status_code == 201, r.text
    assert r.json()["id"].startswith("C-")


def test_allocation_run_approve_and_disruption(client, admin):
    r = client.post("/api/allocation/run", json={"useForecast": False}, headers=admin)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["status"] == "Proposed"
    assert sum(i["recommendedAllocation"] for i in plan["items"]) <= plan["totalSupply"]
    assert plan["metricsAfter"]["needWeightedEquity"] >= plan["metricsBefore"]["needWeightedEquity"]

    a = client.post(f"/api/allocation/{plan['id']}/approve", headers=admin)
    assert a.status_code == 200, a.text
    comms = {c["id"]: c for c in client.get("/api/communities", headers=admin).json()}
    for it in plan["items"]:
        assert comms[it["communityId"]]["allocatedWater"] == it["recommendedAllocation"]

    b = client.post("/api/tankers/T-1888/breakdown", json={"note": "Axle failure"}, headers=admin)
    assert b.status_code == 200, b.text
    dplan = b.json()["plan"]
    assert dplan["disruption"]["tankerId"] == "T-1888"
    assert dplan["totalSupply"] < plan["totalSupply"]
    approved = {i["communityId"]: i["recommendedAllocation"] for i in plan["items"]}
    for it in dplan["items"]:
        if comms[it["communityId"]]["vulnerabilityScore"] >= 80:
            assert it["recommendedAllocation"] >= approved[it["communityId"]] - 100, it  # protected zones held
    client.post("/api/tankers/T-1888/restore", headers=admin)


def test_dispatch_track_deliver_verify(client, admin, driver):
    opt = client.post("/api/routes/optimize", json={"tankerId": "T-2045", "communityIds": ["c-dharavi", "c-shivaji", "c-kurla"]}, headers=admin)
    assert opt.status_code == 200, opt.text
    o = opt.json()
    assert o["distanceAfterKm"] <= o["distanceBeforeKm"] + 1e-6
    assert sorted(o["recommendedSequence"]) == sorted(["Dharavi", "Shivaji Nagar", "Kurla East"])

    t = client.post("/api/trips", json={"tankerId": "T-2045", "communityIds": ["c-dharavi", "c-shivaji", "c-kurla"]}, headers=admin)
    assert t.status_code == 201, t.text
    trip = t.json()
    assert client.post("/api/trips", json={"tankerId": "T-2045", "communityIds": ["c-sion"]}, headers=admin).status_code == 409

    mine = client.get("/api/driver/trip", headers=driver).json()
    assert mine["trip"]["id"] == trip["id"]

    first, second = trip["stops"][0], trip["stops"][1]
    assert client.post("/api/tracking/ping", json={"lat": first["lat"], "lng": first["lng"], "speedKmh": 18}, headers=driver).json()["ok"]

    # On-site, exact amount -> awaiting officer sign-off
    d1 = client.post("/api/deliveries", data={"tripStopId": first["id"], "deliveredAmount": first["allocatedLitres"]}, headers=driver)
    assert d1.status_code == 201, d1.text
    assert d1.json()["gpsVerified"] and d1.json()["status"] == "Pending Verification"

    # Far from the stop and short-delivered -> flagged
    d2 = client.post("/api/deliveries", data={"tripStopId": second["id"], "deliveredAmount": second["allocatedLitres"] - 2000,
                                               "lat": first["lat"], "lng": first["lng"]}, headers=driver)
    assert d2.json()["status"] == "Mismatch"
    assert d2.json()["varianceAmount"] == 2000 and not d2.json()["gpsVerified"]

    v = client.post(f"/api/deliveries/{d1.json()['id']}/verify", json={"notes": "Checked"}, headers=admin)
    assert v.json()["status"] == "Verified" and v.json()["officerVerified"]
    inv = client.post(f"/api/deliveries/{d2.json()['id']}/investigate", json={}, headers=admin)
    assert inv.json()["status"] == "Under Investigation"


def test_analytics_and_reports(client, admin):
    d = client.get("/api/analytics/dashboard", headers=admin).json()
    assert d["fleetTotal"] == 8 and d["coverageBalance"] is not None
    imp = client.get("/api/analytics/impact", headers=admin).json()
    assert imp["deliveries"]["total"] >= 2 and imp["routing"]["trips"] >= 1
    act = client.get("/api/analytics/activity?range=7d", headers=admin).json()
    assert len(act["hourly"]) == 24
    csv = client.get("/api/reports/deliveries.csv", headers=admin)
    assert csv.status_code == 200 and "Variance" in csv.text


def test_settings_weights_normalised(client, admin, officer):
    assert client.put("/api/settings/weights", json={"demand": 1, "vulnerability": 1, "unmetNeed": 1, "previousCoverage": 1, "population": 0}, headers=officer).status_code == 403
    w = client.put("/api/settings/weights", json={"demand": 1, "vulnerability": 1, "unmetNeed": 1, "previousCoverage": 1, "population": 0}, headers=admin).json()
    assert abs(sum(w.values()) - 1) < 1e-3 and w["demand"] == 0.25
