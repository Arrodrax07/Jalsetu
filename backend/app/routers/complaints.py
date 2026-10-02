from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Community, Complaint, User, utcnow
from ..schemas import ComplaintAnalyzeIn, ComplaintIn, ComplaintUpdate
from ..security import any_user, staff
from ..services import ml
from ..services.common import audit, get_setting
from ..services.realtime import hub
from ..services.views import complaint_view

router = APIRouter(tags=["complaints"])

_public_hits: dict[str, deque] = defaultdict(deque)


def _recent(db: Session, community_id: str | None) -> list[tuple[int, str, str]]:
    if not community_id:
        return []
    since = utcnow() - timedelta(hours=72)
    rows = db.execute(
        select(Complaint.id, Complaint.description, Complaint.category)
        .where(Complaint.community_id == community_id, Complaint.created_at >= since, Complaint.status != "Resolved")
        .order_by(Complaint.created_at.desc()).limit(200)
    ).all()
    return [tuple(r) for r in rows]


def _analyse(db: Session, text: str, community_id: str | None):
    ops = get_setting(db, "operations")
    try:
        return ml.analyse_complaint(text, _recent(db, community_id), ops["duplicateSimilarity"])
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


def _analysis_view(a) -> dict:
    return {
        "category": a.category,
        "categoryConfidence": a.category_confidence,
        "categoryProbabilities": a.category_probabilities,
        "severity": a.severity,
        "severityConfidence": a.severity_confidence,
        "sentiment": a.sentiment,
        "duplicateOf": f"C-{2000 + a.duplicate_of}" if a.duplicate_of else None,
        "duplicateProbability": a.duplicate_probability,
        "similarComplaintsCount": a.similar_count,
        "isRepeated": a.similar_count > 0 or a.duplicate_of is not None,
        "recommendedAction": a.recommended_action,
        "modelVersion": a.model_version,
    }


def _create(db: Session, body: ComplaintIn, source: str, user: User | None) -> dict:
    if not db.get(Community, body.community_id):
        raise HTTPException(404, "Community not found")
    a = _analyse(db, body.description, body.community_id)
    c = Complaint(
        community_id=body.community_id,
        description=body.description.strip(),
        category=a.category,
        predicted_category=a.category,
        predicted_severity=a.severity,
        category_confidence=a.category_confidence,
        severity=a.severity,
        severity_confidence=a.severity_confidence,
        sentiment=a.sentiment,
        status="Escalated" if a.severity == "Critical" and a.duplicate_of is None else "Pending",
        duplicate_of_id=a.duplicate_of,
        duplicate_probability=a.duplicate_probability,
        similar_count=a.similar_count,
        recommended_action=a.recommended_action,
        model_version=a.model_version,
        source=source,
        reporter_name=body.reporter_name,
        reporter_phone=body.reporter_phone,
    )
    db.add(c)
    db.flush()
    audit(db, user, "complaint.create", "complaint", c.code, {"source": source, "category": c.category, "severity": c.severity})
    db.commit()
    db.refresh(c)
    view = complaint_view(c)
    hub.publish("complaints.changed", {"id": view["id"], "severity": c.severity, "community": c.community.name})
    return view


@router.get("/complaints")
def list_complaints(db: Session = Depends(get_db), _: User = Depends(any_user)):
    rows = db.scalars(select(Complaint).options(joinedload(Complaint.community)).order_by(Complaint.created_at.desc()))
    return [complaint_view(c) for c in rows]


@router.post("/complaints/analyze")
def analyze(body: ComplaintAnalyzeIn, db: Session = Depends(get_db), _: User = Depends(staff)):
    """Run the triage model without saving (live preview while typing)."""
    return _analysis_view(_analyse(db, body.description, body.community_id))


@router.post("/complaints", status_code=201)
def create_complaint(body: ComplaintIn, db: Session = Depends(get_db), user: User = Depends(staff)):
    return _create(db, body, "officer", user)


@router.post("/public/complaints", status_code=201)
def public_complaint(body: ComplaintIn, request: Request, db: Session = Depends(get_db)):
    """Citizen grievance intake (no login). Rate-limited per IP: 5 per 10 minutes."""
    ip = request.client.host if request.client else "-"
    q, now = _public_hits[ip], time.time()
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= 5:
        raise HTTPException(429, "Too many complaints from this device. Please try again later.")
    q.append(now)
    view = _create(db, body, "citizen", None)
    return {"id": view["id"], "category": view["category"], "severity": view["severity"], "status": view["status"],
            "message": "Complaint registered. Keep this ticket ID for follow-up."}


@router.patch("/complaints/{code}")
def update_complaint(code: str, body: ComplaintUpdate, db: Session = Depends(get_db), user: User = Depends(staff)):
    try:
        c = db.get(Complaint, int(code.split("-")[-1]) - 2000)
    except ValueError:
        c = None
    if not c:
        raise HTTPException(404, "Complaint not found")
    changes = body.model_dump(exclude_unset=True)
    if body.status:
        c.status = body.status
        c.resolved_at = utcnow() if body.status == "Resolved" else None
    if body.assigned_officer is not None:
        c.assigned_officer = body.assigned_officer
        if c.status == "Pending":
            c.status = "Assigned"
    # Officer corrections/confirmations become training labels for the next model retrain.
    if body.category or body.severity or body.confirm_labels:
        if body.category:
            c.category = body.category
        if body.severity:
            c.severity = body.severity
        c.label_verified = True
    audit(db, user, "complaint.update", "complaint", c.code, changes)
    db.commit()
    hub.publish("complaints.changed", {"id": c.code})
    return complaint_view(c)
