# JalSetu integrations

Every external source JalSetu reads, how it is reached, what it needs, and how its data is labelled.
The live status of each one is on **Administration → System health** (`GET /api/system/health`); the
registry behind that page is `backend/app/ingestion/base.py` (`SOURCES`).

Provenance rule: every stored record says where it came from (`data_origin`):
`external` (imported, with source URL), `manual` (staff), `citizen` (public portal), `seeded` (reference data
loaded by `scripts/seed.py`), `synthetic` (labelled demo history, never operational). Derived numbers are
labelled in the UI as **Estimated** or **ML prediction**, never shown as observed.

## Connected (no credentials needed)

| Source | Used for | Endpoint | Frequency | Licence |
|---|---|---|---|---|
| NDMA SACHET (CAP 1.2) | Official disaster alerts, affected areas, impact on communities and trips | `https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml` + per-alert CAP XML | polled every 5 min (`SACHET_POLL_SECONDS`) | Public domain (declared in feed) |
| Open-Meteo forecast | Demand forecast weather inputs | `https://api.open-meteo.com/` | on demand, cached 3 h | CC BY 4.0 |
| Open-Meteo archive (ERA5) | Monsoon rainfall deficit per district vs previous 10 years → crisis signals | `https://archive-api.open-meteo.com/v1/archive` | every 3 h with crisis refresh | CC BY 4.0 |
| Google News RSS (EN + Marathi) | Water-crisis news matched to towns/districts → crisis signals (unverified until an operator confirms) | `https://news.google.com/rss/search` | every 3 h | Headlines + links only; publisher copyright |
| OpenStreetMap via Overpass | 1,263 Maharashtra settlements with population tags; 465 water sites (depot siting, distance-to-water factor) | `overpass-api.de` mirrors | manual (`python -m app.ingestion maharashtra`), cached in `backend/var/cache` | ODbL 1.0 |
| geoBoundaries IND ADM1/ADM2 | State and district polygons; locating communities and alerts | `https://www.geoboundaries.org/api/current/gbOpen/IND/` | static release | ADM1 CC BY 2.5 IN, ADM2 ODbL |
| OSRM | Road routing and ETA (falls back to straight line × `roadCircuityFactor`, labelled) | `OSRM_URL` (default public demo server) | on demand | OSM data ODbL |
| Device GPS (driver phone) | Live vehicle position, arrival geofence, route deviation, distance travelled | `POST /api/tracking/telemetry` | every few seconds while a trip is started | own data |

Production note: the public OSRM demo server is rate-limited; self-host OSRM with the India extract and set `OSRM_URL`.

## Awaiting credentials or agreements

Shown as **awaiting credentials** on the health page until configured. Nothing is simulated in their place.

| Source | What it would add | How to get access | Setting |
|---|---|---|---|
| IMD district warnings API | Official district weather warnings | IMD whitelists the server's public IP (request via mausam.imd.gov.in) | `IMD_API_ENABLED=true`, `IMD_API_BASE` |
| CWC flood forecasting | River levels / flood forecasts | Formal data-sharing request to CWC / India-WRIS (no public API) | `CWC_API_URL` |
| data.gov.in (OGD) | All ~43,000 Census villages with population; SECC/NFHS vulnerability | Free API key after registration at data.gov.in | `DATA_GOV_IN_API_KEY` |
| VLTD / AIS-140 trackers | Telemetry from fitted vehicle trackers instead of phones | Agreement with state transport dept. / device vendor | `VLTD_GATEWAY_TOKEN` |

## Inbound interfaces JalSetu offers

| Interface | Auth | Notes |
|---|---|---|
| `POST /api/tracking/telemetry` | Driver session (assigned driver only) | Batches of fixes with device time; duplicate-safe on (vehicle, device time); offline-buffered fixes accepted up to `maxBufferedAgeHours`; implausible jumps rejected and logged |
| `POST /api/public/complaints` | none (rate-limited per IP, 5 per 10 min) | `clientRef` makes resends idempotent (offline outbox); `language`, `inputMode` recorded |
| `GET /api/public/supply/{communityId}`, `GET /api/public/schedules`, `GET /api/public/communities`, `GET /api/public/summary` | none | Read-only public data; no vehicle positions or personal data |
| `GET /api/reports/{kind}.csv` | staff with `export_reports` | communities, requests, complaints, deliveries, allocation, trips |
| WebSocket `/api/ws?token=` | staff session | Live fan-out: vehicles, trips, alerts, requests, schedules |

## Background jobs

`app/ingestion/jobs.py`: tracking sweep (5 s), SACHET (5 min), source probes (1 h), crisis signals
(`dispatch.crisisRefreshMinutes`, default 3 h), auto-dispatch proposals (`dispatch.autoProposeMinutes`, default 30 min).
Run them in exactly one place: inside the API (`RUN_BACKGROUND_JOBS=true`, single-process) or in the `worker`
container (`python -m app.ingestion worker`, with `RUN_BACKGROUND_JOBS=false` on the API). `docker-compose.yml` does the latter.

## Command-line ingestion

```
python -m app.ingestion sachet | geography | lgd FILE.csv | probes | maharashtra | crisis | depots [K] [--keep T-1,T-2] | worker
python -m scripts.demo_history [--days 28] [--remove]     # labelled synthetic history (charts, impact replay)
```
