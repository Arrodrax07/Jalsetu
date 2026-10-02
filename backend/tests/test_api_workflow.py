"""Auth, permissions, requests, complaints, allocation, settings, reports."""
import pytest

from conftest import STAFF_PW


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_auth_required_and_permissions(client, driver, dispatcher, operator):
    assert client.get("/api/communities").status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin@test.local", "password": "wrong"}).status_code == 401
    assert client.get("/api/communities", headers=driver).status_code == 403          # drivers see only their trip
    assert client.post("/api/allocation/run", json={}, headers=driver).status_code == 403
    assert client.post("/api/users", headers=operator, json={}).status_code in (403, 422)
    assert client.post("/api/trips", headers=operator, json={"tankerId": "T-1888", "communityIds": ["c-sion"]}).status_code == 403
    me = client.get("/api/auth/me", headers=dispatcher).json()
    assert "dispatch" in me["permissions"] and "verify_delivery" not in me["permissions"]


def test_refresh_rotation_and_reuse_detection(client):
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": "operator@jalsetu.local", "password": STAFF_PW})
    assert r.status_code == 200 and r.json()["expiresInSeconds"] <= 15 * 60
    first = c.cookies.get("jalsetu_refresh")
    assert first
    r2 = c.post("/api/auth/refresh")
    assert r2.status_code == 200 and r2.json()["accessToken"]
    second = c.cookies.get("jalsetu_refresh")
    assert second and second != first
    c.cookies.set("jalsetu_refresh", first, path="/api/auth")     # replay the rotated (revoked) token
    assert c.post("/api/auth/refresh").status_code == 401
    c.cookies.set("jalsetu_refresh", second, path="/api/auth")    # whole family was revoked on reuse
    assert c.post("/api/auth/refresh").status_code == 401


def test_password_policy_and_change(client):
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    tok = c.post("/api/auth/login", json={"email": "kailash.mehra@drivers.jalsetu.local", "password": STAFF_PW}).json()
    assert tok["user"]["mustChangePassword"] is True
    h = {"Authorization": f"Bearer {tok['accessToken']}"}
    assert c.post("/api/auth/change-password", headers=h, json={"currentPassword": STAFF_PW, "newPassword": "short"}).status_code == 422
    r = c.post("/api/auth/change-password", headers=h, json={"currentPassword": STAFF_PW, "newPassword": "NewDriverPass2026"})
    assert r.status_code == 200 and r.json()["user"]["mustChangePassword"] is False


def test_communities_labelled_and_located(client, admin):
    rows = client.get("/api/communities", headers=admin).json()
    assert len(rows) == 10 and all(r["dataOrigin"] == "seeded" for r in rows)
    c = next(r for r in rows if r["id"] == "c-shivaji")
    assert c["shortfall"] == c["dailyDemand"] - c["allocatedWater"]


def test_request_gets_explainable_priority(client, operator):
    body = {"communityId": "c-dharavi", "requestedAmount": 12000, "daysWithoutWater": 4, "reason": "Pump failure",
            "contactPerson": "Test Person", "phone": "+91 90000 00000"}
    r = client.post("/api/requests", json=body, headers=operator)
    assert r.status_code == 201, r.text
    a = r.json()["aiAssessment"]
    assert abs(sum(a["contributions"].values()) - a["priorityScore"]) <= 1
    assert r.json()["dataOrigin"] == "manual"


def test_complaint_triage_and_label_feedback(client, operator):
    r = client.post("/api/complaints", json={"communityId": "c-govandi", "description": "Tanker is late again, waiting since morning"}, headers=operator)
    if r.status_code == 503:
        pytest.skip("complaint model not trained")
    c = r.json()
    assert c["category"] in ("Late Tanker", "Missed Delivery") and 0 < c["categoryConfidence"] <= 1
    r2 = client.patch(f"/api/complaints/{c['id']}", json={"category": "Late Tanker", "status": "Assigned", "assignedOfficer": "Officer X"}, headers=operator)
    assert r2.json()["labelVerified"] is True


def test_public_portal_labels_citizen_origin(client, admin):
    r = client.post("/api/public/complaints", json={"communityId": "c-mankhurd", "description": "पाणी गढूळ येत आहे", "reporterName": "Citizen"})
    if r.status_code == 503:
        pytest.skip("complaint model not trained")
    assert r.status_code == 201
    rows = client.get("/api/complaints", headers=admin).json()
    assert next(x for x in rows if x["id"] == r.json()["id"])["dataOrigin"] == "citizen"


def test_ml_unavailable_is_an_error_not_a_fake_result(client, operator, monkeypatch):
    from app.services import ml

    monkeypatch.setattr(ml, "triage", lambda: None)
    monkeypatch.setitem(ml._load_errors, "complaints", "model file missing")
    r = client.post("/api/complaints/analyze", json={"description": "no water for two days"}, headers=operator)
    assert r.status_code == 503 and "model" in r.json()["detail"].lower()


def test_allocation_deterministic_by_default(client, operator, admin):
    r = client.post("/api/allocation/run", json={}, headers=operator)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["demandSource"] == "baseline"     # forecast is advisory; never silently used
    assert sum(i["recommendedAllocation"] for i in plan["items"]) <= plan["totalSupply"]
    assert client.post(f"/api/allocation/{plan['id']}/approve", headers=operator).status_code == 200


def test_breakdown_replans_and_restore(client, operator):
    b = client.post("/api/tankers/T-1888/breakdown", json={"note": "Axle failure"}, headers=operator)
    assert b.status_code == 200 and b.json()["plan"]["disruption"]["tankerId"] == "T-1888"
    assert client.post("/api/tankers/T-1888/restore", headers=operator).status_code == 200


def test_settings_weights_normalised(client, admin, operator):
    payload = {"demand": 1, "vulnerability": 1, "unmetNeed": 1, "previousCoverage": 1, "population": 0}
    assert client.put("/api/settings/weights", json=payload, headers=operator).status_code == 403
    w = client.put("/api/settings/weights", json=payload, headers=admin).json()
    assert abs(sum(w.values()) - 1) < 1e-3


def test_reports_csv(client, operator):
    csv = client.get("/api/reports/deliveries.csv", headers=operator)
    assert csv.status_code == 200 and "Variance" in csv.text
