from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

INSECURE_JWT_SECRETS = {"", "change-me-in-production"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "JalSetu API"
    environment: str = "development"

    # Database: SQLite for local dev, PostgreSQL in production. Relative sqlite paths resolve from backend/.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'jalsetu.db').as_posix()}"

    # Auth: short-lived access token (memory, Authorization header) + rotating refresh token (httpOnly cookie)
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    # "auto": Secure cookie when the request arrived over HTTPS (directly or via X-Forwarded-Proto)
    cookie_secure: str = "auto"

    # CORS (comma-separated). Same-origin deployments (nginx / Vite proxy / tunnel) need nothing here.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Routing (self-host OSRM for production volume)
    osrm_url: str = "https://router.project-osrm.org"
    routing_timeout_s: float = 8.0
    weather_timeout_s: float = 8.0

    # External data sources (see docs/INTEGRATIONS.md)
    sachet_rss_url: str = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"
    sachet_poll_seconds: int = 300
    imd_api_base: str = "https://mausam.imd.gov.in/api"
    imd_api_enabled: bool = False          # IMD requires the server's public IP to be whitelisted
    data_gov_in_api_key: str = ""          # https://data.gov.in (free registration)
    cwc_api_url: str = ""                  # formal CWC / India-WRIS access required
    vltd_gateway_token: str = ""           # state VLTD / AIS-140 backend integration
    anthropic_api_key: str = ""            # optional LLM features
    run_background_jobs: bool = True       # API process runs ingestion + tracking sweeps (single-process deployments)

    # ML artifacts (trained by ../ml)
    ml_artifacts_dir: Path = BACKEND_DIR.parent / "ml" / "artifacts"

    # File uploads (proof-of-delivery photos / signatures)
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_upload_mb: int = 8

    # Bootstrap admin (scripts/seed.py). No default password: seed refuses to create an admin without one.
    admin_email: str = "admin@jalsetu.local"
    admin_password: str = ""

    @field_validator("database_url")
    @classmethod
    def _resolve_sqlite(cls, v: str) -> str:
        prefix = "sqlite:///"
        if v.startswith(prefix) and not v.startswith(prefix + "/") and ":" not in v[len(prefix):len(prefix) + 3]:
            return prefix + (BACKEND_DIR / v[len(prefix):]).resolve().as_posix()
        return v

    @field_validator("ml_artifacts_dir", "upload_dir")
    @classmethod
    def _resolve_path(cls, v: Path) -> Path:
        return v if v.is_absolute() else (BACKEND_DIR / v).resolve()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
