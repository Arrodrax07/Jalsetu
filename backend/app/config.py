from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "JalSetu API"
    environment: str = "development"

    # Database: SQLite for local dev, Postgres in production (see docker-compose.yml)
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'jalsetu.db').as_posix()}"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 12

    # CORS (comma-separated)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # External services (both free/keyless; self-host OSRM for production volume)
    osrm_url: str = "https://router.project-osrm.org"
    routing_timeout_s: float = 8.0
    weather_timeout_s: float = 8.0

    # ML artifacts (trained by ../ml)
    ml_artifacts_dir: Path = BACKEND_DIR.parent / "ml" / "artifacts"

    # File uploads (proof-of-delivery photos)
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_upload_mb: int = 8

    # Bootstrap admin (used by scripts/seed.py)
    admin_email: str = "admin@jalsetu.local"
    admin_password: str = "ChangeMe!2026"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
