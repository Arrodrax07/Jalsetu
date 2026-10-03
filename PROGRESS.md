# JalSetu product-v2 — progress & handoff

Branch: `product-v2` (baseline commit `ae32472`, backend checkpoint `7a16067`, plus the WIP commit made at pause time).
Last updated: 2026-10-03.

## Done

### 2026-10-03 (latest): landing page + "water atlas" redesign
- Every page load starts on the landing page (in-memory flag in `App.tsx`); "Open the control room" enters the app
  (existing session goes straight in, otherwise sign-in). `/welcome` shows the landing page to anyone; `/login` = sign-in.
- Landing data: `GET /api/public/summary` (no auth, 5-min cache). Hero = `components/landing/WaterScene.tsx`
  (three + @react-three/fiber, lazy chunk ~233 kB gz): glass drop (physical transmission, ior 1.33) over a GPU ripple
  shader; click the water to make ripples. Sections: sticky scroll numbers, pinned horizontal "how it works",
  rainfall bars + headlines, 3D-tilting phone mockup, live headline ticker.
- Intro plays on every page load, starting when the tab is visible.

### 2026-10-03 (later): frontend redesign "water atlas"
- Light theme: tokens in `src/index.css` (paper / ink / water-blue / terracotta), Geist + Instrument Serif, Motion (`motion` pkg).
- UI kit `components/ui.tsx`: Stagger/Item, CountUp, Segmented, FadeSwap, animated SlideOver/Dialog/Tabs; same component API.
- Shell: sidebar wordmark + sliding active state, slim top bar, Ctrl/Cmd+K command palette (pages, actions, 1,263 places).
- Intro (`components/Intro.tsx`): ~3.5 s SVG sequence, once per session, skippable; toned down (not removed) for
  prefers-reduced-motion. Maharashtra outline in `src/assets/maharashtra.ts` (generated from geoBoundaries).
- Map: 3D mode (AWS terrarium DEM terrain + hillshade + crisis-height columns), hover cards, pulse rings, cinematic
  fly-in, layer toggles; layers attach on `style.load` (~0.3 s) instead of `load` (~10 s).
- Overview: live situation headline, 6 KPIs, community side sheet with evidence (`components/CommunitySheet.tsx`),
  route `#overview/<communityId>`.
- Communities list (filters, crisis sort, paging), citizen portal (type-ahead + nearest place from device location),
  driver journey stepper, sign-in split layout. Dev-only `/__login` preview route.

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

## State at pause (2026-10-03, ~23:00 IST)
- Everything committed up to `8de69ec` except the user's own edit to `backend/tests/test_trip_lifecycle.py` (left uncommitted on purpose; ask before committing).
- Servers: start with `start.ps1` (API :8000, web :5173). Phone demo: `cloudflared tunnel --url http://localhost:5173` (URL changes each restart).
- Demo driver: kailash.mehra@drivers.jalsetu.local (tanker T-2045, kept at Chembur depot); password in `backend/.seed-credentials.txt`.
- Live data refresh: `python -m app.ingestion crisis` (also every 3 h in the background); depots: `python -m app.ingestion depots 6 --keep T-2045`.
- Machine has limited RAM: an unrelated uvicorn on :8001 uses ~1.3 GB.

## Next steps (agreed with the user, in order) — gaps against PS 11
1. **Impact page: first-come-first-served vs JalSetu.** Replay the same real data both ways; show unmet demand, coverage
   fairness (Jain), vulnerable places served, km driven, duplicate requests avoided. (PS point 5)
2. **Voice + language switch** (English / मराठी / हिंदी) on citizen portal and driver app; Web Speech API (mr-IN, hi-IN). (PS point 4)
3. **Offline citizen reporting**: installable PWA, queue complaints offline, send on reconnect. (PS point 4)
4. **Public-tap schedules / supply information**: operators set tap timings per place; public "when is water coming" page.
   (Named in the PS problem text; not built yet.)
5. **Duplicate detection for water requests** (complaints already have it) + **distance as an explicit priority factor**. (PS points 2, 5)
6. **Demo history script**: a few weeks of clearly labelled synthetic deliveries so trend/analytics charts are not empty. (PS point 3)
7. Tests for `GET /api/public/summary`; then docs (READMEs, `docs/INTEGRATIONS.md`), Docker migrate/worker services.

## Housekeeping before any demo
- Allocation page shows an old approved plan for the archived Mumbai sample communities: press "Compute a plan".
- All 8 tankers are on approved auto-dispatch trips (TR-3003..3010), including demo tanker T-2045 (Mumbai): cancel that trip before the phone demo.
- Physical phone GPS acceptance test still not done.
- User's OS has "reduce motion" on (Windows Animation effects off): app tones motion down; turn it on to show full motion.

## Known issues
- SACHET polygon endpoint rate-limits (HTTP 403) after bursts; ingestion pauses and retries, shown as DEGRADED.
- Lint: only warnings (set-state-in-effect, fast-refresh exports).
- Browser GPS stops when the phone screen is off; driver must keep the page open (wake lock requested).
