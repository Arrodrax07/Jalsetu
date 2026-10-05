# JalSetu product-v2 — progress & handoff

Branch: `product-v2` (baseline commit `ae32472`, backend checkpoint `7a16067`, plus the WIP commit made at pause time).
Last updated: 2026-10-03.

## Done

### 2026-10-04: PS 11 gap list completed (Phase 1), commits e58e1cb, 064fe21, 295fbef
- Impact page (`#impact`, `GET /api/analytics/impact-replay`, `services/impact.py`): same requests, fleet, depots and daily
  limits (trips/day, `tankerShiftHours`, km/h, `stopServiceMinutes`) replayed as first come first served vs JalSetu
  (repeats merged + live auto-dispatch planner). Unmet need, waits, Jain fairness, vulnerable places, km, fuel, repeat calls.
  Honest result on current data: JalSetu better on most metrics, slightly fewer vulnerable places reached (45 vs 49).
- Voice + EN/मराठी/हिंदी: citizen portal and driver app (`src/i18n`), Web Speech dictation, driver voice commands, spoken updates.
- Offline citizen PWA: manifest + icons + `public/sw.js`; on-device outbox (`src/citizen/outbox.ts`) with `clientRef`
  idempotency on the server. Verified: offline submit → reconnect → stored once; offline reload of /report and /water (production build).
- Public tap schedules + supply notices (migration 0004, `routers/schedules.py`, staff page `#schedules`, public `/water`, ticket status `/track`).
- Request dedupe (Merged status, override, split back out) + distance-to-water priority factor (`services/access.py`, weight 0.10).
- Synthetic demo history `python -m scripts.demo_history` (data_origin=synthetic, closed, no GPS, excluded from live logic;
  analytics `origin=all|real`). Currently loaded: 28 days, 525 requests, 290 trips.
- Tests: backend 79, ML 9. Docs: README x3, `docs/INTEGRATIONS.md`. Docker: `migrate` + `worker` services (compose validated;
  Docker daemon not running here, stack not executed).
- Fixes: breakdown double-submit (409 now) and restore resetting tankers with open trips to Available (data repaired, audited);
  allocation plan scope (default: towns/villages in crisis within tanker reach + open requests; cities excluded);
  live distance travelled; tests no longer write to `.seed-credentials.txt`.
- Verified in the browser (Playwright): every staff page loads without console/network errors; full driver lifecycle in
  Marathi on an isolated DB copy with emulated GPS (accept → start → geofence arrival → delivery → end → operator verify →
  Completed, 3.76 km).
- Housekeeping done: TR-3005 (T-2045) cancelled, T-2045 Available at Chembur; new allocation plan #24 Proposed (not approved).
- `start.ps1` now runs the production build (offline portal works); `-Dev` for hot reload.
- QA passwords for operator + dispatcher recorded in `backend/.seed-credentials.txt`.

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

## 2026-10-06: the landing page is one film over the real Earth
User brief (2026-10-05): cinematic spatial choreography, one continuous film through real geography, one
world-space camera derived from the journey timeline, real data only, fallbacks, 60 fps, mobile path, reduced motion.

Architecture (frontend/src/components/landing/earth/):
- `OpenEarth.tsx`: the world. MapLibre globe (Sentinel-2, Terrarium DEM + hillshade, OSM roads/buildings/water) for
  ALL ten chapters; one rAF loop: stepClock -> shotAt -> jumpTo (center, zoom from camera range, pitch, bearing,
  roll banking from turn rate x clock velocity, padding so the subject makes room for the type: left on wide screens,
  top on tall ones) -> paint props only when changed -> cloud deck -> DOM anchors -> ground headline -> impact lines.
  Fails over (journey.json missing, no WebGL2, first view > 20 s, no imagery tile within 12 s) -> onFail.
- `journey.ts`: deterministic timeline. Shots per chapter; flight-path interpolation (log-range + climb hump; descend
  = arrive over target then drop; climb = rise then travel); road-follow segment behind the tanker; scene states.
- `math.ts` (great circle, range<->zoom, measured road), `tiles.ts` (provider + earth:// tile pack protocol),
  `clouds.ts` (ray-marched cumulus slab 1.8-3.2 km around Beed + Parbhani, same camera + padding shift),
  `tanker.ts` (three.js custom layer; MapLibre model frame is y-up: x east, z south; drawn 3x), `earth-mode.css`.
- Data: `public/landing/journey.json` from `backend/scripts/export_landing_journey.py` (Beed <- Treatment plant,
  Bid depot, OSRM 91.5 km; next = Parbhani; 7 depots). Live numbers still from /api/public/summary.
- Moments: Earth from orbit (globe right of the title); Maharashtra with crisis places + dry districts; depots link
  to their critical places while "JalSetu" lies on the Deccan plateau (CSS matrix3d homography from 4 ground points);
  Beed's real district lifts off the map, crisis column rises, card pinned to the column top; the real road draws
  itself; camera dives through the cloud deck onto the road behind the tanker into Beed (buildings grow with zoom);
  pull back to the dry districts, out to India from orbit; impact numbers fed by lines from the top crisis places;
  final dive into Parbhani's streets with "next on the planner's list".
- Landing.tsx: mode earth | world | static (fallback chain); earth mode = dark film chrome (earth-mode.css), no
  letterbox; EarthDescent.tsx deleted (World.tsx keeps its own ground chapter as fallback).
- Verified (Playwright, prod build): every chapter at 1440x900 and 390x844, reduced motion (earth, no errors), no
  WebGL (static map), all tiles blocked (hands over to the stylised world after 12 s). Warm pass on a quiet machine:
  p95 ~19 ms/frame, 3 frames > 50 ms; first visit has 50-300 ms hitches at altitude changes (tile decode), helped by
  the tile pack. Measurements on this machine vary 2x with background load. Dev aid: ?debug=expose,noclouds,nohill,
  nobuild,notank,nopaint.
- Tile pack: re-recorded for the whole film (see fetch_landing_earth.py, STEPS=150, 3 viewports).
Open: commit the tile pack or gitignore it (user to decide); sharper-than-10 m imagery only if a licensed source.

## 2026-10-05: PS-11 gap check and the two gaps closed
Compared PROGRESS against PS 11; gaps found and fixed:
- Citizen water requests: portal tab `/request` (EN/मराठी/हिंदी, voice, offline outbox, steppers for people and days,
  reason chips). Shows the ticket, "why this priority" (each factor's points, translated), progress steps and place in
  line; repeats from neighbours merge into the open request (re-scored if the dry spell is longer). `/track` accepts
  WR- numbers. Staff Requests page: "From" column, "From citizens" filter, source details. Linked from landing + sign-in.
  Migration 0005 adds `source, people_affected, language, input_mode, client_ref, queued_at` to water_requests
  (applied to the live DB automatically by the dev API's reload; additive only).
- Analytics "Demand and shortage": 7-day outlook (fleet 435,000 L/day vs survival floor ~5.8M vs forecast need
  ~55M for 89 places / 1.94M people: 7/7 shortage days), requests per day with repeats merged, most underserved
  places table linking to the Overview sheet.
- Verified on a DB copy (API :8010, preview :4180) with Playwright: Marathi request, neighbour merge, status page,
  offline request sent on reconnect, Analytics light/dark/phone. Backend tests: 84 passed.

## IN PROGRESS (2026-10-04 evening): free Google-Earth-like descent — resume here
User (latest): REMOVE the photo/footage ground scene and the Google 3D Tiles route; use a genuinely free/legal open
3D Earth stack; explorable; smooth descent India -> terrain -> city -> streets; no AI imagery.
Research result: Cesium ion free tier = non-commercial only, excludes government projects; Esri World Imagery needs an
ArcGIS licence; Google tiles are paid. Chosen key-free stack: MapLibre GL v5 (already a dependency; globe projection,
3D terrain, sky/atmosphere, fill-extrusion) + Sentinel-2 cloudless 2016 by EOX (CC BY 4.0, 10 m, overzoomed) + AWS
Terrarium DEM (Mapzen/SRTM, open) + OpenFreeMap vector tiles (OSM: buildings with heights, roads, labels; ODbL).
Limitation to state honestly: no free sub-metre imagery exists for India, so street-level ground is 10 m imagery; OSM
roads/buildings give the crisp street layer. OSM building coverage in Beed is sparse -> consider Overture/Google Open
Buildings footprints (CC BY 4.0 / ODbL) exported for Beed town.
Steps: 1 [x] EarthDescent.tsx (MapLibre canvas, scroll-driven jumpTo from the story clock, prefetch before the chapter,
hand-over hidden in the three.js cloud whiteout, interactive "look around" during the hold); 2 [x] remove photo layer,
GoogleTiles.tsx, 3d-tiles-renderer, Google attribution, shirur assets; 3 [ ] building footprints for Beed if OSM sparse;
4 [x] Playwright smoothness + visual pass (prod build, full journey with bursts/steady pass/jumps after a reading
pause: 138 fps, 1 frame >34 ms (49 ms)); path tiles pre-warmed while the visitor reads earlier chapters; drag
look-around during the hold (mouse + touch); compact credits on phones. Step 3 (extra Beed footprints) optional:
OSM already has a dense building layer for Beed town.
2026-10-05: tile pack. The 1,518 tiles the descent uses (S2 z8-15, DEM z5-13, OSM z7-14, one glyph range; 30.6 MB)
ship in `frontend/public/landing/earth/`; MapLibre loads them through an `earth://` protocol that falls back to the
public servers for anything not packed. Verified on the production build: 0 requests to public tile servers during
the descent. Re-make with `python -m scripts.fetch_landing_earth record <frontend url> ../frontend/public/landing/earth`
then `... fetch ../frontend/public/landing/earth` (in backend/). No free sub-metre imagery for India exists, so
"sharper imagery" stays open until a licensed source is available.

## Landing page: one continuous 3D world (2026-10-04)
- `/` and `/welcome`: scroll drives one WebGL scene (`components/landing/World.tsx`, React Three Fiber, no new deps)
  through nine chapters (`landing/story.ts`: camera keys + phase values); DOM type and world-anchored labels follow the
  same clock from one frame loop, so scrolling never re-renders React.
- Real: 1,263 places, crisis scores, populations and district rainfall deficits from `/api/public/summary`; India state +
  Maharashtra district outlines from `public/landing/geo.json` (geoBoundaries, regenerate with
  `python -m scripts.export_landing_geo ../frontend/public/landing/geo.json` in backend/). Illustrations, labelled on
  the page: supply arcs/flow particles, the tanker run, national arcs.
- Quality tiers (fewer particles, lower DPR on phones/weak devices), reduced motion (direct camera settles, letters
  pre-formed, no drift), static SVG fallback without WebGL, screen-reader copy of every chapter, keyboard chapter rail.
- Daylight version: India as a white relief (Maharashtra raised) on a pale sea with a graticule, sun + soft shadows that
  follow the camera, haze, cloud banks only during the dive into Maharashtra and the climb back out, dust for depth;
  flight feel (speed widens the lens, sideways speed banks the camera, hand-held drift), inertial mouse-wheel scrolling,
  giant drifting chapter numerals. Atmosphere is decoration, not data.
- Verified with Playwright at 1440/820/390 px + reduced motion + no-WebGL. Prod build: ~165 fps unthrottled; at 4x CPU
  throttle ~164 fps when settled, 45-60 fps while the camera is moving.
- Cinema pass: ground is NASA Blue Marble shaded relief + bathymetry (public domain, fetched from GIBS WMS into
  `public/landing/earth.jpg` 3072x2560 and `earth-mh.jpg` for the Maharashtra plateau), soft-edged into the haze. Film
  pipeline (three's EffectComposer, no new deps): tilt-shift focus (stronger close to the ground), speed zoom blur,
  lens fringing, grade, vignette, grain; switches itself off if the device can't hold ~45 fps. Story clock is a
  critically damped spring. Letterbox bars during the flights, 3D page-turn on headlines, pointer-tilting 3D cards
  (Framer Motion springs), spring-flipped impact slabs, extruded 3D wordmark, scroll hint, error boundary -> static map.
- Descent chapter "On the ground" (06): the camera plunges from the map through raymarched cumulus (3D noise, real
  1.8-3.3 km altitude, sun-lit, casting shadows on the ground) onto real terrain near Beed: elevation (Mapzen/SRTM) +
  Sentinel-2 cloudless 2016 imagery (EOX, CC BY 4.0), fetched by `backend/scripts/fetch_landing_ground.py` into
  `public/landing/{ground,height}-{mid,hi}.*`. Trees placed where the image is green, cracked dry earth up close.
  Illustration (labelled): a tanker drives in on a dirt road to a village water point where people wait with pots;
  its label steps En route -> Arrived (150 m geofence ring) -> Delivering. Then it climbs back to the exact map view.
  Map timeline remapped around the new chapter (`story.base`); dynamic resolution holds the frame rate.
  Dev aid: `?debug=noclouds,nofilm,noground,nosky,noshadow,fixeddpr`.

## State (2026-10-04 midday): Phase 2 (frontend transformation) complete

Phase 1 is complete (see Done). Real phone GPS: accepted by the user on the 2026-10-03 run.

Phase 2 (commits 9b2cf7e, 643d156, 820aaeb, 5a143c2, cb92f53, 801bf7a, d6ddbb3, 23e9a88):
- Design system: tokens in `src/index.css` (cool neutrals, one water accent, full dark theme via `html[data-theme]`,
  palette shades remapped in `tailwind.config.js`), `src/theme.ts` (light/dark/auto, switch in nav + command palette),
  fonts self-hosted (Geist, Geist Mono, Mona Sans with width axis + italic, Mukta for Devanagari), icons = Phosphor via
  `src/components/icons.tsx` (`lucide-react` removed), motion tokens `src/motion.ts`.
- UI kit `src/components/ui.tsx`: provenance/trust marks (`Provenance`, `ProvMark`: solid=observed, outline/dashed=derived,
  hatched=reference/synthetic, hollow=stale, struck=offline), metrics, drawers with focus trap, dialogs, tabs with keys.
- Shell: nav rail (auto-collapses to icons below 1440 px; expanding there lasts for the session), mobile nav sheet,
  skip link, theme switch, realtime indicator.
- Map `components/map/OpsMap.tsx`: theme basemaps, clustered places, HTML vehicle markers that glide between real fixes
  and change SHAPE for live/stale/offline, route draw-on, district drill-down, overlay-aware camera padding.
- Command centre: map-first with floating situation strip + intelligence rail from 1280 px; stacked layout below
  (KPIs in a 2/3-column grid, no sideways scroll).
- Live operations: map-first, trips grouped by GPS freshness, FreshnessMeter, TripProgress, follow mode (`components/live.tsx`).
- `components/DataTable.tsx` (search, filters, sort, paging, expand, keyboard) on requests, complaints, communities,
  trips, verification, fleet, alerts, allocation; columns hide by breakpoint on phones. Charts theme-aware.
- Driver app: mobile-first task card + thumb dock (geofence approach bar), status pills, menu sheet, finish state.
- Citizen portal: own register (`.citizen` scoped tokens, icon tiles). Heavy screens lazy-loaded (portal bundle ~226 KB gz).
- Reports: grouped export list; each row names the columns the CSV really contains; download state.
- Analytics: litres + trips per day, "Telemetry checks" (all six anomaly kinds, zeros shown), forecast panel.
- Impact: metric rows stack on phones. Login: Maharashtra outline is a watermark behind the headline.
- Responsive pass verified with Playwright at 1440, 1280, 820 and 390 px (no horizontal overflow, no page errors).
- Final light/dark desktop/mobile review: done by the user (2026-10-04).

State-wide forecast fix (23e9a88): `/analytics/forecast` and plan computation ran the model and fetched weather once
per place, so with 1,263 places the forecast never returned. Now places share ~28 km weather cells fetched in batched
Open-Meteo requests (50 cells each; a failed batch falls back to climatology for its cells only, retried after
10 min), the model predicts everything in one pass (`DemandForecaster.forecast_groups`, identical numbers, tested in
`tests/test_forecast_batch.py`), the weather cache is warmed at API start, and the endpoint memoises for 5 min.
Production build: forecast request ~0.2 s.

Restart with `start.ps1` (or `-Dev`).

## Next steps (resume here)
1. Demo housekeeping: checked 2026-10-05, done (T-2045 Available at Chembur with no open trip; Allocation page shows
   plan #24, Proposed, crisis scope). Approving #24 is the user's call (it rewrites allocations, Pending -> Allocated).
2. Optional: real-phone arrival + delivery run before the presentation (START and live tracking were accepted
   on a real phone; arrival/delivery were exercised with emulated GPS on a DB copy).

## Housekeeping before any demo
- Before the phone demo, confirm T-2045 has no open trip (2026-10-05: none; 5 other tankers on Assigned trips).
- User's OS has "reduce motion" on (Windows Animation effects off): app tones motion down; turn it on to show full motion.

## Known issues
- SACHET polygon endpoint rate-limits (HTTP 403) after bursts; ingestion pauses and retries, shown as DEGRADED.
- Lint: only warnings (set-state-in-effect, fast-refresh exports); jsx-key warnings in the map legend are false positives (tuple arrays).
- Dev server only: React StrictMode runs effects twice, so pages fire duplicate requests that queue on the single
  API process and look slow. Judge load times on the production build (`npm run build`, `vite preview`).
- Browser GPS stops when the phone screen is off; driver must keep the page open (wake lock requested).
