import os
import sys
import tempfile
from pathlib import Path

# Isolated throwaway database + offline routing + no background jobs for the whole test session.
_tmp = Path(tempfile.mkdtemp(prefix="jalsetu-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["OSRM_URL"] = "http://127.0.0.1:9"  # unroutable -> exercises the haversine fallback
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123456"
os.environ["ADMIN_EMAIL"] = "admin@test.local"
os.environ["ADMIN_PASSWORD"] = "AdminPass!12345"
os.environ["ROUTING_TIMEOUT_S"] = "0.3"
os.environ["RUN_BACKGROUND_JOBS"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

STAFF_PW = "StaffPass!12345"


@pytest.fixture(scope="session")
def client():
    from scripts.seed import seed

    seed(sample_users=True, staff_password=STAFF_PW)
    from app.main import app

    with TestClient(app) as c:
        yield c


def login(client, email, password=STAFF_PW):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}", "X-Device-Id": f"test-{email}"}


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@test.local", "AdminPass!12345")


@pytest.fixture(scope="session")
def operator(client):
    return login(client, "operator@jalsetu.local")


@pytest.fixture(scope="session")
def dispatcher(client):
    return login(client, "dispatcher@jalsetu.local")


@pytest.fixture(scope="session")
def driver(client):
    return login(client, "rameshwar.yadav@drivers.jalsetu.local")


@pytest.fixture(scope="session")
def driver2(client):
    return login(client, "dilip.sawant@drivers.jalsetu.local")


def driver_id(client, headers) -> int:
    return client.get("/api/auth/me", headers=headers).json()["id"]
