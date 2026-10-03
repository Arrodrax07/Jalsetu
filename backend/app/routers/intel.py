"""Crisis signals (news + rainfall deficit) and auto-dispatch proposals."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Community, CrisisSignal, DispatchProposal, GeoDistrict, User, utcnow
from ..schemas import ProposalRejectIn, SignalReviewIn
from ..security import actor_from, require
from ..services import crisis, dispatch
from ..services.common import audit
from ..services.realtime import hub
from ..services.views import iso

router = APIRouter(tags=["intelligence"])


def signal_view(s: CrisisSignal, names: dict[str, str], districts: dict[int, str]) -> dict:
    return {
        "id": s.id, "kind": s.kind, "title": s.title, "summary": s.summary, "url": s.url, "publisher": s.publisher,
        "publishedAt": iso(s.published_at), "severity": s.severity, "metric": s.metric, "status": s.status,
        "communities": [{"id": c, "name": names.get(c, c)} for c in s.community_ids or []],
        "districts": [{"id": d, "name": districts.get(d, str(d))} for d in s.district_ids or []],
        "matchedTerms": s.matched_terms or [], "regionOnly": crisis.region_only(s),
        "reviewedBy": s.reviewed_by, "reviewedAt": iso(s.reviewed_at), "expiresAt": iso(s.expires_at),
        "active": s.status != "dismissed" and (s.expires_at is None or s.expires_at > utcnow()),
    }


@router.get("/crisis/signals")
def list_signals(include_expired: bool = False, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    q = select(CrisisSignal).order_by(CrisisSignal.published_at.desc().nulls_last())
    rows = list(db.scalars(q))
    if not include_expired:
        now = utcnow()
        rows = [s for s in rows if s.expires_at is None or s.expires_at > now]
    names = dict(db.execute(select(Community.id, Community.name)).all())
    districts = dict(db.execute(select(GeoDistrict.id, GeoDistrict.name)).all())
    return [signal_view(s, names, districts) for s in rows]


@router.patch("/crisis/signals/{signal_id}")
def review_signal(signal_id: int, body: SignalReviewIn, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require("acknowledge"))):
    s = db.get(CrisisSignal, signal_id)
    if not s:
        raise HTTPException(404, "Signal not found")
    before = {"status": s.status}
    s.status, s.reviewed_by, s.reviewed_at = body.status, user.email, utcnow()
    audit(db, actor_from(request, user), "crisis_signal.review", "crisis_signal", s.id, {"title": s.title[:200]},
          before=before, after={"status": s.status})
    db.commit()
    summary = crisis.recompute(db)
    hub.publish("communities.changed")
    hub.publish("crisis.changed")
    return {"status": s.status, "rescored": summary}


@router.post("/crisis/refresh")
def refresh_signals(request: Request, db: Session = Depends(get_db), user: User = Depends(require("run_ingestion"))):
    from ..ingestion.crisis import run_crisis

    result = run_crisis(db)
    audit(db, actor_from(request, user), "crisis.refresh", "crisis_signal", "all", {"inCrisis": result.get("inCrisis")})
    db.commit()
    hub.publish("crisis.changed")
    return result


@router.get("/dispatch/proposals")
def list_proposals(limit: int = 60, db: Session = Depends(get_db), _: User = Depends(require("view_operations"))):
    rows = list(db.scalars(select(DispatchProposal).order_by(DispatchProposal.created_at.desc(), DispatchProposal.score.desc())
                           .limit(min(max(limit, 1), 200))))
    names = dict(db.execute(select(Community.id, Community.name)).all())
    return [dispatch.proposal_view(db, r, names) for r in rows]


@router.post("/dispatch/propose")
def run_proposals(request: Request, db: Session = Depends(get_db), user: User = Depends(require("dispatch"))):
    result = dispatch.propose(db, user)
    audit(db, actor_from(request, user), "dispatch.propose", "dispatch_batch", result["batch"],
          {"proposed": result["proposed"], "autoApproved": result["autoApproved"]})
    db.commit()
    return result


def _proposal(db: Session, pid: int) -> DispatchProposal:
    row = db.get(DispatchProposal, pid)
    if not row:
        raise HTTPException(404, "Proposal not found")
    return row


@router.post("/dispatch/proposals/{pid}/approve")
def approve_proposal(pid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require("dispatch"))):
    row = _proposal(db, pid)
    trip = dispatch.approve(db, row, actor_from(request, user), user)
    return {"proposal": dispatch.proposal_view(db, db.get(DispatchProposal, pid)), "trip": trip}


@router.post("/dispatch/proposals/{pid}/reject")
def reject_proposal(pid: int, body: ProposalRejectIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require("dispatch"))):
    row = _proposal(db, pid)
    dispatch.reject(db, row, user, body.reason)
    audit(db, actor_from(request, user), "dispatch.reject", "dispatch_proposal", pid, {"reason": body.reason})
    db.commit()
    return dispatch.proposal_view(db, row)
