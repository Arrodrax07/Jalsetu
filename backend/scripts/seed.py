"""Initialise the database.

    python -m scripts.seed                       # schema + admin account + master data
    python -m scripts.seed --sample-users        # + one field officer and a driver account per tanker
    python -m scripts.seed --sample-activity     # + sample requests/complaints processed by the real models

Admin credentials come from ADMIN_EMAIL / ADMIN_PASSWORD (.env). Sample staff share the
password given by --staff-password (default: same as admin). Idempotent: re-running only
adds what is missing.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.models import Community, Depot, Tanker, User
from app.security import hash_password

settings = get_settings()
MASTER = Path(__file__).resolve().parent.parent / "seed_data" / "master.json"

SAMPLE_COMPLAINTS = [
    ("c-shivaji", "No water in Shivaji Nagar lane 4 for 3 days, children are falling sick"),
    ("c-shivaji", "Shivaji nagar lane 4 me 3 din se pani nahi aaya, bachche beemar hain"),
    ("c-dharavi", "Tanker came at 4pm instead of 9am, people waited the whole day"),
    ("c-dharavi", "पानी गंदा आ रहा है और बदबू आ रही है"),
    ("c-govandi", "Tanker skipped our building again, delivery marked done but nobody came"),
    ("c-mankhurd", "टँकर अर्धा रिकामा होता, सगळ्यांना पाणी मिळाले नाही"),
    ("c-kurla", "Please share next week's tanker timetable"),
    ("c-vikhroli", "Low pressure since yesterday, only a trickle in the morning"),
]

SAMPLE_REQUESTS = [
    ("c-shivaji", 15000, 3, "Main feeder ruptured; standposts dry", "Imran Ansari", "+91 98205 11982"),
    ("c-dharavi", 20000, 2, "Pumping station outage in sector 5", "Lata Waghmare", "+91 98330 22841"),
    ("c-mankhurd", 8000, 1, "Clinic and school need emergency supply", "Farida Shaikh", "+91 98190 77410"),
]


def _driver_email(name: str) -> str:
    return re.sub(r"[^a-z]+", ".", name.lower()).strip(".") + "@drivers.jalsetu.local"


def seed(sample_users: bool, staff_password: str) -> None:
    init_db()
    data = json.loads(MASTER.read_text(encoding="utf-8"))
    with SessionLocal() as db:
        if not db.scalar(select(User).where(func.lower(User.email) == settings.admin_email.lower())):
            db.add(User(email=settings.admin_email.lower(), name="System Administrator", role="admin",
                        designation="Municipal Water Commissioner's Office", password_hash=hash_password(settings.admin_password)))
            print(f"created admin {settings.admin_email}")

        depot = db.scalar(select(Depot))
        if depot is None:
            for d in data["depots"]:
                db.add(Depot(**d))
            db.flush()
            depot = db.scalar(select(Depot))

        for c in data["communities"]:
            if not db.get(Community, c["id"]):
                db.add(Community(
                    id=c["id"], name=c["name"], ward=c["ward"], population=c["population"], daily_demand=c["dailyDemand"],
                    allocated_water=c["allocatedWater"], previous_allocation=c["previousAllocation"],
                    vulnerability_score=c["vulnerabilityScore"], lat=c["lat"], lng=c["lng"],
                    contact_officer=c["contactOfficer"], officer_phone=c["officerPhone"],
                ))

        for t in data["tankers"]:
            if not db.get(Tanker, t["id"]):
                db.add(Tanker(id=t["id"], vehicle_number=t["vehicleNumber"], capacity=t["capacity"], driver_name=t["driverName"],
                              driver_phone=t["driverPhone"], depot_id=depot.id, lat=depot.lat, lng=depot.lng, status="Idle"))
        db.flush()

        if sample_users:
            if not db.scalar(select(User).where(User.email == "officer@jalsetu.local")):
                db.add(User(email="officer@jalsetu.local", name="Rajesh Patil", role="officer", designation="Senior Ward Water Officer",
                            ward="M/East Ward", phone="+91 98201 44521", password_hash=hash_password(staff_password)))
                print("created officer@jalsetu.local")
            for t in db.scalars(select(Tanker)):
                email = _driver_email(t.driver_name or t.id)
                u = db.scalar(select(User).where(User.email == email))
                if u is None:
                    u = User(email=email, name=t.driver_name or t.id, role="driver", designation="Tanker driver",
                             phone=t.driver_phone, password_hash=hash_password(staff_password))
                    db.add(u)
                    db.flush()
                    print(f"created driver {email} -> {t.id}")
                t.driver_user_id = t.driver_user_id or u.id
        db.commit()


def sample_activity() -> None:
    """Push sample data through the real API so priority scoring and the ML models run on it."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        tok = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["accessToken"]
        h = {"Authorization": f"Bearer {tok}"}
        if client.get("/api/complaints", headers=h).json():
            print("activity already present; skipping")
            return
        for cid, amount, days, reason, person, phone in SAMPLE_REQUESTS:
            r = client.post("/api/requests", headers=h, json={"communityId": cid, "requestedAmount": amount, "daysWithoutWater": days,
                                                              "reason": reason, "contactPerson": person, "phone": phone, "peopleCurrentlyServed": 0})
            print("request", r.status_code, r.json().get("id"), r.json().get("priorityScore"))
        for cid, text in SAMPLE_COMPLAINTS:
            r = client.post("/api/complaints", headers=h, json={"communityId": cid, "description": text})
            j = r.json()
            print("complaint", r.status_code, j.get("id"), j.get("category"), j.get("severity"), j.get("duplicateOf"))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--sample-users", action="store_true")
    p.add_argument("--sample-activity", action="store_true")
    p.add_argument("--staff-password", default=None)
    a = p.parse_args()
    seed(a.sample_users, a.staff_password or settings.admin_password)
    if a.sample_activity:
        sample_activity()
    print("done")


if __name__ == "__main__":
    main()
