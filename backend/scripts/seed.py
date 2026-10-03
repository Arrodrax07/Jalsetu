"""Initialise the database (migrations) and load labelled REFERENCE data.

    python -m scripts.seed                       # schema + admin account + reference master data
    python -m scripts.seed --sample-users        # + operator, dispatcher, and one driver account per vehicle
    python -m scripts.seed --sample-activity     # + reference requests/complaints pushed through the real API + models

Every record created here is labelled data_origin="seeded" and is shown as SEEDED / REFERENCE in the UI.
Vehicles are created WITHOUT a position: a position only ever comes from real telemetry.

Credentials: the admin password comes from ADMIN_PASSWORD (.env). If it is not set, a random one is generated and
printed ONCE. Sample staff get --staff-password, or one shared random password printed once. All seeded accounts must
change their password at first sign-in.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
from pathlib import Path

from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.models import Community, Depot, Tanker, User
from app.security import hash_password, password_problems
from app.services import geography

settings = get_settings()
MASTER = Path(__file__).resolve().parent.parent / "seed_data" / "master.json"

SAMPLE_COMPLAINTS = [
    ("c-shivaji", "No water in Shivaji Nagar lane 4 for 3 days, children are falling sick"),
    ("c-dharavi", "Tanker came at 4pm instead of 9am, people waited the whole day"),
    ("c-dharavi", "पानी गंदा आ रहा है और बदबू आ रही है"),
    ("c-govandi", "Tanker skipped our building again, delivery marked done but nobody came"),
    ("c-mankhurd", "टँकर अर्धा रिकामा होता, सगळ्यांना पाणी मिळाले नाही"),
    ("c-kurla", "Please share next week's tanker timetable"),
]
SAMPLE_REQUESTS = [
    ("c-shivaji", 6000, 3, "Main feeder ruptured; standposts dry", "Community representative", "+91 90000 00001"),
    ("c-dharavi", 8000, 2, "Pumping station outage in sector 5", "Community representative", "+91 90000 00002"),
    ("c-mankhurd", 4000, 1, "Clinic and school need emergency supply", "Community representative", "+91 90000 00003"),
]


def _password(given: str | None, label: str) -> tuple[str, bool]:
    if given:
        problems = password_problems(given)
        if problems:
            raise SystemExit(f"{label} password needs {', '.join(problems)}")
        return given, False
    return secrets.token_urlsafe(12) + "9a", True


def _driver_email(name: str) -> str:
    return re.sub(r"[^a-z]+", ".", name.lower()).strip(".") + "@drivers.jalsetu.local"


def seed(sample_users: bool, staff_password: str | None) -> None:
    init_db()
    data = json.loads(MASTER.read_text(encoding="utf-8"))
    printed = []
    with SessionLocal() as db:
        if not db.scalar(select(User).where(func.lower(User.email) == settings.admin_email.lower())):
            pw, generated = _password(settings.admin_password or None, "ADMIN")
            db.add(User(email=settings.admin_email.lower(), name="System Administrator", role="admin", must_change_password=True,
                        designation="Water Operations Administrator", password_hash=hash_password(pw)))
            printed.append(f"admin  {settings.admin_email}  " + (f"password (generated, shown once): {pw}" if generated else "password from ADMIN_PASSWORD"))

        depot = db.scalar(select(Depot))
        if depot is None:
            for d in data["depots"]:
                db.add(Depot(**d, data_origin="seeded"))
            db.flush()
            depot = db.scalar(select(Depot))

        for c in data["communities"]:
            if not db.get(Community, c["id"]):
                row = Community(
                    id=c["id"], name=c["name"], ward=c["ward"], population=c["population"], daily_demand=c["dailyDemand"],
                    allocated_water=c["allocatedWater"], previous_allocation=c["previousAllocation"],
                    vulnerability_score=c["vulnerabilityScore"], lat=c["lat"], lng=c["lng"],
                    contact_officer=c["contactOfficer"], officer_phone=c["officerPhone"], data_origin="seeded",
                )
                row.state_id, row.district_id = geography.locate(db, row.lat, row.lng)
                db.add(row)

        for t in data["tankers"]:
            if not db.get(Tanker, t["id"]):
                db.add(Tanker(id=t["id"], vehicle_number=t["vehicleNumber"], capacity=t["capacity"], driver_name="",
                              driver_phone="", depot_id=depot.id, status="Available", data_origin="seeded"))
        db.flush()

        if sample_users:
            pw, generated = _password(staff_password, "staff")
            made = []
            for email, name, role, desig in (("operator@jalsetu.local", "Operations Officer", "operator", "Ward Water Operations Officer"),
                                             ("dispatcher@jalsetu.local", "Fleet Dispatcher", "dispatcher", "Tanker Fleet Dispatcher")):
                if not db.scalar(select(User).where(User.email == email)):
                    db.add(User(email=email, name=name, role=role, designation=desig, password_hash=hash_password(pw), must_change_password=True))
                    made.append(email)
            for t, drv in zip(db.scalars(select(Tanker).order_by(Tanker.id)), data["tankers_drivers"]):
                email = _driver_email(drv["name"])
                u = db.scalar(select(User).where(User.email == email))
                if u is None:
                    u = User(email=email, name=drv["name"], role="driver", designation="Tanker driver", phone=drv["phone"],
                             password_hash=hash_password(pw), must_change_password=True)
                    db.add(u)
                    db.flush()
                    made.append(email)
                if t.driver_user_id is None:
                    t.driver_user_id, t.driver_name, t.driver_phone = u.id, u.name, u.phone
            if made:
                printed.append(f"{len(made)} staff accounts ({', '.join(made[:3])}{', …' if len(made) > 3 else ''}) "
                               + (f"password (generated, shown once): {pw}" if generated else "password from --staff-password"))
        db.commit()
    if printed:
        # Never echo secrets to the console/logs: write them to a git-ignored local file.
        cred = Path(os.environ.get("SEED_CREDENTIALS_FILE") or Path(__file__).resolve().parent.parent / ".seed-credentials.txt")
        with open(cred, "a", encoding="utf-8") as fh:
            fh.write("\n".join(printed) + "\nAll seeded accounts must change their password at first sign-in.\n")
        try:
            cred.chmod(0o600)
        except OSError:
            pass
        print(f"Created {len(printed)} credential entr{'y' if len(printed) == 1 else 'ies'}; see {cred.name} (git-ignored). Delete it after first sign-in.")


def sample_activity() -> None:
    """Push reference requests/complaints through the real API (priority engine + complaint model), labelled seeded."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.models import Complaint, WaterRequest
    from app.security import create_access_token

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.role == "admin"))
        token = create_access_token(admin)
        if db.scalar(select(func.count(Complaint.id))):
            print("activity already present; skipping")
            return
    with TestClient(app) as client:
        h = {"Authorization": f"Bearer {token}"}
        for cid, amount, days, reason, person, phone in SAMPLE_REQUESTS:
            r = client.post("/api/requests", headers=h, json={"communityId": cid, "requestedAmount": amount, "daysWithoutWater": days,
                                                              "reason": reason, "contactPerson": person, "phone": phone, "peopleCurrentlyServed": 0})
            print("request", r.status_code, r.json().get("id"), r.json().get("priorityScore"))
        for cid, text in SAMPLE_COMPLAINTS:
            r = client.post("/api/complaints", headers=h, json={"communityId": cid, "description": text})
            j = r.json()
            print("complaint", r.status_code, j.get("id"), j.get("category"), j.get("severity"))
    with SessionLocal() as db:
        for m in (WaterRequest, Complaint):
            for row in db.scalars(select(m)):
                row.data_origin = "seeded"
        db.commit()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--sample-users", action="store_true")
    p.add_argument("--sample-activity", action="store_true")
    p.add_argument("--staff-password", default=None)
    a = p.parse_args()
    seed(a.sample_users, a.staff_password)
    if a.sample_activity:
        sample_activity()
    print("done")


if __name__ == "__main__":
    main()
