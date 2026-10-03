"""SQLAlchemy ORM models. All timestamps are stored as naive UTC.

Status vocabularies live in ``app.domain`` so routers, services and tests share one definition.
Every record that can originate outside a live workflow carries ``data_origin``:
``seeded`` (reference/seed data), ``manual`` (entered by staff), ``external`` (imported from an
outside source, with provenance columns) or ``citizen`` (public portal).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON, BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

BigIntPK = BigInteger().with_variant(Integer, "sqlite")  # SQLite only autoincrements INTEGER PKs


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)  # admin | operator | dispatcher | driver
    designation: Mapped[str] = mapped_column(String(120), default="")
    ward: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replaced_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")


# ---------------------------------------------------------------------------
# Geography (India -> State -> District -> Community)
# ---------------------------------------------------------------------------
class GeoState(Base):
    __tablename__ = "geo_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    lgd_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True)  # boundary dataset feature id
    geometry: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # simplified GeoJSON geometry
    centroid_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    centroid_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [minLng, minLat, maxLng, maxLat]
    source: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    license: Mapped[str] = mapped_column(String(200), default="")
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class GeoDistrict(Base):
    __tablename__ = "geo_districts"

    id: Mapped[int] = mapped_column(primary_key=True)
    state_id: Mapped[int | None] = mapped_column(ForeignKey("geo_states.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    lgd_code: Mapped[str | None] = mapped_column(String(16), index=True, nullable=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True)
    geometry: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    centroid_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    centroid_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    license: Mapped[str] = mapped_column(String(200), default="")
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    state: Mapped[GeoState | None] = relationship()


class Depot(Base):
    __tablename__ = "depots"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    district_id: Mapped[int | None] = mapped_column(ForeignKey("geo_districts.id"), nullable=True)
    stock_litres: Mapped[int | None] = mapped_column(Integer, nullable=True)  # only when actually reported
    stock_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    capacity_litres: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    # Auto-sited depots sit on a real water-infrastructure record; placement_note says why it was chosen.
    water_source_id: Mapped[int | None] = mapped_column(ForeignKey("water_sources.id"), nullable=True)
    placement_note: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WaterSource(Base):
    """Reservoirs, filling stations, borewells… recorded with provenance."""
    __tablename__ = "water_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(40))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    district_id: Mapped[int | None] = mapped_column(ForeignKey("geo_districts.id"), nullable=True)
    capacity_litres_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    source: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)  # e.g. osm:way/123


class ReliefCenter(Base):
    __tablename__ = "relief_centers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    district_id: Mapped[int | None] = mapped_column(ForeignKey("geo_districts.id"), nullable=True)
    capacity_people: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")


class Community(Base):
    __tablename__ = "communities"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    ward: Mapped[str] = mapped_column(String(80))  # locality / municipal ward
    state_id: Mapped[int | None] = mapped_column(ForeignKey("geo_states.id"), index=True, nullable=True)
    district_id: Mapped[int | None] = mapped_column(ForeignKey("geo_districts.id"), index=True, nullable=True)
    population: Mapped[int] = mapped_column(Integer)
    daily_demand: Mapped[int] = mapped_column(Integer)  # baseline litres/day
    # Estimated litres/day already supplied by the piped/municipal system. Tankers cover only the rest.
    # 0 for communities served entirely by tankers (the original single-city model).
    baseline_supply: Mapped[int] = mapped_column(Integer, default=0)
    allocated_water: Mapped[int] = mapped_column(Integer, default=0)  # current approved daily tanker allocation
    previous_allocation: Mapped[int] = mapped_column(Integer, default=0)
    vulnerability_score: Mapped[float] = mapped_column(Float)  # 0-100
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    contact_officer: Mapped[str] = mapped_column(String(120), default="")
    officer_phone: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Provenance for imported settlements (OpenStreetMap) and the assumptions behind derived numbers.
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)  # e.g. osm:node/123
    settlement_type: Mapped[str] = mapped_column(String(16), default="")  # city | town | village | suburb
    source: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    demand_basis: Mapped[str] = mapped_column(String(200), default="")
    # 0-100 from live crisis signals (services.crisis); drives baseline_supply for imported communities.
    crisis_score: Mapped[float] = mapped_column(Float, default=0.0)
    crisis_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Straight-line km to the nearest recorded water source or active depot (services.access). Null = not computed.
    water_access_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    water_access_note: Mapped[str] = mapped_column(String(200), default="")

    district: Mapped[GeoDistrict | None] = relationship()
    state: Mapped[GeoState | None] = relationship()


# ---------------------------------------------------------------------------
# Demand side
# ---------------------------------------------------------------------------
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
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    # Set when this request repeats an open request for the same community (status "Merged").
    duplicate_of_id: Mapped[int | None] = mapped_column(ForeignKey("water_requests.id"), nullable=True)
    duplicate_reason: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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
    predicted_category: Mapped[str] = mapped_column(String(40), default="")
    predicted_severity: Mapped[str] = mapped_column(String(16), default="")
    label_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    model_version: Mapped[str] = mapped_column(String(40), default="")
    source: Mapped[str] = mapped_column(String(16), default="officer")  # officer | citizen
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    reporter_name: Mapped[str] = mapped_column(String(120), default="")
    reporter_phone: Mapped[str] = mapped_column(String(32), default="")
    language: Mapped[str] = mapped_column(String(8), default="en")  # en | mr | hi (portal language)
    input_mode: Mapped[str] = mapped_column(String(8), default="typed")  # typed | voice
    # Client-generated id from the citizen portal: an offline-queued complaint sent twice is stored once.
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # when written on the device, if sent later
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    community: Mapped[Community] = relationship()

    @property
    def code(self) -> str:
        return f"C-{2000 + self.id}"


# ---------------------------------------------------------------------------
# Fleet, trips, telemetry, delivery
# ---------------------------------------------------------------------------
class Tanker(Base):
    __tablename__ = "tankers"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    vehicle_number: Mapped[str] = mapped_column(String(20), unique=True)  # registration
    capacity: Mapped[int] = mapped_column(Integer)
    driver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    driver_name: Mapped[str] = mapped_column(String(120), default="")
    driver_phone: Mapped[str] = mapped_column(String(32), default="")
    depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="Available")  # see domain.TANKER_STATUSES
    current_load: Mapped[int] = mapped_column(Integer, default=0)
    tracking_source: Mapped[str] = mapped_column(String(16), default="phone_gps")  # phone_gps | vltd | ais140 | manual
    device_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Latest ACCEPTED telemetry fix. Null until the vehicle has actually reported a position.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_device_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_ping_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # server receive time
    last_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    breakdown_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")

    depot: Mapped[Depot | None] = relationship()
    driver: Mapped[User | None] = relationship()


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    driver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="Planned", index=True)  # see domain.TRIP_STATUSES
    origin_depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id"), nullable=True)
    # Planned route at dispatch (depot -> stops -> depot); replaced at START by the route from the real start position.
    route_geometry: Mapped[list] = mapped_column(JSON, default=list)
    dispatch_route_geometry: Mapped[list] = mapped_column(JSON, default=list)
    distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    routing_source: Mapped[str] = mapped_column(String(24), default="osrm")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    start_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # first GPS-detected arrival
    driver_ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    distance_travelled_km: Mapped[float] = mapped_column(Float, default=0.0)  # from accepted telemetry only
    deviation_streak: Mapped[int] = mapped_column(Integer, default=0)
    open_deviation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")  # "synthetic" = demo history, never operational

    tanker: Mapped[Tanker] = relationship()
    driver: Mapped[User | None] = relationship(foreign_keys=[driver_user_id])
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
    status: Mapped[str] = mapped_column(String(16), default="Pending")  # Pending | Arrived | Delivered | Verified | Skipped
    inside_streak: Mapped[int] = mapped_column(Integer, default=0)  # consecutive fixes inside the geofence
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    arrival_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    arrival_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="stops")
    community: Mapped[Community] = relationship()


class Telemetry(Base):
    """Every position report, accepted or not. Rejected/flagged fixes are kept for audit."""
    __tablename__ = "telemetry"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "device_time", name="uq_telemetry_vehicle_device_time"),
        Index("ix_telemetry_vehicle_time", "vehicle_id", "device_time"),
        Index("ix_telemetry_trip_time", "trip_id", "device_time"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"))
    driver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"), nullable=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    device_time: Mapped[datetime] = mapped_column(DateTime)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    source: Mapped[str] = mapped_column(String(16), default="phone_gps")
    device_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    accepted: Mapped[bool] = mapped_column(Boolean, default=True)
    flags: Mapped[str] = mapped_column(String(80), default="")  # comma list: jump, low_accuracy, out_of_order, buffered


class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_stop_id: Mapped[int | None] = mapped_column(ForeignKey("trip_stops.id"), nullable=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"), index=True, nullable=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    allocated_amount: Mapped[int] = mapped_column(Integer)
    delivered_amount: Mapped[int] = mapped_column(Integer)
    delivered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    gps_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_device_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    geofence_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_verified: Mapped[bool] = mapped_column(Boolean, default=False)  # GPS-detected arrival at this stop
    receiver_name: Mapped[str] = mapped_column(String(120), default="")
    receiver_phone: Mapped[str] = mapped_column(String(32), default="")
    officer_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="Pending Verification")
    variance_amount: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    signature_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trip_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)  # trip start -> this delivery
    recorded_by: Mapped[str] = mapped_column(String(120), default="")
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")  # "synthetic" = demo history, never operational

    tanker: Mapped[Tanker] = relationship()
    community: Mapped[Community] = relationship()

    @property
    def code(self) -> str:
        return f"DV-{4000 + self.id}"


class Anomaly(Base):
    __tablename__ = "anomalies"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # see domain.ANOMALY_KINDS
    vehicle_id: Mapped[str | None] = mapped_column(ForeignKey("tankers.id"), index=True, nullable=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"), index=True, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)  # e.g. metres off-route, implied km/h
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | acknowledged | resolved
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")


class TapSchedule(Base):
    """When a public tap / standpost / piped line runs, as set by an operator. Shown on the public schedule page."""
    __tablename__ = "tap_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    point_name: Mapped[str] = mapped_column(String(160))  # e.g. "Ward 4 standpost, near the temple"
    kind: Mapped[str] = mapped_column(String(16), default="tap")  # tap | standpost | piped | tanker_halt
    days: Mapped[list] = mapped_column(JSON, default=list)  # ISO weekdays 1 (Mon) .. 7 (Sun)
    start_time: Mapped[str] = mapped_column(String(5))  # "HH:MM", IST
    end_time: Mapped[str] = mapped_column(String(5))
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    data_origin: Mapped[str] = mapped_column(String(16), default="manual")
    updated_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    community: Mapped[Community] = relationship()


class SupplyNotice(Base):
    """A published change to normal supply (interruption, extra tanker, quality advisory) for one place."""
    __tablename__ = "supply_notices"

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="interruption")  # interruption | extra_supply | quality | info
    message: Mapped[str] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    community: Mapped[Community] = relationship()


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------
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
    details: Mapped[dict] = mapped_column(JSON, default=dict)
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


class DemandObservation(Base):
    """Metered/estimated actual daily consumption — feeds demand-model retraining."""
    __tablename__ = "demand_observations"
    __table_args__ = (UniqueConstraint("community_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    community_id: Mapped[str] = mapped_column(ForeignKey("communities.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    litres: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(24), default="manual")


# ---------------------------------------------------------------------------
# External intelligence
# ---------------------------------------------------------------------------
class DisasterEvent(Base):
    """Normalised official alert (CAP). The issuing authority, not JalSetu, decides it exists."""
    __tablename__ = "disaster_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40), index=True)  # e.g. ndma_sachet
    external_id: Mapped[str] = mapped_column(String(120), unique=True)  # CAP identifier
    provider: Mapped[str] = mapped_column(String(120), default="")  # issuing agency (IMD-Chennai, CWC, SDMA…)
    source_url: Mapped[str] = mapped_column(String(500))
    polygon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)  # normalised hazard
    event_raw: Mapped[str] = mapped_column(String(200), default="")
    category: Mapped[str] = mapped_column(String(32), default="")
    severity: Mapped[str] = mapped_column(String(16), default="Unknown")  # CAP: Extreme | Severe | Moderate | Minor | Unknown
    urgency: Mapped[str] = mapped_column(String(16), default="Unknown")
    certainty: Mapped[str] = mapped_column(String(16), default="Unknown")
    msg_type: Mapped[str] = mapped_column(String(16), default="Alert")
    headline: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    instruction: Mapped[str] = mapped_column(Text, default="")
    area_desc: Mapped[str] = mapped_column(Text, default="")
    lgd_district_codes: Mapped[list] = mapped_column(JSON, default=list)
    geometry: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # simplified GeoJSON (Multi)Polygon
    bbox: Mapped[list | None] = mapped_column(JSON, nullable=True)
    centroid_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    centroid_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    geometry_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | ok | unavailable | not_needed
    effective_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    onset_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    raw: Mapped[str] = mapped_column(Text, default="")
    acknowledged_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CrisisSignal(Base):
    """Evidence that a place is in water stress right now: a news report or a measured rainfall deficit.

    News is unverified until an operator confirms it; dismissed signals stop counting. Each signal names
    the communities and/or districts it was matched to, and why."""
    __tablename__ = "crisis_signals"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)  # news | rainfall_deficit
    external_id: Mapped[str] = mapped_column(String(200), unique=True)  # article URL hash / district+season
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(String(1000), default="")
    publisher: Mapped[str] = mapped_column(String(200), default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="Moderate")  # Severe | Moderate | Minor
    metric: Mapped[float | None] = mapped_column(Float, nullable=True)  # e.g. rainfall deviation %
    community_ids: Mapped[list] = mapped_column(JSON, default=list)
    district_ids: Mapped[list] = mapped_column(JSON, default=list)
    matched_terms: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="unverified", index=True)  # unverified | confirmed | dismissed
    reviewed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class DispatchProposal(Base):
    """A trip the auto-dispatcher recommends. Becomes a real Trip only when a dispatcher approves it."""
    __tablename__ = "dispatch_proposals"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch: Mapped[str] = mapped_column(String(32), index=True)
    tanker_id: Mapped[str] = mapped_column(ForeignKey("tankers.id"), index=True)
    depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id"), nullable=True)
    community_ids: Mapped[list] = mapped_column(JSON, default=list)
    litres: Mapped[dict] = mapped_column(JSON, default=dict)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    est_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="Proposed", index=True)  # Proposed | Approved | Rejected | Expired
    auto: Mapped[bool] = mapped_column(Boolean, default=False)  # approved by the auto-approve policy
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    tanker: Mapped[Tanker] = relationship()


class Recommendation(Base):
    """Frozen snapshot of an operational recommendation and every fact it was based on."""
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("disaster_events.id"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by: Mapped[str] = mapped_column(String(120), default="system")
    headline: Mapped[str] = mapped_column(Text)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    factors: Mapped[list] = mapped_column(JSON, default=list)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | actioned | dismissed


class DataSource(Base):
    __tablename__ = "data_sources"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(120), default="")
    kind: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(24), default="unknown")  # connected | degraded | awaiting_credentials | disabled | unknown
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_key: Mapped[str] = mapped_column(String(40), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running")  # running | success | failed | skipped
    fetched: Mapped[int] = mapped_column(Integer, default=0)
    created: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    unchanged: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


# ---------------------------------------------------------------------------
# Operations support
# ---------------------------------------------------------------------------
class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")  # info | warning | critical
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    entity: Mapped[str] = mapped_column(String(40), default="")
    entity_id: Mapped[str] = mapped_column(String(40), default="")
    dedupe_key: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class NotificationRead(Base):
    __tablename__ = "notification_reads"
    __table_args__ = (UniqueConstraint("notification_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_email: Mapped[str] = mapped_column(String(255), default="system")
    user_role: Mapped[str] = mapped_column(String(20), default="")
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40), index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    device_id: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
