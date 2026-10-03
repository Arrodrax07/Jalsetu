# JalSetu web app (frontend)

React 19 + TypeScript + Vite + Tailwind + Motion + MapLibre. One codebase, three experiences:

| URL | Who | What |
|---|---|---|
| `/` (staff sign-in) | control room: admin, operator, dispatcher | overview map, live operations, trips and auto-dispatch, delivery verification, fleet, disasters, requests, allocation, communities, tap schedules, complaints, impact, analytics, reports, administration |
| `/` (driver sign-in) | tanker drivers, on a phone | current trip, live GPS, START / ARRIVED / DELIVERY / END, proof of delivery; English / मराठी / हिंदी, voice commands, spoken updates |
| `/report`, `/water`, `/track` | residents, no account | report a problem (typed or spoken, any of the three languages, works offline), when water is coming, complaint status |
| `/welcome` | anyone | public story page with live statewide numbers |

All data comes from the API. Nothing in the app is mocked.

## Run

```powershell
npm ci
npm run dev        # http://localhost:5173, proxies /api (+ WebSocket) to http://127.0.0.1:8000
npm run build      # type-check + production bundle in dist/
npm run preview -- --port 5173   # serve the build with the same proxy (service worker active)
npm run lint
```

`..\start.ps1` builds and previews by default (`-Dev` for the dev server).

## Offline citizen portal (PWA)

* `public/manifest.webmanifest` + icons make `/report` installable.
* `public/sw.js` caches the app shell, built assets and the read-only public data (places, schedules, supply
  info). It never touches staff APIs or POSTs.
* Complaints written offline go to an on-device outbox (`src/citizen/outbox.ts`, localStorage) with a
  client-generated `clientRef`; they are sent on reconnect, on load and every 30 s, with back-off. The server
  stores a `clientRef` once, so resends are safe. Residents see queued / sending / failed items and can retry
  or remove them.
* Offline reload is reliable on the production build; the Vite dev server's modules are not cacheable the same way.

## Languages and voice

`src/i18n/index.tsx` (strings in three languages, choice remembered on the device) and `src/i18n/speech.ts`
(Web Speech API dictation with listening / processing / done / no speech / permission denied / unsupported /
offline states; speech synthesis for read-aloud and driver updates; driver command words in all three
languages). Recognition runs on the browser vendor's service and needs a connection.

## Structure

```
src/
├── App.tsx               routing by path and role, lazy pages
├── context/AppContext.tsx session (memory token + refresh cookie), data slices, WebSocket live updates, server clock
├── services/api.ts       typed API client (single-flight refresh, device id)
├── types/index.ts        wire types (mirror backend/app/services/views.py)
├── pages/                one file per screen
├── driver/               driver app, GPS watcher + buffered telemetry uploader
├── citizen/              outbox, portal widgets (language switch, voice button, offline UI, install)
├── i18n/                 strings + speech
└── components/           ui kit, shell, map (MapLibre), charts theme, panels
```

**Driver GPS needs a secure context** (`https://` or `localhost`). For a phone, use the production build behind
a tunnel: `cloudflared tunnel --url http://localhost:5173`.
