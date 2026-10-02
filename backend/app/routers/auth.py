from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Tanker, User
from ..schemas import LoginIn, UserCreate, UserUpdate
from ..security import admin_only, any_user, create_access_token, hash_password, verify_password
from ..services.common import audit

router = APIRouter(tags=["auth & users"])

# Simple in-process brute-force throttle: 10 attempts / 5 min per IP+email.
_attempts: dict[str, deque] = defaultdict(deque)
WINDOW_S, MAX_ATTEMPTS = 300, 10


def user_view(u: User, db: Session | None = None) -> dict:
    tanker_id = None
    if db is not None and u.role == "driver":
        tanker_id = db.scalar(select(Tanker.id).where(Tanker.driver_user_id == u.id))
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "designation": u.designation,
        "ward": u.ward,
        "phone": u.phone,
        "isActive": u.is_active,
        "tankerId": tanker_id,
    }


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else '-'}:{body.email.lower()}"
    q = _attempts[key]
    now = time.time()
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts. Try again in a few minutes.")

    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        q.append(now)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    q.clear()
    audit(db, user, "login", "user", user.id)
    db.commit()
    return {"accessToken": create_access_token(user), "tokenType": "bearer", "user": user_view(user, db)}


@router.get("/auth/me")
def me(user: User = Depends(any_user), db: Session = Depends(get_db)):
    return user_view(user, db)


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return [user_view(u, db) for u in db.scalars(select(User).order_by(User.role, User.name))]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.scalar(select(User).where(func.lower(User.email) == body.email.lower())):
        raise HTTPException(409, "A user with this email already exists")
    u = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password), role=body.role,
             designation=body.designation, ward=body.ward, phone=body.phone)
    db.add(u)
    db.flush()
    audit(db, admin, "user.create", "user", u.id, {"email": u.email, "role": u.role})
    db.commit()
    return user_view(u, db)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    data = body.model_dump(exclude_unset=True)
    if "password" in data:
        u.password_hash = hash_password(data.pop("password"))
    if u.id == admin.id and (data.get("is_active") is False or data.get("role", "admin") != "admin"):
        raise HTTPException(400, "You cannot deactivate or demote your own account")
    for k, v in data.items():
        setattr(u, k, v)
    audit(db, admin, "user.update", "user", u.id, {k: v for k, v in data.items()})
    db.commit()
    return user_view(u, db)
