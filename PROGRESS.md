# JalSetu product-v2 — progress & handoff

Branch: `product-v2` (baseline commit `ae32472`, backend checkpoint `7a16067`, plus the WIP commit made at pause time).
Last updated: 2026-10-03.

## Done

### 2026-10-03: Maharashtra real data, live crisis signals, depot siting, auto-dispatch (70 backend tests passing)
- Migration 0003. `Community` gains provenance (`external_id`, `source_url`, `settlement_type`, `demand_basis`), `baseline_supply`
  (estimated piped supply; tankers cover the rest, see `services/supply.py`) and `crisis_score`. New `CrisisSignal`, `DispatchProposal`.
- `python -m app.ingestion maharashtra`: 1,263 real settlements (OSM place + population tag, mostly Census 2011) and 465 water sites;
  demand = population x CPHEEO/JJM norm (135/70/55 L/day). Places without a population are skipped. The 10 seeded Mumbai
  communities are archived (inactive). Overpass is flaky: small queries, mirror rotation, raw cache in `backend/var/cache`.
- `python -m app.ingestion crisis` (also every 3 h in the background): Open-Meteo ERA5 monsoon deficit per district vs the previous
  10 years, plus Google News RSS (English + Marathi) matched to towns/districts/regions. News is unverified until an operator confirms
  it in the Overview "Crisis signals" tab. Scoring in `services/crisis.py`; priority gains a `liveCrisis` factor (weight 0.25).
- `python -m app.ingestion depots 6 --keep T-2045`: greedy k-median on real water sites (no sewage/drain/rainwater sites), weighted by
  crisis x sqrt(population); moves Available tankers. T-2045 is kept at Chembur for the phone demo.
- Auto-dispatch (`services/dispatch.py`, Trips page panel): proposes tanker -> community trips (priority, crisis, distance, how much one
  load helps), a dispatcher approves (same path as manual dispatch: `routers/trips.dispatch_trip`). Re-proposes every 30 min;
  `dispatch.autoApproveCritical` setting (default off).
- Fixes: refresh-token race that logged users out (single-flight + Web Lock in `services/api.ts`); blank map (container height);
  stale light-theme `<body>` classes; SACHET district split regex contained a literal backspace (multi-district alerts never split).
- UI: brighter theme, coloured KPIs, colour/light/dark basemap switcher, map opens on Maharashtra with crisis glow layer.
- Phone demo: `cloudflared tunnel --url http://localhost:5173`; Vite `allowedHosts` accepts `.trycloudflare.com`.
- Known limits: OSM has populations for only part of Maharashtra (~48M of ~112M people); all ~43,000 Census villages need a free
  data.gov.in key (`DATA_GOV_IN_API_KEY`). Vulnerability is a settlement-type baseline until SECC/NFHS data is attached.


### Backend (tested: 52 tests passing at checkpoint `7a16067`)
- Alembic migrations (`backend/migrations`, 0001 baseline + 0002 product-v2); `init_db()` runs `alembic upgrade head`.
- Real trip lifecycle: Planned → Assigned → Accepted → (driver START with fresh accurate GPS) En Route → (GPS geofence, N consecutive fixes) Arrived → (driver confirm) Delivering → (POD) Delivered → (operator verifies every stop) Completed; tanker → Available. Dispatch ≠ start.
- Telemetry API `/api/tracking/telemetry` (+ vehicles / latest / history / eta): driver↔vehicle↔trip authorisation, validation, duplicate-safe, GPS-jump rejection, out-of-order handling, LIVE/STALE/OFFLINE from real timestamps, route deviation, prolonged stop, stale/offline sweeps, anomalies + acknowledgement.
- NDMA SACHET CAP ingestion (live, verified): provenance, polite throttling (provider 403s bursts), district-name fallback areas (labelled), disaster impact + rule-based recommendations with fact snapshots.
- Geography: geoBoundaries 36 states / 735 districts import, LGD CSV importer, communities placed in state/district.
- Roles admin/operator/dispatcher/driver with permission matrix; 15-min access tokens + rotating httpOnly refresh cookies (reuse detection); password policy + forced change; audit with before/after/IP/device; notifications; system health for every source (IMD/CWC/data.gov.in/VLTD shown as awaiting credentials).
- `scripts/simulate_fleet.py` deleted. No default admin password in code. Seeded data labelled `data_origin=seeded`. Seed credentials go to git-ignored `backend/.seed-credentials.txt`.
- New endpoint `/api/analytics/operations`, `trips.csv` report (added after checkpoint; not yet covered by tests).

### Frontend (type-checks and builds; NOT yet run in a browser)
- New dark command-centre design system (`src/components/ui.tsx`, tokens in `index.css`/`tailwind.config.js`), MapLibre map (`components/map/OpsMap.tsx`, OpenFreeMap dark basemap, fallback when tiles unavailable).
- `AppContext` (memory token + refresh cookie, WebSocket live updates, server-aligned clock, client-side LIVE/STALE/OFFLINE).
- Pages: CommandCenter (overview), LiveOperations, Trips (dispatch + trip record), Verification, Fleet, Disasters, Requests, Allocation, Communities (map pick / device location for destinations), Complaints, Analytics, Reports, Admin, Auth (login + forced password change), CitizenPortal.
- Driver app (`src/driver/`): real Geolocation watch + heartbeat, offline buffered uploader (localStorage), wake lock, ACCEPT / START / ARRIVED (server-gated) / DELIVERY (receiver, signature, photo) / END.
- Leaflet removed.

## In progress at pause
- Local DB rebuild: `cd backend && .venv\Scripts\python -m scripts.seed --sample-users --sample-activity`, then `python -m app.ingestion geography`, `python -m app.ingestion probes`, `python -m app.ingestion sachet`.
  Credentials are in `backend/.seed-credentials.txt` (all accounts must change password at first login).

## Next steps (in order)
1. Re-run backend tests (`backend\.venv\Scripts\python -m pytest tests -q`); add tests for `/analytics/operations`.
2. Start backend + frontend; check every page in a browser (console errors, layout); fix issues.
3. Cloudflare Tunnel for the phone: `cloudflared tunnel --url http://localhost:5173` → open the https URL on the phone (Vite proxies /api + WebSocket). Add `server.allowedHosts` for `.trycloudflare.com` in `vite.config.ts` if Vite blocks the host. Document in README.
4. Presentation area: create depot + destination community at real coordinates (Communities → Add, "Use this device's location"), create/assign a driver account for the friend.
5. Full physical acceptance test (phone GPS → live map → arrival → delivery → verification → completed → analytics).
6. Docs: rewrite root/backend/frontend READMEs, `docs/INTEGRATIONS.md` (service, env var, access, auth, frequency), remove remaining `ChangeMe!2026` mention in root README; update setup.ps1 (no default password; alembic).
7. Docker: compose `migrate` + `worker` services (RUN_BACKGROUND_JOBS=false on api), Postgres test when Docker is running.
8. Optional: LLM (Claude) situation reports — only with ANTHROPIC_API_KEY.

## Known issues
- SACHET polygon endpoint rate-limits (HTTP 403) after bursts; ingestion pauses and retries, shown as DEGRADED.
- Lint: only warnings (set-state-in-effect, fast-refresh exports).
- Browser GPS stops when the phone screen is off; driver must keep the page open (wake lock requested).
