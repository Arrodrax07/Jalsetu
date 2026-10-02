"""SQLAlchemy ORM models. All timestamps are stored as naive UTC."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)  # admin | officer | driver
    designation: Mapped[str] = mapped_column(String(120), default="")
    ward: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Depot(Base):
    __tablename__ = "depots"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)


class Community(Base):
    __tablename__ = "communities"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    ward: Mapped[str] = mapped_column(String(80))
    population: Mapped[int] = mapped_column(Integer)
    daily_demand: Mapped[int] = mapped_column(Integer)  # baseline litres/day
    allocated_water: Mapped[int] = mapped_column(Integer, default=0)  # current approved daily allocation
    previous_allocation: Mapped[int] = mapped_column(Integer, default=0)
    vulnerability_score: Mapped[float] = mapped_column(Float)  # 0-100
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    contact_officer: Mapped[str] = mapped_column(String(120), default="")
    officer_phone: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WaterRequest(Base):
    __tablename__ = "water_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    requested_amount: Mapped[int] = mapped_column(Integer)
    urgency: Mapped[str] = mapped_column(String(16))
    people_currently_served: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(Text)
    days_without_water: Mapped[int] = mapped_column(Integer, default=0)
    contact_person: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="Pending", index=True)
    priority_score: Mapped[int] = mapped_column(Integer)
    assessment: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    community: Mapped[Community] = relationship()

    @property
    def code(self) -> str:
        return f"WR-{1000 + self.id}"


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40))
    category_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    severity: Mapped[str] = mapped_column(String(16))
    severity_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    sentiment: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="Pending", index=True)
    assigned_officer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    duplicate_of_id: Mapped[int | None] = mapped_column(ForeignKey("complaints.id"), nullable=True)
    duplicate_probability: Mapped[float] = mapped_column(Float, default=0.0)
    similar_count: Mapped[int] = mapped_column(Integer, default=0)
    recommended_action: Mapped[str] = mapped_column(Text, default="")
    predicted_category: Mapped[str] = mapped_column(String(40), default="")  # model output at intake (for live accuracy)
    predicted_severity: Mapped[str] = mapped_column(String(16), default="")
    label_verified: Mapped[bool] = mapped_column(Boolean, default=False)  # officer confirmed/corrected labels -> training data
    model_version: Mapped[str] = mapped_column(String(40), default="")
    source: Mapped[str] = mapped_column(String(16), default="officer")  # officer | citizen
    reporter_name: Mapped[str] = mapped_column(String(120), default="")
    reporter_phone: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    community: Mapped[Community] = relationship()

    @property
    def code(self) -> str:
        return f"C-{2000 + self.id}"


class Tanker(Base):
    __tablename__ = "tankers"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    vehicle_number: Mapped[str] = mapped_column(String(20), unique=True)
    capacity: Mapped[int] = mapped_column(Integer)
    driver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    driver_name: Mapped[str] = mapped_column(String(120), default="")
    driver_phone: Mapped[str] = mapped_column(String(32), default="")
    depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="Idle")  # Idle | Loading | En Route | Maintenance
    current_load: Mapped[int] = mapped_column(Integer, default=0)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_ping_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    breakdown_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    depot: Mapped[Depot | None] = relationship()
    driver: Mapped[User | None] = relationship()


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="Planned", index=True)  # Planned | En Route | Completed | Cancelled
    route_geometry: Mapped[list] = mapped_column(JSON, default=list)  # [[lat,lng],...]
    distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    routing_source: Mapped[str] = mapped_column(String(16), default="osrm")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    tanker: Mapped[Tanker] = relationship()
    stops: Mapped[list[TripStop]] = relationship(back_populates="trip", order_by="TripStop.seq", cascade="all, delete-orphan")

    @property
    def code(self) -> str:
        return f"TR-{3000 + self.id}"


class TripStop(Base):
    __tablename__ = "trip_stops"

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"))
    allocated_litres: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="Pending")  # Pending | Delivered | Skipped

    trip: Mapped[Trip] = relationship(back_populates="stops")
    community: Mapped[Community] = relationship()


class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_stop_id: Mapped[int | None] = mapped_column(ForeignKey("trip_stops.id"), nullable=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    allocated_amount: Mapped[int] = mapped_column(Integer)
    delivered_amount: Mapped[int] = mapped_column(Integer)
    delivered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    gps_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    geofence_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    officer_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="Pending Verification")
    variance_amount: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trip_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)  # trip start -> this delivery
    recorded_by: Mapped[str] = mapped_column(String(120), default="")

    tanker: Mapped[Tanker] = relationship()
    community: Mapped[Community] = relationship()

    @property
    def code(self) -> str:
        return f"DV-{4000 + self.id}"


class AllocationPlan(Base):
    __tablename__ = "allocation_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="Proposed")  # Proposed | Approved | Superseded
    total_supply: Mapped[int] = mapped_column(Integer)
    total_demand: Mapped[int] = mapped_column(Integer)
    fairness_before: Mapped[float] = mapped_column(Float)
    fairness_after: Mapped[float] = mapped_column(Float)
    weights: Mapped[dict] = mapped_column(JSON)
    method: Mapped[str] = mapped_column(String(80))
    demand_source: Mapped[str] = mapped_column(String(40), default="baseline")
    disruption: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)  # full before/after metrics + optimiser notes
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list[AllocationItem]] = relationship(back_populates="plan", cascade="all, delete-orphan", order_by="AllocationItem.priority_score.desc()")


class AllocationItem(Base):
    __tablename__ = "allocation_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("allocation_plans.id"), index=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"))
    demand: Mapped[int] = mapped_column(Integer)
    previous_allocation: Mapped[int] = mapped_column(Integer)
    priority_score: Mapped[int] = mapped_column(Integer)
    survival_floor: Mapped[int] = mapped_column(Integer)
    recommended: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    factors: Mapped[dict] = mapped_column(JSON)

    plan: Mapped[AllocationPlan] = relationship(back_populates="items")
    community: Mapped[Community] = relationship()


class GpsPing(Base):
    __tablename__ = "gps_pings"

    id: Mapped[int] = mapped_column(primary_key=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class DemandObservation(Base):
    """Metered/estimated actual daily consumption — feeds demand-model retraining."""
    __tablename__ = "demand_observations"
    __table_args__ = (UniqueConstraint("community_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    litres: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(24), default="manual")


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_email: Mapped[str] = mapped_column(String(255), default="system")
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
