# JalSetu API (backend)

FastAPI + SQLAlchemy 2 + Alembic. Holds all data and decision logic: auth and roles, communities,
requests, complaints, allocation, dispatch, the GPS trip lifecycle, delivery verification, disaster and
crisis intelligence, tap schedules, analytics and the impact replay. Interactive docs: **http://localhost:8000/docs**.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # also installs ../ml in editable mode
copy .env.example .env                             # set JWT_SECRET and ADMIN_PASSWORD
cd ..\ml; ..\backend\.venv\Scripts\python -m jalsetu_ml.train all; cd ..\backend   # once
.venv\Scripts\python -m scripts.seed --sample-users   # migrates (alembic upgrade head) + seeds
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

`..\setup.ps1` does all of this. The schema is managed by Alembic (`migrations/`); `init_db()` runs
`alembic upgrade head` at startup, so the API and every script always see the latest schema.

### Data commands

| Command | What it does |
|---|---|
| `python -m scripts.seed [--sample-users]` | migrate, admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, reference master data (`data_origin=seeded`); staff + one driver per tanker. Credentials go to git-ignored `.seed-credentials.txt` |
| `python -m app.ingestion geography` | geoBoundaries states + districts |
| `python -m app.ingestion maharashtra` | OSM settlements (with population) + water infrastructure |
| `python -m app.ingestion crisis` | rainfall deficit + news crisis signals, re-score communities |
| `python -m app.ingestion depots 6 --keep T-2045` | site depots on real water sites, move Available tankers |
| `python -m app.ingestion sachet` / `probes` / `lgd FILE.csv` | NDMA alerts / source health / LGD district codes |
| `python -m app.ingestion worker` | all background jobs, forever (separate process/container) |
| `python -m scripts.demo_history [--days 28] [--pressure 1.3] [--remove]` | labelled synthetic history (see below) |

### Tests

```powershell
.venv\Scripts\python -m pytest -q
```

Throwaway SQLite database, unreachable OSRM (exercises the fallback), no background jobs. Covers auth and
refresh-token rotation, permissions, priority and allocation properties, routing, the full GPS trip lifecycle
(start accuracy gate, geofenced arrival, jumps, buffering, deviation, POD, verification), disasters, crisis
signals, auto-dispatch, request dedupe, distance factor, tap schedules and public supply info, offline-safe
citizen complaints, the impact replay, synthetic-history isolation and `/api/public/summary`.

## Decision logic

**Priority** (`services/priority.py`): weighted mean of 0–100 sub-scores, each shown with its point contribution:
demand, vulnerability, unmet need (raised by days without water), 7-day coverage gap, population, live crisis
signals, and **distance to the nearest water source** (`services/access.py`: straight-line km to the nearest
recorded water site or active depot, 100 at ≥ 30 km; remote places have no fallback). Weights are admin-tunable.

**Allocation** (`services/allocation.py`, `routers/allocation.py`): survival floor (3 L/person/day) → protected
vulnerable places during disruptions → minimum coverage → remaining supply split by KKT water-filling so
coverage is proportional to priority. Jain's index reported before/after. Default scope: towns and villages in
crisis (score ≥ 40) within tanker reach plus any place with an open request; cities are excluded because a
tanker fleet cannot cover them (they need piped supply restored). Supply = operational capacity × trips/day.

**Request dedupe** (`routers/requests.py`): a request for a place that has an open request raised within
`requestDuplicateHours` (48) is stored as *Merged* into it, keeping the larger amount. Operators can override
("separate need") or split a merged request back out. Complaints have their own semantic duplicate detection.

**Auto-dispatch** (`services/dispatch.py`): scores tanker→place pairs by priority × crisis × how much one load
helps ÷ distance, combines nearby places, waits for a dispatcher (optional auto-approve for Critical).

**Trip lifecycle** (`routers/trips.py`, `services/tracking.py`): Planned → Assigned → Accepted → START (fresh
accurate fix) → En Route → Arrived (N consecutive fixes inside the geofence) → Delivering → Delivered (POD) →
Completed after an operator verifies every stop. LIVE / STALE / OFFLINE from real timestamps; jumps rejected;
distance travelled accumulated live and recomputed from the accepted trace at completion.

**Impact replay** (`services/impact.py`, `GET /api/analytics/impact-replay`): the same request stream, fleet,
depots and daily limits (trips per day, driving hours, km/h, minutes per stop) served two ways: first come
first served (arrival order, whole loads, one place per trip, repeat calls served again) vs JalSetu (repeats
merged, the live auto-dispatch planner). Reports unmet need, waits, Jain fairness, vulnerable places, km, fuel,
load utilisation and water spent on repeat calls, with every assumption in the response.

**Synthetic demo history** (`scripts/demo_history.py`): requests from real places within a tanker's service area,
served by the impact replay's JalSetu policy with the real fleet. Rows are `data_origin=synthetic`, closed
(never in live queues), have no GPS, and are excluded from priority, dispatch, overview counts and lists.
Analytics endpoints take `origin=all|real`.

## API overview (all under `/api`, camelCase JSON)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh` (httpOnly cookie, rotating), `/auth/logout`, `/auth/change-password`, `GET /auth/me`, users (admin) |
| Communities & requests | `GET /communities`, `POST/PATCH /communities`, `GET /requests`, `POST /requests/assess`, `POST /requests`, `PATCH /requests/{id}/status` |
| Complaints | `GET/POST /complaints`, `POST /complaints/analyze`, `PATCH /complaints/{id}` |
| Allocation | `GET /allocation/current`, `POST /allocation/run` (`scope`), `POST /allocation/{id}/approve`, `POST /tankers/{id}/breakdown`, `/restore` |
| Dispatch & trips | `GET /dispatch/proposals`, `POST /dispatch/propose`, approve/reject, `POST /routes/optimize`, `POST /trips`, driver actions, `GET /deliveries`, verify/investigate |
| Tracking | `POST /tracking/telemetry`, `GET /tracking/vehicles`, history, ETA, anomalies |
| Intelligence | `GET /disasters`, impact, recommendations, `GET /crisis/signals`, `POST /crisis/refresh` |
| Schedules | `GET/POST /schedules`, `PUT/DELETE /schedules/{id}`, `POST /supply-notices`, `/supply-notices/{id}/end` |
| Analytics | `GET /analytics/dashboard`, `/activity`, `/operations`, `/forecast` (state total; `perPlace=true` adds per-place rows; memoised 5 min), `/impact`, `/impact-replay` |
| Public (no login) | `GET /public/summary`, `/public/communities`, `/public/schedules`, `/public/supply/{id}`, `POST /public/complaints`, `GET /public/complaints/{code}` |
| System | `GET /overview`, `/system/health`, `/notifications`, `/settings`, `/audit`, `/reports/{kind}.csv`, WebSocket `/ws?token=` |

Permissions are by capability (`app/domain.py`), not role name: e.g. `dispatch` (admin, dispatcher),
`verify_delivery` / `manage_schedules` (admin, operator), `drive` (driver).

## Production notes

* `ENVIRONMENT=production` refuses a weak `JWT_SECRET`. Use PostgreSQL (`DATABASE_URL=postgresql+psycopg://…`).
* Run background jobs in exactly one place: the API (`RUN_BACKGROUND_JOBS=true`) or the worker
  (`python -m app.ingestion worker` with `RUN_BACKGROUND_JOBS=false` on the API).
* WebSocket hub and rate limits are in-process: one API process, or add Redis before scaling out.
* Self-host OSRM for production volume. Every state change is written to `audit_logs` with before/after, IP and device.
