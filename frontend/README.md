# JalSetu web app (frontend)

React 19 + TypeScript + Vite + Tailwind. One codebase, three experiences:

| URL | Who | What |
|---|---|---|
| `/` (admin, officer) | control room | dashboard, requests, complaints, communities, demand & forecast, allocation, route & dispatch, live tracking, delivery verification, impact, reports, settings |
| `/` (driver login) | tanker drivers, on a phone | current trip, live GPS sharing, navigation links, proof of delivery with meter photo |
| `/report` (public) | citizens | file a complaint in any language, get a ticket number |

All data comes from the API; there is no mock data in the app.

## Run

```powershell
npm ci
copy .env.example .env.local   # optional
npm run dev                    # http://localhost:5173, proxies /api (+ WebSocket) to http://127.0.0.1:8000
npm run build                  # type-check + production bundle in dist/
npm run lint
```

The backend must be running (see `../backend/README.md`).

**Driver GPS needs a secure context**: browsers only expose geolocation on `https://` or
`localhost`. To test the driver app on a phone over Wi-Fi, serve through HTTPS (the Docker /
nginx setup behind a TLS terminator, or a tunnel such as `cloudflared`).

## Structure

```
src/
├── App.tsx                       routing by role / path, code-split pages
├── context/WaterDataContext.tsx  session, data slices, WebSocket live updates, actions
├── services/api.ts               typed API client (JWT, errors, CSV/photo downloads)
├── types/index.ts                wire types (mirror backend/app/services/views.py)
├── pages/                        one file per screen (+ DriverApp, CitizenPortal)
├── components/                   layout, map (Leaflet + OSM tiles), charts theme, modals, badges
└── utils/format.ts               litres / dates / percentages
```

Live updates: the context opens `/api/ws?token=…`, applies `tanker.position` events in place and
re-fetches only the affected slices for other events (debounced). If the socket drops it
reconnects with back-off and falls back to polling tanker positions every 15 s.
