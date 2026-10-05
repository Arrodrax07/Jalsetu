/**
 * The descent to the ground on an open 3D Earth: MapLibre GL (globe projection, 3D terrain, sky) with
 *   - imagery:   Sentinel-2 cloudless 2016 by EOX IT Services (contains modified Copernicus Sentinel data), CC BY 4.0
 *   - terrain:   Mapzen Terrarium elevation tiles on AWS Open Data (SRTM and other public sources)
 *   - buildings, roads, names: OpenStreetMap via OpenFreeMap vector tiles (ODbL)
 * No API keys, no proprietary imagery, nothing generated. Tiles on the descent path ship with the site (see PACK).
 * The camera is driven by the same story clock as the rest of
 * the page (one critically damped spring from the scrollbar), so the descent glides however the visitor scrolls. While
 * the shot holds over the streets the map is explorable: drag to look around; scrolling takes the camera back.
 *
 * Mounted from the start (hidden) so tiles along the path are already cached when the chapter arrives.
 */
import React, { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { clock, earthState, smooth } from './story';

/** Beed town centre (real): the descent ends over its streets. */
const TOWN: [number, number] = [75.7575, 18.9893];
const REGION: [number, number] = [75.72, 19.06];

/** Page progress for the chapter (matches story.G): in, settle on the streets, hold, climb, out. */
export const EARTH = { in0: 0.503, in1: 0.522, street: 0.585, hold: 0.612, out0: 0.648, out1: 0.66 };

interface Shot { u: number; zoom: number; pitch: number; bearing: number; c: number }
// u: 0..1 across EARTH.in0..EARTH.out1; c: 0 = REGION, 1 = TOWN (blended with zoom so the descent never swoops sideways)
const SHOTS: Shot[] = [
  { u: 0.0, zoom: 7.6, pitch: 25, bearing: -18, c: 0 },
  { u: 0.17, zoom: 9.6, pitch: 42, bearing: -6, c: 0.25 },
  { u: 0.34, zoom: 12.2, pitch: 56, bearing: 12, c: 0.75 },
  { u: 0.52, zoom: 15.4, pitch: 68, bearing: 34, c: 1 },
  { u: 0.66, zoom: 16.9, pitch: 74, bearing: 52, c: 1 },
  { u: 0.8, zoom: 16.9, pitch: 74, bearing: 66, c: 1 },   // hold over the streets (slow orbit)
  { u: 0.92, zoom: 12.4, pitch: 55, bearing: 82, c: 0.8 },
  { u: 1.0, zoom: 9.2, pitch: 40, bearing: 92, c: 0.3 },
];

function cameraAt(p: number) {
  const u = Math.min(1, Math.max(0, (p - EARTH.in0) / (EARTH.out1 - EARTH.in0)));
  let i = 0;
  while (i < SHOTS.length - 2 && u > SHOTS[i + 1].u) i++;
  const a = SHOTS[i], b = SHOTS[i + 1], t = smooth((u - a.u) / (b.u - a.u));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const c = lerp(a.c, b.c);
  return {
    // zoom is already logarithmic: interpolating it linearly gives a constant-feeling plunge
    zoom: lerp(a.zoom, b.zoom), pitch: lerp(a.pitch, b.pitch), bearing: lerp(a.bearing, b.bearing),
    center: [REGION[0] + (TOWN[0] - REGION[0]) * c, REGION[1] + (TOWN[1] - REGION[1]) * c] as [number, number],
  };
}

/**
 * Tile pack: the tiles along the descent ship with the site (`public/landing/earth`, made by
 * `backend/scripts/fetch_landing_earth.py`), so the chapter does not hang on the public servers during a demo.
 * `earth://<source>/<key>` serves the packed copy when there is one, otherwise the public tile server.
 */
const PACK = '/landing/earth/';
const REMOTE: Record<string, (key: string[]) => string> = {
  s2: ([z, y, x]) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  dem: ([z, x, y]) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  fonts: ([stack, range]) => `https://tiles.openfreemap.org/fonts/${encodeURIComponent(stack)}/${range}.pbf`,
};
const EXT: Record<string, string> = { s2: '.jpg', dem: '.png', osm: '.pbf', fonts: '.pbf' };
let packIndex: Promise<Record<string, Set<string>>> | null = null;
let osmTemplate: Promise<string> | null = null;
const loadPack = () => packIndex ??= fetch(`${PACK}index.json`)
  .then(r => (r.ok ? r.json() : {}) as Promise<Record<string, string[]>>).catch(() => ({} as Record<string, string[]>))
  .then(j => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, new Set(v)])));
// OpenFreeMap tile URLs are versioned; ask its TileJSON for the current one only when a tile is not packed
const loadOsmTemplate = () => osmTemplate ??= fetch('https://tiles.openfreemap.org/planet').then(r => r.json()).then(j => j.tiles[0] as string);

let protocolAdded = false;
function addPackProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  maplibregl.addProtocol('earth', async (params, abort) => {
    const [source, ...parts] = params.url.slice('earth://'.length).split('/').map(decodeURIComponent);
    const key = parts.join('/');
    const packed = (await loadPack())[source]?.has(key);
    const url = packed ? PACK + source + '/' + parts.map(encodeURIComponent).join('/') + EXT[source]
      : source === 'osm' ? (await loadOsmTemplate()).replace('{z}', parts[0]).replace('{x}', parts[1]).replace('{y}', parts[2])
      : REMOTE[source](parts);
    const r = await fetch(url, { signal: abort.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return { data: await r.arrayBuffer() };
  });
}

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  glyphs: 'earth://fonts/{fontstack}/{range}',
  sources: {
    s2: {
      type: 'raster', tileSize: 256, maxzoom: 15,
      tiles: ['earth://s2/{z}/{y}/{x}'],
      attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services</a> (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
    },
    dem: {
      type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 13,
      tiles: ['earth://dem/{z}/{x}/{y}'],
      attribution: 'Elevation: Mapzen Terrarium (SRTM and others), AWS Open Data',
    },
    osm: {
      type: 'vector', minzoom: 0, maxzoom: 14,
      tiles: ['earth://osm/{z}/{x}/{y}'],
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  sky: {
    'sky-color': '#7fa9cf', 'horizon-color': '#e4edf1', 'fog-color': '#dfe8ec',
    'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
  },
  terrain: { source: 'dem', exaggeration: 1.35 },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#dfe8ec' } },
    { id: 'imagery', type: 'raster', source: 's2', paint: { 'raster-saturation': 0.08, 'raster-contrast': 0.08, 'raster-fade-duration': 250 } },
    // OSM water bodies sharpen what 10 m pixels blur
    { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', minzoom: 11, paint: { 'fill-color': '#4f7f93', 'fill-opacity': 0.35 } },
    // roads: quiet at district scale, crisp on the streets
    { id: 'road-case', type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom: 12,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#3d3832', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.22],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1, 15, 3.2, 18, 18], 'line-blur': 1.2 } },
    { id: 'road', type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom: 12,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], '#6d6860', ['minor', 'service'], '#9c8a74', '#7d7468'],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 0.35, 16, 0.6],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.4, 15, 2.2, 18, 14], 'line-blur': 0.6 } },
    { id: 'buildings', type: 'fill-extrusion', source: 'osm', 'source-layer': 'building', minzoom: 13.5,
      paint: {
        'fill-extrusion-color': ['match', ['%', ['to-number', ['coalesce', ['id'], ['get', 'render_height'], 0]], 7],
          0, '#d8cbb6', 1, '#e6ddcf', 2, '#c9b597', 3, '#ddd3c3', 4, '#bfae96', 5, '#e9e2d6', '#cfc2ad'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 0.96],
        'fill-extrusion-vertical-gradient': true,
      } },
    { id: 'road-names', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 15,
      layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
      paint: { 'text-color': '#2b2622', 'text-halo-color': '#f4efe6', 'text-halo-width': 1.4 } },
    // names stay sparse, like a globe viewer: towns from afar, a few villages only once you are low
    { id: 'places', type: 'symbol', source: 'osm', 'source-layer': 'place', minzoom: 8, maxzoom: 15,
      filter: ['any', ['match', ['get', 'class'], ['city', 'town'], true, false], ['all', ['==', ['get', 'class'], 'village'], ['>=', ['zoom'], 12.8]]],
      layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 14], 'text-letter-spacing': 0.04, 'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 2], 'text-padding': 24 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(20,30,36,0.65)', 'text-halo-width': 1.5 } },
  ],
};

export const EarthDescent: React.FC<{ reduce: boolean }> = ({ reduce }) => {
  const box = useRef<HTMLDivElement>(null), mapEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current, mapBox = mapEl.current;
    if (!el || !mapBox) return;
    let map: MLMap | null = null;
    try {
      addPackProtocol();
      const c = cameraAt(EARTH.in0);
      map = new maplibregl.Map({
        container: mapBox, style: STYLE, center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing,
        maxPitch: 80, interactive: true, maxTileCacheSize: 1500, attributionControl: { compact: true }, fadeDuration: 200,
        // a page-length scroll story: the wheel always scrolls the page; drags look around during the hold
        scrollZoom: false, boxZoom: false, doubleClickZoom: false, keyboard: false, cooperativeGestures: false,
        canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' },
      });
    } catch (e) {
      earthState.mode = 'failed';
      console.warn('Open Earth unavailable; the descent stays in the 3D world', e);
      return;
    }
    const m = map;
    if (new URLSearchParams(window.location.search).get('debug')?.includes('expose')) (window as unknown as { __earth: MLMap }).__earth = m;
    m.dragPan.disable(); m.dragRotate.disable(); m.touchZoomRotate.disable(); m.touchPitch.disable(); // our own look-around below
    m.on('error', ev => { if (!earthState.ready) console.warn('Open Earth tile error', ev.error?.message); });
    m.once('load', () => {
      // late-morning sun from the south-east, warm, so walls and roofs separate
      m.setLight({ anchor: 'map', position: [1.4, 150, 42], color: '#fff3df', intensity: 0.42 });
      // credits stay one tap away (the ⓘ button) instead of covering a phone screen
      mapBox.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(n => n.classList.remove('maplibregl-compact-show'));
      earthState.ready = true; earthState.mode = 'ready';
    });

    // the visitor's own look-around (during the hold): drag sideways to turn, up/down to tilt; it rides on top of the
    // scripted shot and eases away once they scroll on
    const user = { bearing: 0, pitch: 0, active: false };
    let drag: { x: number; y: number; b: number; p: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, b: user.bearing, p: user.pitch, id: e.pointerId }; user.active = true; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      user.bearing = drag.b - (e.clientX - drag.x) * 0.25;
      user.pitch = Math.max(-40, Math.min(10, drag.p + (e.clientY - drag.y) * 0.12));
    };
    const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; user.active = false; el.style.cursor = 'grab'; } };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);

    // pre-warm: while the visitor is still in the earlier chapters, the hidden map flies the descent once, so every
    // tile on the path is fetched and decoded before it is needed (no decoding hitches mid-descent)
    const warm = { i: 0, done: false, next: 0 };
    const WARM_STEPS = 26;
    let raf = 0, lastP = -1, lastT = performance.now(), wasInteractive = false;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      const p = clock.p;
      const vis = Math.min(smooth((p - EARTH.in0) / (EARTH.in1 - EARTH.in0)), 1 - smooth((p - EARTH.out0) / (EARTH.out1 - EARTH.out0)));
      earthState.opacity = earthState.ready ? vis : 0;
      el.style.opacity = earthState.opacity.toFixed(3);
      el.style.visibility = earthState.opacity < 0.002 ? 'hidden' : 'visible';
      const holding = p > EARTH.street && p < EARTH.hold + 0.01 && earthState.opacity > 0.98;
      if (holding !== wasInteractive) {
        wasInteractive = holding;
        el.style.pointerEvents = holding ? 'auto' : 'none'; el.style.touchAction = holding ? 'pan-y' : '';
        el.style.cursor = holding ? 'grab' : '';
        if (!holding) { drag = null; user.active = false; }
      }
      // look-around decays as soon as the visitor scrolls again
      if (!holding && !user.active) { const k = 1 - Math.exp(-dt * 3); user.bearing -= user.bearing * k; user.pitch -= user.pitch * k; }
      // drive the camera only when something changed: MapLibre then renders only when it must
      if (Math.abs(p - lastP) < 1e-6 && Math.abs(user.bearing) < 0.01 && Math.abs(user.pitch) < 0.01 && earthState.opacity === 0) return;
      if (!warm.done && earthState.ready && p < EARTH.in0 - 0.02 && p > 0.2) {
        if (now >= warm.next && m.areTilesLoaded()) {
          const u = warm.i / (WARM_STEPS - 1);
          const c = cameraAt(EARTH.in0 + u * (EARTH.out1 - EARTH.in0));
          m.jumpTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing });
          warm.i++; warm.next = now + 120;
          if (warm.i >= WARM_STEPS) warm.done = true;
          lastP = -1;
        }
        return;
      }
      const near = p > EARTH.in0 - 0.12 && p < EARTH.out1 + 0.05;  // prefetch path tiles before the chapter
      if (!near && lastP >= 0) { lastP = p; return; }
      lastP = p;
      const c = cameraAt(p);
      m.jumpTo({ center: c.center, zoom: c.zoom, pitch: Math.min(80, c.pitch + user.pitch), bearing: c.bearing + user.bearing + (reduce ? 0 : 0) });
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); m.remove(); earthState.ready = false; earthState.opacity = 0; };
  }, [reduce]);

  // MapLibre makes its container position:relative, so the full-screen frame is a separate wrapper
  return (
    <div ref={box} className="landing-earth absolute inset-0 opacity-0" style={{ visibility: 'hidden', pointerEvents: 'none' }}>
      <div ref={mapEl} aria-label="3D Earth around Beed: drag to look around" className="h-full w-full" />
    </div>
  );
};

export default EarthDescent;
