"""Auto-dispatch + crisis-signal API. Named zz_ so it runs last: it creates (then cancels) a trip."""
from app.db import SessionLocal
from app.models import Community, CrisisSignal, utcnow


def test_signal_review_rescores_communities(client, operator):
    with SessionLocal() as db:
        c = db.query(Community).filter(Community.is_active.is_(True)).first()
        s = CrisisSignal(kind="news", external_id="news:test-1", title=f"Tankers sent to {c.name}", severity="Severe",
                         community_ids=[c.id], district_ids=[], matched_terms=[{"term": c.name, "scope": "community"}],
                         published_at=utcnow())
        db.add(s)
        db.commit()
        sid, cid = s.id, c.id
    rows = client.get("/api/crisis/signals", headers=operator).json()
    assert any(r["id"] == sid and r["status"] == "unverified" for r in rows)

    r = client.patch(f"/api/crisis/signals/{sid}", json={"status": "confirmed"}, headers=operator)
    assert r.status_code == 200, r.text
    with SessionLocal() as db:
        assert db.get(Community, cid).crisis_score == 45.0  # Severe news 40 x confirmed 1.25 = 50, capped at 45
    client.patch(f"/api/crisis/signals/{sid}", json={"status": "dismissed"}, headers=operator)
    with SessionLocal() as db:
        assert db.get(Community, cid).crisis_score == 0.0


def test_propose_approve_creates_a_real_trip(client, dispatcher, operator):
    assert client.post("/api/dispatch/propose", headers=operator).status_code == 403  # dispatch permission only
    r = client.post("/api/dispatch/propose", headers=dispatcher)
    assert r.status_code == 200, r.text
    res = r.json()
    props = [p for p in client.get("/api/dispatch/proposals", headers=dispatcher).json() if p["batch"] == res["batch"]]
    assert len(props) == res["proposed"]
    if not props:  # nothing in need in the seeded data: still a valid outcome
        return
    p = props[0]
    assert p["status"] == "Proposed" and p["stops"] and p["reasons"]

    r = client.post(f"/api/dispatch/proposals/{p['id']}/approve", headers=dispatcher)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["proposal"]["status"] == "Approved" and body["proposal"]["tripCode"]
    trip = body["trip"]
    assert trip["tankerId"] == p["tankerId"] and [s["communityId"] for s in trip["stops"]] == [s["communityId"] for s in p["stops"]]
    assert client.post(f"/api/dispatch/proposals/{p['id']}/approve", headers=dispatcher).status_code == 409

    if len(props) > 1:
        r = client.post(f"/api/dispatch/proposals/{props[1]['id']}/reject", json={"reason": "covered by municipal supply"}, headers=dispatcher)
        assert r.status_code == 200 and r.json()["status"] == "Rejected"

    # leave the shared test database as we found it
    assert client.post(f"/api/trips/{trip['id']}/cancel", json={"reason": "test cleanup"}, headers=dispatcher).status_code == 200
