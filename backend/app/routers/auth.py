from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..domain import PERMISSIONS
from ..models import Tanker, User, utcnow
from ..schemas import LoginIn, PasswordChangeIn, UserCreate, UserUpdate
from ..security import (
    REFRESH_COOKIE, actor_from, any_user, client_ip, cookie_secure, create_access_token, hash_password, issue_refresh_token,
    password_problems, require, revoke_all_sessions, revoke_refresh_token, rotate_refresh_token, verify_password,
)
from ..services.common import audit

router = APIRouter(tags=["auth & users"])
settings = get_settings()

# Brute-force throttle: 10 failed attempts / 5 min per IP+email (in-process; use Redis when scaling out).
_attempts: dict[str, deque] = defaultdict(deque)
WINDOW_S, MAX_ATTEMPTS = 300, 10


def user_view(u: User, db: Session | None = None) -> dict:
    tanker_id = db.scalar(select(Tanker.id).where(Tanker.driver_user_id == u.id)) if db is not None and u.role == "driver" else None
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role, "designation": u.designation, "ward": u.ward,
        "phone": u.phone, "isActive": u.is_active, "tankerId": tanker_id, "mustChangePassword": u.must_change_password,
        "permissions": sorted(p for p, roles in PERMISSIONS.items() if u.role in roles),
    }


def _set_refresh_cookie(response: Response, request: Request, raw: str) -> None:
    response.set_cookie(REFRESH_COOKIE, raw, max_age=settings.refresh_token_days * 86400, httponly=True,
                        secure=cookie_secure(request), samesite="lax", path="/api/auth")


def _session_payload(db: Session, user: User) -> dict:
    return {"accessToken": create_access_token(user), "tokenType": "bearer", "expiresInSeconds": settings.access_token_minutes * 60,
            "user": user_view(user, db)}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{client_ip(request)}:{body.email.lower()}"
    q, now = _attempts[key], time.time()
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts. Try again in a few minutes.")
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        q.append(now)
        audit(db, actor_from(request, None), "login.failed", "user", body.email.lower())
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    q.clear()
    user.last_login_at = utcnow()
    raw = issue_refresh_token(db, user, request)
    audit(db, actor_from(request, user), "login", "user", user.id)
    db.commit()
    _set_refresh_cookie(response, request, raw)
    return _session_payload(db, user)


@router.post("/auth/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session")
    user, new_raw = rotate_refresh_token(db, raw, request)
    db.commit()
    _set_refresh_cookie(response, request, new_raw)
    return _session_payload(db, user)


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    revoke_refresh_token(db, request.cookies.get(REFRESH_COOKIE))
    db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(any_user), db: Session = Depends(get_db)):
    return user_view(user, db)


@router.post("/auth/change-password")
def change_password(body: PasswordChangeIn, request: Request, response: Response, user: User = Depends(any_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    problems = password_problems(body.new_password)
    if problems:
        raise HTTPException(422, "New password needs " + ", ".join(problems))
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(422, "New password must differ from the current one")
    user.password_hash, user.must_change_password = hash_password(body.new_password), False
    revoke_all_sessions(db, user.id)
    raw = issue_refresh_token(db, user, request)
    audit(db, actor_from(request, user), "user.change_password", "user", user.id)
    db.commit()
    _set_refresh_cookie(response, request, raw)
    return _session_payload(db, user)


@router.get("/users")
def list_users(role: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(User).order_by(User.role, User.name)
    if role:
        q = q.where(User.role == role)
    return [user_view(u, db) for u in db.scalars(q)]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_users"))):
    if db.scalar(select(User).where(func.lower(User.email) == body.email.lower())):
        raise HTTPException(409, "A user with this email already exists")
    problems = password_problems(body.password)
    if problems:
        raise HTTPException(422, "Password needs " + ", ".join(problems))
    u = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password), role=body.role,
             designation=body.designation, ward=body.ward, phone=body.phone, must_change_password=True)
    db.add(u)
    db.flush()
    audit(db, actor_from(request, admin), "user.create", "user", u.id, after={"email": u.email, "role": u.role})
    db.commit()
    return user_view(u, db)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, request: Request, db: Session = Depends(get_db), admin: User = Depends(require("manage_users"))):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    data = body.model_dump(exclude_unset=True)
    if u.id == admin.id and (data.get("is_active") is False or data.get("role", "admin") != "admin"):
        raise HTTPException(400, "You cannot deactivate or demote your own account")
    before = {"role": u.role, "isActive": u.is_active, "name": u.name}
    if "password" in data:
        problems = password_problems(data["password"])
        if problems:
            raise HTTPException(422, "Password needs " + ", ".join(problems))
        u.password_hash, u.must_change_password = hash_password(data.pop("password")), True
        revoke_all_sessions(db, u.id)
    for k, v in data.items():
        setattr(u, k, v)
    if data.get("is_active") is False:
        revoke_all_sessions(db, u.id)
    audit(db, actor_from(request, admin), "user.update", "user", u.id, {k: v for k, v in data.items()},
          before=before, after={"role": u.role, "isActive": u.is_active, "name": u.name})
    db.commit()
    return user_view(u, db)
