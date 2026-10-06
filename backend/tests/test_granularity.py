"""Community detail: switching between whole settlements and areas inside cities (services.granularity)."""
from app.db import SessionLocal
from app.models import Community
from app.services import granularity


def _city_with_areas(db):
    city = Community(id="t-city", name="Test City", ward="Test", population=600_000, daily_demand=600_000 * 135,
                     baseline_supply=600_000 * 135, vulnerability_score=40, lat=19.0, lng=73.0, is_active=True,
                     settlement_type="city", level="settlement")
    areas = [Community(id=f"t-area-{i}", name=f"Test Area {i}", ward="Test City", population=100_000, daily_demand=100_000 * 135,
                       baseline_supply=0, vulnerability_score=40, lat=19.0 + i * 0.01, lng=73.0, is_active=False,
                       settlement_type="suburb", level="area", parent_id="t-city") for i in range(6)]
    db.add_all([city, *areas])
    db.commit()
    return city, areas


def test_switch_levels_and_back(client):
    with SessionLocal() as db:
        city, areas = _city_with_areas(db)
        try:
            granularity.apply(db, "areas")
            db.commit()
            db.refresh(city)
            assert not city.is_active and all(db.get(Community, a.id).is_active for a in areas)
            assert granularity.mode(db) == "areas"
            granularity.apply(db, "settlements")
            db.commit()
            db.refresh(city)
            assert city.is_active and not any(db.get(Community, a.id).is_active for a in areas)
        finally:
            for a in areas:
                db.delete(db.get(Community, a.id))
            db.delete(db.get(Community, city.id))
            db.commit()


def test_only_admin_switches(client, operator, admin):
    assert client.put("/api/settings/communities", json={"granularity": "settlements"}, headers=operator).status_code == 403
    r = client.get("/api/settings/communities", headers=operator)
    assert r.status_code == 200 and r.json()["granularity"] in ("settlements", "areas")
    assert client.put("/api/settings/communities", json={"granularity": "everything"}, headers=admin).status_code == 422
