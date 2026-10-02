"""Shared domain vocabulary: statuses, allowed transitions, roles and permissions."""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Roles & permissions
# ---------------------------------------------------------------------------
ROLES = ("admin", "operator", "dispatcher", "driver")

# permission -> roles allowed. Endpoints depend on permissions, never on role names directly.
PERMISSIONS: dict[str, tuple[str, ...]] = {
    "view_operations":      ("admin", "operator", "dispatcher"),
    "manage_requests":      ("admin", "operator", "dispatcher"),
    "manage_complaints":    ("admin", "operator"),
    "run_allocation":       ("admin", "operator", "dispatcher"),
    "approve_allocation":   ("admin", "operator"),
    "dispatch":             ("admin", "dispatcher"),          # create trips, assign tankers & drivers, cancel
    "verify_delivery":      ("admin", "operator"),
    "report_breakdown":     ("admin", "operator", "dispatcher"),
    "acknowledge":          ("admin", "operator", "dispatcher"),  # alerts, anomalies, recommendations
    "manage_master_data":   ("admin",),                        # communities, depots, tankers
    "manage_users":         ("admin",),
    "manage_settings":      ("admin",),
    "run_ingestion":        ("admin",),
    "export_reports":       ("admin", "operator", "dispatcher"),
    "drive":                ("driver",),                       # driver workflow + telemetry
}


def roles_for(permission: str) -> tuple[str, ...]:
    return PERMISSIONS[permission]


# ---------------------------------------------------------------------------
# Fleet & trips
# ---------------------------------------------------------------------------
TANKER_AVAILABLE, TANKER_ASSIGNED, TANKER_ON_TRIP, TANKER_MAINTENANCE = "Available", "Assigned", "On Trip", "Maintenance"
TANKER_STATUSES = (TANKER_AVAILABLE, TANKER_ASSIGNED, TANKER_ON_TRIP, TANKER_MAINTENANCE)

# Trip lifecycle. "Verified" is recorded as verified_at and is immediately followed by Completed.
T_PLANNED, T_ASSIGNED, T_ACCEPTED = "Planned", "Assigned", "Accepted"
T_EN_ROUTE, T_ARRIVED, T_DELIVERING, T_DELIVERED = "En Route", "Arrived", "Delivering", "Delivered"
T_COMPLETED, T_CANCELLED = "Completed", "Cancelled"
TRIP_STATUSES = (T_PLANNED, T_ASSIGNED, T_ACCEPTED, T_EN_ROUTE, T_ARRIVED, T_DELIVERING, T_DELIVERED, T_COMPLETED, T_CANCELLED)
TRIP_OPEN = (T_PLANNED, T_ASSIGNED, T_ACCEPTED, T_EN_ROUTE, T_ARRIVED, T_DELIVERING, T_DELIVERED)
TRIP_MOVING = (T_EN_ROUTE, T_ARRIVED, T_DELIVERING)  # telemetry accepted, driver on the road
TRIP_TELEMETRY_OK = (T_EN_ROUTE, T_ARRIVED, T_DELIVERING, T_DELIVERED)

TRIP_TRANSITIONS: dict[str, tuple[str, ...]] = {
    T_PLANNED: (T_ASSIGNED, T_CANCELLED),
    T_ASSIGNED: (T_ACCEPTED, T_ASSIGNED, T_CANCELLED),
    T_ACCEPTED: (T_EN_ROUTE, T_CANCELLED),
    T_EN_ROUTE: (T_ARRIVED, T_CANCELLED),
    T_ARRIVED: (T_DELIVERING, T_EN_ROUTE, T_CANCELLED),  # back to En Route if it leaves before delivering
    T_DELIVERING: (T_EN_ROUTE, T_DELIVERED, T_CANCELLED),
    T_DELIVERED: (T_COMPLETED,),
    T_COMPLETED: (),
    T_CANCELLED: (),
}

STOP_PENDING, STOP_ARRIVED, STOP_DELIVERED, STOP_VERIFIED, STOP_SKIPPED = "Pending", "Arrived", "Delivered", "Verified", "Skipped"

D_PENDING, D_MISMATCH, D_INVESTIGATION, D_VERIFIED = "Pending Verification", "Mismatch", "Under Investigation", "Verified"

# ---------------------------------------------------------------------------
# Telemetry & anomalies
# ---------------------------------------------------------------------------
TELEMETRY_SOURCES = ("phone_gps", "vltd", "ais140", "manual")
SOURCE_LABELS = {"phone_gps": "Phone GPS", "vltd": "VLTD", "ais140": "AIS-140", "manual": "Manual"}

ANOMALY_KINDS = (
    "gps_jump",          # implied speed between consecutive fixes is physically implausible
    "invalid_fix",       # out-of-range / null-island coordinates
    "low_accuracy",      # reported accuracy worse than threshold for consecutive fixes
    "telemetry_stale",   # active trip, no fix for longer than the offline threshold
    "prolonged_stop",    # active trip, stationary away from any stop
    "route_deviation",   # sustained distance from planned route
)

DATA_ORIGINS = ("seeded", "manual", "external", "citizen")
