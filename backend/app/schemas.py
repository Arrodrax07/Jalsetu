"""Request-body schemas (camelCase on the wire). Responses are built in services/views.py."""
from __future__ import annotations

from datetime import date
from typing import Literal

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel


class In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


Urgency = Literal["Low", "Medium", "High", "Critical"]
RequestStatus = Literal["Pending", "Allocated", "Dispatched", "Delivered", "Rejected"]
ComplaintStatus = Literal["Pending", "Escalated", "Assigned", "Resolved"]
Category = Literal["No Water", "Late Tanker", "Insufficient Quantity", "Poor Water Quality", "Missed Delivery", "Billing or Other"]
Role = Literal["admin", "operator", "dispatcher", "driver"]
# Format check only: internal deployments often use non-public domains (e.g. *.local, *.gov.in intranets).
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]


class LoginIn(In):
    email: Email
    password: str = Field(min_length=1, max_length=200)


class UserCreate(In):
    email: Email
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10, max_length=200)
    role: Role
    designation: str = ""
    ward: str = ""
    phone: str = ""


class UserUpdate(In):
    name: str | None = None
    role: Role | None = None
    designation: str | None = None
    ward: str | None = None
    phone: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=200)


class CommunityIn(In):
    id: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,40}$")
    name: str = Field(min_length=2, max_length=120)
    ward: str = Field(min_length=1, max_length=80)
    population: int = Field(gt=0, le=5_000_000)
    daily_demand: int = Field(gt=0, le=50_000_000)
    allocated_water: int = Field(default=0, ge=0)
    vulnerability_score: float = Field(ge=0, le=100)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    contact_officer: str = ""
    officer_phone: str = ""


class CommunityUpdate(In):
    name: str | None = None
    ward: str | None = None
    population: int | None = Field(default=None, gt=0)
    daily_demand: int | None = Field(default=None, gt=0)
    allocated_water: int | None = Field(default=None, ge=0)
    vulnerability_score: float | None = Field(default=None, ge=0, le=100)
    lat: float | None = None
    lng: float | None = None
    contact_officer: str | None = None
    officer_phone: str | None = None
    is_active: bool | None = None


class RequestIn(In):
    community_id: str
    requested_amount: int = Field(gt=0, le=1_000_000)
    people_currently_served: int = Field(default=0, ge=0)
    reason: str = Field(min_length=3, max_length=2000)
    days_without_water: int = Field(default=0, ge=0, le=60)
    contact_person: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=6, max_length=32)


class RequestStatusIn(In):
    status: RequestStatus


class ComplaintIn(In):
    community_id: str
    description: str = Field(min_length=5, max_length=3000)
    reporter_name: str = Field(default="", max_length=120)
    reporter_phone: str = Field(default="", max_length=32)


class ComplaintAnalyzeIn(In):
    community_id: str | None = None
    description: str = Field(min_length=3, max_length=3000)


class ComplaintUpdate(In):
    status: ComplaintStatus | None = None
    assigned_officer: str | None = None
    category: Category | None = None
    severity: Urgency | None = None
    confirm_labels: bool | None = None  # officer confirms the model's labels are correct


class TankerIn(In):
    id: str = Field(pattern=r"^[A-Za-z0-9-]{2,20}$")
    vehicle_number: str = Field(min_length=4, max_length=20)
    capacity: int = Field(gt=0, le=60_000)
    driver_user_id: int | None = None
    driver_name: str = ""
    driver_phone: str = ""
    depot_id: int | None = None


class TankerUpdate(In):
    capacity: int | None = Field(default=None, gt=0)
    driver_user_id: int | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    depot_id: int | None = None
    tracking_source: Literal["phone_gps", "vltd", "ais140", "manual"] | None = None
    vehicle_number: str | None = Field(default=None, min_length=4, max_length=20)


class BreakdownIn(In):
    note: str = Field(default="Breakdown reported", max_length=500)
    reallocate: bool = True


class AllocationRunIn(In):
    total_supply: int | None = Field(default=None, gt=0)
    use_forecast: bool = False  # forecast is advisory; allocation defaults to recorded baseline demand


class RouteOptimizeIn(In):
    tanker_id: str
    community_ids: list[str] = Field(min_length=1, max_length=15)
    litres: dict[str, int] | None = None  # optional per-stop litres; defaults from approved plan


class DispatchIn(RouteOptimizeIn):
    driver_user_id: int | None = None


class AssignDriverIn(In):
    driver_user_id: int


class CancelIn(In):
    reason: str = Field(min_length=3, max_length=500)


TelemetrySource = Literal["phone_gps", "vltd", "ais140", "manual"]


class StartTripIn(In):
    lat: float
    lng: float
    accuracy_m: float | None = None
    speed_kmh: float | None = None
    heading: float | None = None
    device_time: str
    source: TelemetrySource = "phone_gps"
    device_id: str | None = Field(default=None, max_length=80)


class TelemetryPoint(In):
    lat: float
    lng: float
    accuracy_m: float | None = None
    speed_kmh: float | None = None
    heading: float | None = None
    device_time: str


class TelemetryIn(In):
    vehicle_id: str
    trip_id: str | None = None
    source: TelemetrySource = "phone_gps"
    device_id: str | None = Field(default=None, max_length=80)
    points: list[TelemetryPoint] = Field(min_length=1, max_length=500)


class AckIn(In):
    note: str = Field(default="", max_length=1000)


class PasswordChangeIn(In):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


class DepotIn(In):
    name: str = Field(min_length=2, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    capacity_litres: int | None = Field(default=None, ge=0)




class DeliveryAction(In):
    notes: str = Field(default="", max_length=1000)


class WeightsIn(In):
    demand: float = Field(ge=0, le=1)
    vulnerability: float = Field(ge=0, le=1)
    unmet_need: float = Field(ge=0, le=1)
    previous_coverage: float = Field(ge=0, le=1)
    population: float = Field(ge=0, le=1)


class OperationsIn(In):
    trips_per_day: int | None = Field(default=None, ge=1, le=12)
    survival_litres_per_person: float | None = Field(default=None, ge=0, le=50)
    min_coverage_pct: float | None = Field(default=None, ge=0, le=100)
    protect_vulnerability_above: float | None = Field(default=None, ge=0, le=100)
    diesel_price_per_litre: float | None = Field(default=None, gt=0)
    tanker_km_per_litre: float | None = Field(default=None, gt=0)
    co2_kg_per_litre_diesel: float | None = Field(default=None, gt=0)
    fallback_speed_kmh: float | None = Field(default=None, gt=0)
    road_circuity_factor: float | None = Field(default=None, ge=1, le=3)
    geofence_radius_m: float | None = Field(default=None, gt=0, le=5000)
    variance_tolerance_pct: float | None = Field(default=None, ge=0, le=100)
    duplicate_similarity: float | None = Field(default=None, gt=0, le=1)


class DemandObservationIn(In):
    community_id: str
    date: date
    litres: int = Field(ge=0)
    source: str = "manual"
