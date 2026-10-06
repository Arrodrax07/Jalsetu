"""Demo reset: save a starting point, change things, put them back (users and audit stay)."""
from app.db import SessionLocal
from app.models import AuditLog, Tanker, User


def test_save_change_reset(client, admin):
    assert client.post("/api/demo/reset", headers=admin).status_code in (200, 409)  # nothing saved yet -> 409
    r = client.post("/api/demo/snapshot", headers=admin)
    assert r.status_code == 200 and r.json()["saved"]
    with SessionLocal() as db:
        t = db.query(Tanker).first()
        tid, status = t.id, t.status
        t.status = "Maintenance"
        db.add(User(email="after-snapshot@test.local", name="Made after", role="operator", password_hash="x"))
        db.commit()
        audits_before = db.query(AuditLog).count()
    r = client.post("/api/demo/reset", headers=admin)
    assert r.status_code == 200, r.text
    with SessionLocal() as db:
        assert db.get(Tanker, tid).status == status                     # operations back to the starting point
        assert db.query(User).filter_by(email="after-snapshot@test.local").count() == 1  # people kept
        assert db.query(AuditLog).count() > audits_before               # history kept, reset recorded


def test_reset_is_admin_only(client, operator):
    assert client.post("/api/demo/reset", headers=operator).status_code == 403
    assert client.post("/api/demo/snapshot", headers=operator).status_code == 403
