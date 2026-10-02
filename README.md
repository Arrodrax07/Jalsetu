# JalSetu AI (जलसेतु)
> **Fair Water. Stronger Communities.** — equitable municipal water allocation, complaint intelligence, tanker routing and verified delivery.
> Problem statement PS 11 · Community Services · Team Ecoders

JalSetu is a working system for a municipal water department that supplies
water-stressed communities by tanker. It decides **who gets how much water** (fairly and
explainably), **routes and tracks the tankers**, **verifies every delivery**, and turns citizen
complaints in English, Hinglish, Hindi and Marathi into prioritised, de-duplicated tickets.

## What's real

| Capability | How it works |
|---|---|
| Accounts & roles | JWT auth, bcrypt passwords; admin / field officer / driver; every action audit-logged |
| Data | SQLAlchemy on SQLite (dev) or PostgreSQL (prod); all KPIs computed live from records |
| Complaint triage (ML) | Multilingual MiniLM sentence embeddings + TF-IDF → logistic regression. **80% category accuracy on unseen phrasings**; officer corrections feed retraining |
| Duplicate detection (ML) | Character n-gram + semantic embedding similarity within a community, 72 h window |
| Demand forecast (ML) | Gradient boosting on **real Open-Meteo weather** (2019–2025 history, live 16-day forecast); 80% interval |
| Fair allocation | Exact convex optimisation: survival floor → protected communities → min coverage → weighted proportional fairness; Jain's-index fairness reporting |
| Disruption handling | Report a tanker breakdown → supply recomputed → plan re-optimised with vulnerable communities held harmless |
| Routing | **Real road network** via OSRM; priority-aware stop sequencing; fuel and CO₂ savings vs the entered order |
| Live tracking | Driver phone GPS → API → WebSocket fan-out to the control room map |
| Proof of delivery | GPS geofence check, volume variance vs allocation, meter photo, officer sign-off |
| Citizen portal | Public `/report` page; complaint classified instantly, ticket ID returned |
| Reports | Server-side CSV exports + printable daily summary |

Model details, metrics and limitations: [ml/MODEL_CARD.md](ml/MODEL_CARD.md).

## Architecture

```
 Citizens (/report) ─┐                                   ┌─ Open-Meteo (weather, free)
 Control room (web) ─┼─ HTTPS / WebSocket ─▶  FastAPI  ──┼─ OSRM (road routing)
 Drivers (phone)  ───┘                        backend   └─ jalsetu_ml (models, in-process)
                                                 │
                                         PostgreSQL / SQLite
```

```
.
├── backend/    FastAPI API, optimisers, routing, auth, tests        → backend/README.md
├── frontend/   React web app (control room, driver app, citizen portal) → frontend/README.md
├── ml/         jalsetu_ml package: training, evaluation, inference  → ml/README.md, ml/MODEL_CARD.md
├── docker-compose.yml   Postgres + model training job + API + nginx-served web app
├── setup.ps1 / setup.bat   one-time local setup (Windows)
└── start.ps1 / start.bat   run API + web app locally
```

Each folder is self-contained with its own README and dependency manifest
(`backend/requirements.txt`, `ml/requirements.txt` + `pyproject.toml`, `frontend/package.json`)
and `.env.example`.

## Quick start (Windows, local)

Prerequisites: Python 3.11+, Node.js 20+, internet access (weather, routing, one-time model download).

```powershell
.\setup.ps1     # venv + deps, backend\.env with random JWT secret, trains ML models (~5–10 min once), seeds DB, npm ci
.\start.ps1     # API on :8000 (docs at /docs), web app on :5173
```

Sign in with the admin from `backend\.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, default
`admin@jalsetu.local` / `ChangeMe!2026`; **change it**). Setup also creates
`officer@jalsetu.local` and one driver account per tanker
(e.g. `rameshwar.yadav@drivers.jalsetu.local`) with the same password.

Typical flow:
1. **Allocation AI** → *Run allocation* (uses today's weather forecast) → review fairness → *Approve plan*.
2. **Route & Dispatch** → pick an idle tanker and stops → *Optimise route* → *Dispatch*.
3. Driver signs in on a phone → *Start* location sharing → records delivery at each stop.
   (No phone? `backend\.venv\Scripts\python -m scripts.simulate_fleet --email … --password …`
   drives dispatched tankers along their real routes.)
4. **Delivery Verification** → sign off or investigate flagged deliveries.
5. Citizens file complaints at `http://localhost:5173/report`; they appear live in **Complaints**.

## Deploy with Docker

```bash
# .env next to docker-compose.yml
POSTGRES_PASSWORD=...
JWT_SECRET=...            # long random string
ADMIN_PASSWORD=...

docker compose up --build   # → http://localhost:8080
```

The `train` service trains the models into a shared volume on first start (skipped when
present). Put a TLS terminator in front (required for driver GPS on phones).

## Tests

```powershell
cd backend; .venv\Scripts\python -m pytest tests -q        # 24 API/optimiser/routing tests
cd ml;      ..\backend\.venv\Scripts\python -m pytest tests -q   # 9 model quality gates
cd frontend; npm run build; npm run lint
```

## Honest limitations

* **Bootstrap training data.** No public labelled dataset of Indian water complaints or metered
  tanker demand exists. The complaint model is trained on a generated multilingual corpus
  (evaluated on held-out phrasings), and the demand model learns a documented response function
  driven by real weather. Both have built-in loops to retrain on real officer-verified labels and
  metered observations from this system's own database. See the model card.
* Seed communities, fleet and depot (`backend/seed_data/master.json`) are sample master data
  for Mumbai's eastern suburbs. Replace them with your municipality's data.
* Uses the public OSRM demo server by default; self-host OSRM for production volume.
* Single-process realtime (WebSocket hub, rate limits); add Redis before running multiple API
  workers. No database migrations yet (tables auto-created); add Alembic before the first
  production schema change.
* The Docker stack and PostgreSQL path have not been run in this development environment
  (Docker daemon unavailable); local SQLite has been tested end to end.

## Roadmap

SMS/WhatsApp notifications and complaint intake (Twilio / WhatsApp Business API) · IoT flow
meters on tanker outlets posting delivered litres · Alembic migrations · Redis pub/sub for
multi-worker realtime · festival/event calendar in the demand model · per-ward officer scoping.
