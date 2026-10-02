import os
import sys
import tempfile
from pathlib import Path

# Isolated throwaway database + offline routing for the whole test session.
_tmp = Path(tempfile.mkdtemp(prefix="jalsetu-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["OSRM_URL"] = "http://127.0.0.1:9"  # unroutable -> exercises the haversine fallback
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["ADMIN_EMAIL"] = "admin@test.local"
os.environ["ADMIN_PASSWORD"] = "AdminPass!123"
os.environ["ROUTING_TIMEOUT_S"] = "0.5"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from scripts.seed import seed

    seed(sample_users=True, staff_password="StaffPass!123")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin@test.local", "AdminPass!123")


@pytest.fixture(scope="session")
def officer(client):
    return _login(client, "officer@jalsetu.local", "StaffPass!123")


@pytest.fixture(scope="session")
def driver(client):
    return _login(client, "rameshwar.yadav@drivers.jalsetu.local", "StaffPass!123")
