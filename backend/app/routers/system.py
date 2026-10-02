from __future__ import annotations

import csv
import io
import subprocess
import sys
import threading

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..config import BACKEND_DIR, get_settings
from ..db import get_db
from ..models import AllocationPlan, AuditLog, Complaint, Delivery, User, WaterRequest
from ..schemas import OperationsIn, WeightsIn
from ..security import any_user, require
from ..services import ml
from ..services.common import DEFAULT_SETTINGS, audit, get_setting, put_setting
from ..services.realtime import hub
from ..services.views import community_views, complaint_view, delivery_view, iso, request_view

router = APIRouter(tags=["settings, ML & reports"])
settings = get_settings()


@router.get("/health")
def health():
    return {"status": "ok", "environment": settings.environment}


@router.get("/settings")
def get_settings_(db: Session = Depends(get_db), _: User = Depends(any_user)):
    return {"weights": get_setting(db, "weights"), "operations": get_setting(db, "operations"), "defaults": DEFAULT_SETTINGS}


@router.put("/settings/weights")
def put_weights(body: WeightsIn, db: Session = Depends(get_db), admin: User = Depends(require("manage_settings"))):
    w = body.model_dump(by_alias=True)
    total = sum(w.values())
    if total <= 0:
        raise HTTPException(400, "At least one weight must be positive")
    w = {k: round(v / total, 4) for k, v in w.items()}  # normalise to sum 1
    put_setting(db, "weights", w)
    audit(db, admin, "settings.weights", "settings", "weights", w)
    db.commit()
    hub.publish("settings.changed")
    hub.publish("communities.changed")
    return w


@router.put("/settings/operations")
def put_operations(body: OperationsIn, db: Session = Depends(get_db), admin: User = Depends(require("manage_settings"))):
    current = get_setting(db, "operations")
    current.update(body.model_dump(by_alias=True, exclude_none=True))
    value = put_setting(db, "operations", current)
    audit(db, admin, "settings.operations", "settings", "operations", body.model_dump(by_alias=True, exclude_none=True))
    db.commit()
    hub.publish("settings.changed")
    return value


@router.get("/ml/status")
def ml_status(_: User = Depends(any_user)):
    return ml.status()


_retrain_state = {"running": False, "log": "", "returncode": None}


@router.post("/ml/retrain")
def retrain(target: str = Query("all", pattern="^(all|complaints|demand)$"), admin: User = Depends(require("manage_settings")), db: Session = Depends(get_db)):
    """Retrain in a background process using real labelled data from this database, then hot-reload."""
    if _retrain_state["running"]:
        raise HTTPException(409, "A retrain is already running")
    audit(db, admin, "ml.retrain", "ml", target)
    db.commit()

    def work():
        _retrain_state.update(running=True, log="", returncode=None)
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "jalsetu_ml.train", target, "--db-url", settings.database_url],
                cwd=str(BACKEND_DIR.parent / "ml"), capture_output=True, text=True, timeout=3600,
            )
            _retrain_state.update(log=(proc.stdout + proc.stderr)[-6000:], returncode=proc.returncode)
            if proc.returncode == 0:
                ml.reload_models()
                hub.publish("ml.retrained", {"target": target})
        except Exception as exc:  # noqa: BLE001
            _retrain_state.update(log=str(exc), returncode=-1)
        finally:
            _retrain_state["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return {"started": True, "target": target}


@router.get("/ml/retrain")
def retrain_status(_: User = Depends(require("manage_settings"))):
    return _retrain_state


@router.get("/audit")
def audit_log(limit: int = 200, entity: str | None = None, entity_id: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("manage_settings"))):
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 1000))
    if entity:
        q = q.where(AuditLog.entity == entity)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    rows = db.scalars(q)
    return [{"id": r.id, "user": r.user_email, "role": r.user_role, "action": r.action, "entity": r.entity, "entityId": r.entity_id,
             "details": r.details, "before": r.before, "after": r.after, "ip": r.ip, "deviceId": r.device_id, "userAgent": r.user_agent,
             "createdAt": iso(r.created_at)} for r in rows]


# ---------------------------------------------------------------------------
# CSV exports (server-side, from the live database)
# ---------------------------------------------------------------------------
def _csv(name: str, headers: list[str], rows: list[list]) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens UTF-8 (Hindi/Marathi) correctly
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


@router.get("/reports/{kind}.csv")
def report(kind: str, db: Session = Depends(get_db), _: User = Depends(require("export_reports"))):
    if kind == "communities":
        v = community_views(db)
        return _csv("communities", ["ID", "Community", "Ward", "Population", "Daily demand (L)", "Allocated (L)", "Coverage %", "Shortfall (L)",
                                    "Vulnerability", "Priority", "Status", "Open complaints", "Last delivery (UTC)"],
                    [[c["id"], c["name"], c["ward"], c["population"], c["dailyDemand"], c["allocatedWater"], c["currentCoverage"], c["shortfall"],
                      c["vulnerabilityScore"], c["priorityScore"], c["status"], c["openComplaints"], c["lastDelivery"] or ""] for c in v])
    if kind == "requests":
        rows = [request_view(r) for r in db.scalars(select(WaterRequest).options(joinedload(WaterRequest.community)).order_by(WaterRequest.created_at.desc()))]
        return _csv("requests", ["ID", "Community", "Requested (L)", "Urgency", "Priority", "Status", "Days without water", "Contact", "Phone", "Submitted (UTC)", "Reason"],
                    [[r["id"], r["communityName"], r["requestedAmount"], r["urgency"], r["priorityScore"], r["status"], r["daysWithoutWater"],
                      r["contactPerson"], r["phone"], r["submittedAt"], r["reason"]] for r in rows])
    if kind == "complaints":
        rows = [complaint_view(c) for c in db.scalars(select(Complaint).options(joinedload(Complaint.community)).order_by(Complaint.created_at.desc()))]
        return _csv("complaints", ["ID", "Community", "Category", "Confidence", "Severity", "Status", "Duplicate of", "Similar (72h)", "Source", "Submitted (UTC)", "Description"],
                    [[c["id"], c["communityName"], c["category"], c["categoryConfidence"], c["severity"], c["status"], c["duplicateOf"] or "",
                      c["similarComplaintsCount"], c["source"], c["submittedAt"], c["description"]] for c in rows])
    if kind == "deliveries":
        rows = [delivery_view(d) for d in db.scalars(select(Delivery).options(joinedload(Delivery.tanker), joinedload(Delivery.community)).order_by(Delivery.delivered_at.desc()))]
        return _csv("deliveries", ["ID", "Tanker", "Community", "Allocated (L)", "Delivered (L)", "Variance (L)", "Geofence (m)", "GPS OK", "Status", "Verified by", "Time (UTC)", "Notes"],
                    [[d["id"], d["vehicleNumber"], d["communityName"], d["allocatedAmount"], d["deliveredAmount"], d["varianceAmount"], d["geofenceDistanceM"],
                      d["gpsVerified"], d["status"], d["verifiedBy"] or "", d["deliveryTime"], d["notes"]] for d in rows])
    if kind == "allocation":
        plan = db.scalar(select(AllocationPlan).order_by(AllocationPlan.created_at.desc()))
        if not plan:
            raise HTTPException(404, "No allocation plan yet")
        return _csv(f"allocation-plan-{plan.id}", ["Community", "Demand (L)", "Previous (L)", "Survival floor (L)", "Recommended (L)", "Priority", "Plan status", "Justification"],
                    [[it.community.name, it.demand, it.previous_allocation, it.survival_floor, it.recommended, it.priority_score, plan.status, it.reason] for it in plan.items])
    raise HTTPException(404, "Unknown report")
