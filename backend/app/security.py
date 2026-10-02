"""Authentication (bcrypt + JWT access tokens + rotating refresh tokens) and permission checks."""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .domain import PERMISSIONS
from .models import RefreshToken, User, utcnow

settings = get_settings()
_bearer = HTTPBearer(auto_error=False)
REFRESH_COOKIE = "jalsetu_refresh"


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < 10:
        problems.append("at least 10 characters")
    if not any(c.isdigit() for c in password):
        problems.append("a digit")
    if not any(c.isalpha() for c in password):
        problems.append("a letter")
    return problems


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "role": user.role, "iat": now, "exp": now + timedelta(minutes=settings.access_token_minutes), "typ": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(db: Session, user: User, request: Request | None) -> str:
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user.id, token_hash=_hash_token(raw), expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
        ip=client_ip(request) if request else "", user_agent=(request.headers.get("user-agent", "")[:255] if request else ""),
    ))
    return raw


def rotate_refresh_token(db: Session, raw: str, request: Request) -> tuple[User, str]:
    """Validate a refresh token, revoke it, issue a new one. Reuse of a revoked token revokes the whole family."""
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(raw)))
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session not recognised")
    if row.revoked_at is not None:
        # Token reuse: likely theft. Revoke every live session of this user.
        for t in db.scalars(select(RefreshToken).where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))):
            t.revoked_at = utcnow()
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session was revoked; please sign in again")
    if row.expires_at < utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled")
    new_raw = issue_refresh_token(db, user, request)
    db.flush()
    row.revoked_at = utcnow()
    row.replaced_by = db.scalar(select(RefreshToken.id).where(RefreshToken.token_hash == _hash_token(new_raw)))
    return user, new_raw


def revoke_refresh_token(db: Session, raw: str | None) -> None:
    if not raw:
        return
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(raw)))
    if row and row.revoked_at is None:
        row.revoked_at = utcnow()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    for t in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))):
        t.revoked_at = utcnow()


def cookie_secure(request: Request) -> bool:
    if settings.cookie_secure in ("true", "1", "yes"):
        return True
    if settings.cookie_secure in ("false", "0", "no"):
        return False
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def user_from_token(db: Session, token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "access":
        return None
    user = db.get(User, int(payload["sub"]))
    return user if user and user.is_active else None


# ---------------------------------------------------------------------------
# Request context (for audit)
# ---------------------------------------------------------------------------
def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    fwd = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return (fwd or (request.client.host if request.client else ""))[:64]


@dataclass
class Actor:
    user: User | None
    ip: str = ""
    user_agent: str = ""
    device_id: str = ""


def actor_from(request: Request, user: User | None) -> Actor:
    return Actor(user, client_ip(request), request.headers.get("user-agent", "")[:255], request.headers.get("x-device-id", "")[:80])


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    user = user_from_token(db, creds.credentials)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


def require(permission: str):
    allowed = PERMISSIONS[permission]

    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role ({user.role}) cannot perform this action ({permission})")
        return user

    return dep


def require_roles(*roles: str):
    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(roles)}")
        return user

    return dep


any_user = get_current_user
staff = require("view_operations")
admin_only = require("manage_settings")
