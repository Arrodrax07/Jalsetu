# JalSetu API (backend)

FastAPI + SQLAlchemy service that holds all JalSetu data and business logic: authentication,
communities, requests, complaints, allocation optimisation, routing, dispatch, live GPS,
proof of delivery, analytics and reports. Interactive API docs: **http://localhost:8000/docs**.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # also installs ../ml in editable mode
copy .env.example .env                             # then set JWT_SECRET and ADMIN_PASSWORD
cd ..\ml; ..\backend\.venv\Scripts\python -m jalsetu_ml.train all; cd ..\backend   # once
.venv\Scripts\python -m scripts.seed --sample-users
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

(`..\setup.ps1` does all of the above.)

### Seeding

| Command | Creates |
|---|---|
| `python -m scripts.seed` | schema, admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, depot/communities/fleet from `seed_data/master.json` |
| `--sample-users [--staff-password X]` | `officer@jalsetu.local` and one driver account per tanker (`firstname.lastname@drivers.jalsetu.local`) |
| `--sample-activity` | a few requests and multilingual complaints pushed through the real API + models |

Re-running is safe: only missing rows are added. Replace `seed_data/master.json` with your
municipality's clusters, depots and fleet (or manage them in the UI).

### Tests

```powershell
.venv\Scripts\python -m pytest tests -q
```

24 tests: optimiser properties, routing (exact + urgency + OSRM fallback), and a full API
workflow (auth/roles → request scoring → complaint triage & label feedback → citizen portal →
allocation → approval → disruption re-plan → route → dispatch → GPS → POD with geofence/variance
→ verification → analytics → CSV). Tests use a throwaway SQLite DB and an unreachable OSRM URL.
Complaint tests need the trained model in `../ml/artifacts`.

### Fleet simulator (no physical devices)

```powershell
.venv\Scripts\python -m scripts.simulate_fleet --email admin@jalsetu.local --password <pw>
```

Drives every dispatched trip along its real OSRM road geometry, posting GPS pings and proof of
delivery through the same API the driver app uses (15% of stops short-delivered by default, to
exercise variance detection).

## Code map

```
app/
├── main.py              app, CORS, lifespan (create tables, warm models), WebSocket /api/ws
├── config.py            settings from env / .env
├── db.py, models.py     SQLAlchemy engine + ORM (SQLite dev, PostgreSQL prod)
├── security.py          bcrypt passwords, JWT, role dependencies (admin / officer / driver)
├── schemas.py           request bodies (camelCase on the wire)
├── routers/             auth, communities, requests, complaints, allocation, fleet, analytics, system
└── services/
    ├── priority.py      explainable 0–100 priority score
    ├── allocation.py    floors + weighted proportional-fairness optimiser, fairness metrics
    ├── routing.py       OSRM table/route + priority-aware stop sequencing
    ├── ml.py            model loading, complaint triage glue, weather-driven forecasts
    ├── views.py         ORM → JSON, all derived fields computed live
    ├── realtime.py      WebSocket hub
    └── common.py        haversine, runtime settings store, audit log
scripts/                 seed.py, simulate_fleet.py
seed_data/master.json    initial depot / communities / fleet
tests/
```

## How the decision logic works

**Priority score** (`services/priority.py`) — weighted mean of five 0–100 sub-scores, each shown
to users with its point contribution:
demand (vs largest community) · vulnerability (census/survey score) · unmet need (shortfall %,
raised by consecutive days without water) · coverage gap (delivered litres over the last 7 days)
· population. Weights are admin-tunable and normalised.

**Allocation** (`services/allocation.py`) — exact, deterministic convex optimisation:

1. Floors in order of priority, each kept only if supply allows: survival
   (default 3 L/person/day, Sphere drinking+cooking minimum) → protected vulnerable communities
   held at their approved allocation during disruptions → policy minimum coverage (default 50%).
2. The remaining supply maximises Σ pᵢ·dᵢ·log xᵢ subject to Σx = S, floor ≤ x ≤ demand. KKT gives
   xᵢ = clip(pᵢ·dᵢ/ν, floorᵢ, dᵢ): coverage proportional to priority. ν is found by bisection.
3. Demand dᵢ comes from the ML forecast for today (live weather) unless disabled.
4. Fairness: Jain's index of allocation per unit of priority-weighted need (headline), plus plain
   coverage equality, worst-off coverage, vulnerable-community coverage, average coverage — all
   reported before vs after.

Supply defaults to Σ(operational tanker capacity) × trips/day. A breakdown removes the tanker and
immediately re-plans.

**Routing** (`services/routing.py`) — OSRM `/table` matrix (real road durations/distances) →
minimise trip time + 0.5 × priority-weighted mean arrival time; exhaustive for ≤ 8 stops,
nearest-neighbour + 2-opt beyond. Baseline for the reported savings is the order the dispatcher
entered, on the same matrix. Fuel/CO₂ from configurable mileage, diesel price and 2.68 kg CO₂/L.

**Proof of delivery** — driver submits litres (+ optional photo) with phone GPS; the server
computes distance to the community (geofence, default 150 m) and variance vs allocated (default
±5%). Clean → *Pending Verification* for officer sign-off; otherwise *Mismatch* with reasons.

## API overview

All routes are under `/api`; JSON is camelCase. Auth: `Authorization: Bearer <token>` from
`POST /auth/login`. Full schema at `/docs`.

| Area | Endpoints | Roles |
|---|---|---|
| Auth & users | `POST /auth/login`, `GET /auth/me`, `GET/POST /users`, `PATCH /users/{id}` | users: admin |
| Communities | `GET /communities`, `POST`, `PATCH /communities/{id}`, `GET /communities/{id}/forecast`, `GET /depots`, `POST /demand-observations` | write: admin |
| Requests | `GET /requests`, `POST /requests/assess`, `POST /requests`, `PATCH /requests/{id}/status` | write: admin, officer |
| Complaints | `GET /complaints`, `POST /complaints/analyze`, `POST /complaints`, `PATCH /complaints/{id}` | write: admin, officer |
| Citizen (public) | `GET /public/communities`, `POST /public/complaints` (rate-limited) | none |
| Allocation | `GET /allocation/current`, `GET /allocation/history`, `POST /allocation/run`, `POST /allocation/{id}/approve` | approve: admin |
| Fleet | `GET/POST /tankers`, `PATCH /tankers/{id}`, `POST /tankers/{id}/breakdown`, `POST /tankers/{id}/restore` | |
| Routing & trips | `POST /routes/optimize`, `POST /trips`, `GET /trips`, `POST /trips/{id}/cancel`, `GET /driver/trip` | |
| Tracking | `POST /tracking/ping`, `GET /tracking/{tankerId}/trail`, WebSocket `/ws?token=` | ping: driver (or staff for a tanker) |
| Deliveries | `GET /deliveries`, `POST /deliveries` (multipart, photo), `POST /deliveries/{id}/verify`, `/investigate`, `GET /deliveries/{id}/photo` | |
| Analytics | `GET /analytics/dashboard`, `/activity?range=`, `/forecast?days=`, `/impact` | any |
| Settings & ML | `GET /settings`, `PUT /settings/weights`, `PUT /settings/operations`, `GET /ml/status`, `POST/GET /ml/retrain`, `GET /audit` | write: admin |
| Reports | `GET /reports/{communities,requests,complaints,deliveries,allocation}.csv` | admin, officer |

WebSocket events: `tanker.position`, `tankers.changed`, `communities.changed`, `requests.changed`,
`complaints.changed`, `deliveries.changed`, `allocation.changed`, `settings.changed`, `ml.retrained`.

## Production notes

* Set `ENVIRONMENT=production` and a strong `JWT_SECRET` (startup refuses the default).
* Use PostgreSQL (`DATABASE_URL=postgresql+psycopg://…`). Tables are created on startup;
  introduce Alembic migrations before the first schema change in production.
* The WebSocket hub and the login / citizen-portal rate limits are in-process: run one worker,
  or move them to Redis before scaling horizontally.
* Self-host OSRM for production traffic; the public demo server has a fair-use limit.
* Every state-changing action is written to `audit_logs`.
