# JalSetu (जलसेतु)
> Community water-supply allocation and complaint intelligence for water-stressed Maharashtra.
> Problem statement PS 11 · Community Services · Team Ecoders

JalSetu runs a water department's tanker operation end to end. It works out **who needs water most**
(live crisis signals, vulnerability, distance to water, unmet need), shares scarce tanker water
**fairly and explainably**, dispatches and **tracks tankers on real phone GPS**, **verifies every
delivery**, and gives residents a three-language portal to **report problems (by voice, even offline)**
and see **when water is coming**.

## What is real, and what is labelled

| Area | Source of truth |
|---|---|
| Places | 1,263 Maharashtra towns and villages from OpenStreetMap with population tags (mostly Census 2011); demand = population × CPHEEO/JJM norm, labelled **Estimated** |
| Crisis | Live NDMA SACHET alerts, ERA5 monsoon rainfall deficit per district, Marathi + English news (unverified until an operator confirms) |
| Fleet | Tankers at depots sited on real water infrastructure; position **only** from the driver phone's GPS (nothing interpolated or simulated) |
| Complaints | Citizen portal + officers; multilingual ML triage and duplicate linking (**ML prediction** label) |
| History | Optional, clearly labelled **synthetic** demo history (`scripts/demo_history.py`) for trend charts and the impact replay. Live logic never reads it |

Every record carries `data_origin` (`external`, `manual`, `citizen`, `seeded`, `synthetic`). Integrations and
their status: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Model card: [ml/MODEL_CARD.md](ml/MODEL_CARD.md).

## PS 11 coverage

| PS requirement | Where |
|---|---|
| Fair allocation of limited supply | Allocation optimiser (survival floor → protected → minimum coverage → priority-weighted fair share), Jain fairness before/after; plan scope = places in crisis within tanker reach |
| Prioritise by need, vulnerability, **distance** | Explainable 0–100 priority: demand, vulnerability, unmet need, coverage gap, population, live crisis, **distance to nearest water source**; admin-tunable weights |
| Complaint intelligence | Category, severity, sentiment, duplicate detection (72 h), repeated-complaint escalation, officer label feedback → retraining |
| **Duplicate requests** | Repeat water requests for a place with an open request are merged (larger amount kept); operator can split them out |
| Tanker routing, tracking, proof of delivery | OSRM routing, auto-dispatch proposals, real GPS trip lifecycle with geofenced arrival, route deviation, POD with signature/photo, officer verification |
| Multilingual, voice, low-connectivity access | Citizen portal and driver app in English / मराठी / हिंदी; browser speech recognition (mr-IN, hi-IN, en-IN); installable PWA; complaints queue offline and send on reconnect |
| **Public tap schedules / supply information** | Operators publish tap timings and supply notices; public `/water` page shows next water, notices, tanker status, estimated coverage |
| Measurable impact | `Impact` page: first come first served vs JalSetu replayed on the same requests, fleet and limits: unmet need, wait, Jain fairness, vulnerable places, km, fuel, repeat requests |
| Analytics | Trips, deliveries, response times, anomalies, demand forecast (with real/synthetic toggle) |

## Layout

```
backend/    FastAPI API, optimisers, tracking, ingestion, Alembic migrations, tests   → backend/README.md
frontend/   React app: control room, driver app, citizen PWA                          → frontend/README.md
ml/         jalsetu_ml: complaint triage + demand forecast, training and evaluation    → ml/README.md
docs/       INTEGRATIONS.md
docker-compose.yml   Postgres · migrate · train · api · worker · nginx web
setup.ps1 / start.ps1   one-time setup / run locally (Windows)
```

Each folder is self-contained (own README, dependency manifest, `.env.example`).

## Run locally (Windows)

Prerequisites: Python 3.11+, Node.js 20+, internet (weather, routing, alerts, first model download).

```powershell
.\setup.ps1          # venv + deps, backend\.env with a random JWT secret, trains models, migrates + seeds, npm ci
.\start.ps1          # API :8000 (docs /docs) + production web build :5173 (offline-capable portal)
.\start.ps1 -Dev     # same, with the Vite dev server (hot reload; offline portal not reliable)
```

Seed credentials are written once to the git-ignored `backend\.seed-credentials.txt`; every seeded account
must change its password at first sign-in.

Real Maharashtra data (once, then refreshed in the background):

```powershell
cd backend
.venv\Scripts\python -m app.ingestion geography      # state + district boundaries
.venv\Scripts\python -m app.ingestion maharashtra    # settlements + water infrastructure (OSM)
.venv\Scripts\python -m app.ingestion crisis         # rainfall deficit + news signals
.venv\Scripts\python -m app.ingestion depots 6 --keep T-2045
.venv\Scripts\python -m scripts.demo_history         # optional, labelled synthetic history
```

URLs: control room `/` · citizen portal `/report` · water schedule `/water` · ticket status `/track` · public story `/welcome`.

**Phone demo** (GPS needs HTTPS): `cloudflared tunnel --url http://localhost:5173`, open the printed
`https://….trycloudflare.com` on the phone, sign in as the demo driver.

## Deploy with Docker

```bash
# .env next to docker-compose.yml
POSTGRES_PASSWORD=...
JWT_SECRET=...            # 32+ random characters
ADMIN_PASSWORD=...
docker compose up --build   # → http://localhost:8080
```

`migrate` applies Alembic migrations and seeds once, `train` builds the models into a shared volume,
`worker` runs every background job exactly once, `backend` serves the API (`RUN_BACKGROUND_JOBS=false`),
nginx serves the web app and proxies `/api` + WebSocket. Put TLS in front (phones need HTTPS for GPS).

## Tests

```powershell
cd backend;  .venv\Scripts\python -m pytest -q             # API, lifecycle, optimiser, impact replay, schedules, dedupe
cd ml;       ..\backend\.venv\Scripts\python -m pytest -q  # model quality gates
cd frontend; npm run build; npm run lint
```

## Limitations (stated, not hidden)

* OSM carries population for part of Maharashtra (~48 M of ~112 M people). All ~43,000 Census villages
  need a data.gov.in key (`DATA_GOV_IN_API_KEY`).
* Vulnerability is a settlement-type baseline until SECC/NFHS data is attached; piped supply is an estimate.
* Complaint and demand models are bootstrapped (generated multilingual corpus; simulated demand response
  on real weather) and retrain on officer-verified labels and metered observations. See the model card.
* Browser speech recognition is provided by the browser vendor and needs a connection; offline, residents type.
* Phone GPS stops when the screen is off (the driver app requests a wake lock).
* The Docker / PostgreSQL stack is defined and validated (`docker compose config`) but has not been run on this
  development machine (Docker daemon unavailable); local SQLite is tested end to end.
* In-process WebSocket hub and rate limits: run one API process, or add Redis before scaling out.
