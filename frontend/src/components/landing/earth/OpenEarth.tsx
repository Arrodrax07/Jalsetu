/**
 * The landing film's world: one real 3D Earth (MapLibre globe, Sentinel-2 imagery, Terrarium elevation,
 * OpenStreetMap roads and buildings) and one camera, from orbit to Beed's streets and back out to the next place.
 *
 * One requestAnimationFrame loop does everything per frame: it advances the story clock (story.stepClock), asks the
 * journey timeline for the camera shot and the scene state at that progress, moves the map camera, updates the few
 * paint properties that changed, draws the cloud deck and places the DOM labels. React renders this component once.
 *
 * Real: places, crisis scores and populations (/api/public/summary), district rainfall deficits, district outlines
 * (geoBoundaries), depots and the OSRM road from the depot that serves Beed (journey.json), terrain, imagery, roads,
 * buildings. Illustrated, and labelled on the page: the tanker's run. Atmosphere: the cloud deck.
 */
import React, { useEffect, useRef } from 'react';
import maplibregl, { type ExpressionSpecification, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PublicSummary } from '../../../types';
import { plain, type GeoFile } from '../geo';
import { clock, earthState, groundState, stepClock } from '../story';
import type { Anchors, Quality } from '../World';
import { CloudDeck, cameraBasis } from './clouds';
import { blank, buildKeys, sceneAt, shotAt, tankerAt, turnRate, type JourneyData, type Scene } from './journey';
import { FOV, Path, clamp, enu, haversine, rangeToZoom, type LngLat } from './math';
import { GLYPHS, SOURCES, addPackProtocol } from './tiles';
import { tankerLayer, type TankerState } from './tanker';

export interface EarthInfo {
  focusName: string | null; focusDistrict: string | null; focusCrisis: number; focusPop: number;
  depotName: string; routeKm: number; nextName: string; nextCrisis: number; nextDistrict: string | null; asOf: string;
}
export interface OpenEarthProps {
  geo: GeoFile; summary: PublicSummary; quality: Quality; reduce: boolean;
  anchors: React.MutableRefObject<Anchors>;
  onReady?: (info: EarthInfo) => void;
  onFail: (why: string) => void;
}

/** The headline that lies on the Deccan plateau (chapter 03): its geographic footprint. */
const WORD_CENTER: LngLat = [76.15, 19.62];
const WORD_W = 1300, WORD_H = 250; // the headline element's box (px), kept in step with its classes below
const wordHalf = (portrait: boolean): [number, number] => (portrait ? [1.15, 0.2] : [1.95, 0.34]);
/** Street hold: the visitor may look around. */
const HOLD: [number, number] = [0.598, 0.632];
const SUN_AZ = 140, SUN_EL = 42; // late morning, south-east
/** Height of the focus place's column at crisis 100 (m), and of the district as it lifts off the map. */
const COLUMN_M = 30000, RISE_M = 3500;

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });
const circlePoly = (c: LngLat, radius: number, n = 48): GeoJSON.Polygon => {
  const k = radius / 111320, ring: number[][] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ring.push([c[0] + (k * Math.sin(a)) / Math.cos((c[1] * Math.PI) / 180), c[1] + k * Math.cos(a)]); }
  return { type: 'Polygon', coordinates: [ring] };
};

/** CSS matrix3d that maps an element (w x h) onto four screen points (TL, TR, BR, BL). */
function quadMatrix(w: number, h: number, q: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  // unit square -> quad, then scale the element's box to the unit square
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map(v => +v.toFixed(8)).join(',')})`;
}

function style(geo: GeoFile, s: PublicSummary, j: JourneyData, quality: Quality): StyleSpecification {
  const F: LngLat = [j.focus.lng, j.focus.lat], N: LngLat = [j.next.lng, j.next.lat];
  const deficit = new Map(s.rainfall.map(r => [plain(r.district), r.deviation]));
  const focusKey = plain(j.focus.district ?? '');
  const district = geo.districts.find(d => d.key === focusKey);
  // every crisis place to its nearest depot: the planner's starting rule, drawn
  const depotLL: LngLat[] = j.depots.map(d => [d.lng, d.lat]);
  const links = s.points.filter(p => p[2] >= 70).map(p => {
    const at: LngLat = [p[0], p[1]];
    const dep = depotLL.reduce((best, d) => (haversine(d, at) < haversine(best, at) ? d : best), depotLL[0]);
    return { type: 'Feature', properties: { crisis: p[2] }, geometry: { type: 'LineString', coordinates: [dep, at] } } as GeoJSON.Feature;
  });
  const statesFC = fc(geo.states.flatMap(st => st.rings.map(r => ({ type: 'Feature', properties: { name: st.name }, geometry: { type: 'LineString', coordinates: r } }) as GeoJSON.Feature)));
  const districtsFC = fc(geo.districts.map(d => ({
    type: 'Feature', properties: { key: d.key, deviation: deficit.get(d.key) ?? 0 },
    geometry: { type: 'MultiPolygon', coordinates: d.rings.map(r => [r]) },
  }) as GeoJSON.Feature));
  const lowDetail = quality === 'low';
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: GLYPHS,
    sources: {
      ...SOURCES,
      demShade: { ...SOURCES.dem } as typeof SOURCES.dem,
      places: { type: 'geojson', data: fc(s.points.map(([lng, lat, crisis, pop]) => ({ type: 'Feature', properties: { crisis, pop }, geometry: { type: 'Point', coordinates: [lng, lat] } }) as GeoJSON.Feature)) },
      depots: { type: 'geojson', data: fc(j.depots.map(d => ({ type: 'Feature', properties: { name: d.name }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } }) as GeoJSON.Feature)) },
      links: { type: 'geojson', lineMetrics: true, data: fc(links) },
      states: { type: 'geojson', data: statesFC },
      districts: { type: 'geojson', data: districtsFC },
      focusDistrict: { type: 'geojson', data: fc(district ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: district.rings.map(r => [r]) } }] : []) },
      column: { type: 'geojson', data: fc([{ type: 'Feature', properties: {}, geometry: circlePoly(F, 1400) }]) },
      beacon: { type: 'geojson', data: fc([{ type: 'Feature', properties: {}, geometry: circlePoly(N, 14, 32) }]) },
      route: { type: 'geojson', lineMetrics: true, data: fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: j.route.lngLat } }]) },
    },
    sky: {
      // deep space above the atmosphere, daylight sky once the camera is low
      'sky-color': ['interpolate', ['linear'], ['zoom'], 3, '#03070c', 6, '#0d2238', 9, '#5f8fbb', 12, '#8ab4d6'],
      'horizon-color': ['interpolate', ['linear'], ['zoom'], 3, '#2a5b85', 8, '#bcd3e2', 12, '#e5edf1'],
      'fog-color': ['interpolate', ['linear'], ['zoom'], 5, '#b5c8d4', 12, '#dfe7ea'],
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.8,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4.5, 1, 7, 0],
    },
    terrain: { source: 'dem', exaggeration: 1.4 },
    layers: [
      { id: 'space', type: 'background', paint: { 'background-color': '#03070c' } },
      { id: 'imagery', type: 'raster', source: 's2', paint: { 'raster-saturation': 0.06, 'raster-contrast': 0.1, 'raster-fade-duration': 300 } },
      { id: 'relief', type: 'hillshade', source: 'demShade', maxzoom: 12, paint: { 'hillshade-exaggeration': 0.32, 'hillshade-shadow-color': '#2a2016', 'hillshade-highlight-color': '#fff8ec', 'hillshade-illumination-direction': 315 } },
      { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', minzoom: 10, paint: { 'fill-color': '#3f6f84', 'fill-opacity': 0.4 } },
      { id: 'deficit', type: 'fill', source: 'districts', paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'deviation'], -60, '#b8411a', -35, '#d9772c', -15, '#e9b45c', 0, 'rgba(0,0,0,0)'],
        'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } } },
      { id: 'district-lines', type: 'line', source: 'districts', maxzoom: 10, paint: { 'line-color': '#f5efe2', 'line-width': 0.7, 'line-opacity': 0 } },
      { id: 'states', type: 'line', source: 'states', maxzoom: 9, paint: { 'line-color': '#e9f3f6', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 1.2], 'line-opacity': 0.22 } },
      { id: 'roads', type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom: 11,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], '#6d6860', '#8f8170'],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13.5, 0.4, 16, 0.6],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.4, 15, 2.2, 18, 14], 'line-blur': 0.6 } },
      { id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7fe3f5', 'line-opacity': 0, 'line-blur': ['interpolate', ['linear'], ['zoom'], 7, 6, 15, 3],
          'line-width': ['interpolate', ['exponential', 1.7], ['zoom'], 6, 5, 12, 10, 16, 26, 19, 90] } },
      { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        // a bright line from orbit; on the street it narrows to the carriageway, so the road itself shows through
        paint: { 'line-color': '#e9fbff', 'line-opacity': 0,
          'line-width': ['interpolate', ['exponential', 1.7], ['zoom'], 6, 1.6, 12, 3, 15, 5, 17, 9, 19, 30] } },
      { id: 'links', type: 'line', source: 'links', layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#9be7f6', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 8, 1.4], 'line-opacity': 0 } },
      { id: 'rise', type: 'fill-extrusion', source: 'focusDistrict', paint: {
        'fill-extrusion-color': '#f0b25a', 'fill-extrusion-opacity': 0.0, 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-vertical-gradient': true } },
      { id: 'buildings', type: 'fill-extrusion', source: 'osm', 'source-layer': 'building', minzoom: lowDetail ? 14.5 : 13.5,
        paint: {
          'fill-extrusion-color': ['match', ['%', ['to-number', ['coalesce', ['get', 'render_height'], 0]], 7],
            0, '#d8cbb6', 1, '#e6ddcf', 2, '#c9b597', 3, '#ddd3c3', 4, '#bfae96', 5, '#e9e2d6', '#cfc2ad'],
          // buildings grow out of the ground as the camera comes down, instead of popping in
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], lowDetail ? 14.5 : 13.5, 0, 15.6, ['coalesce', ['get', 'render_height'], 6]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': true,
        } },
      { id: 'column', type: 'fill-extrusion', source: 'column', paint: {
        'fill-extrusion-color': '#e2543a', 'fill-extrusion-opacity': 0.92, 'fill-extrusion-height': 0, 'fill-extrusion-vertical-gradient': true } },
      { id: 'beacon', type: 'fill-extrusion', source: 'beacon', paint: {
        'fill-extrusion-color': '#7fe3f5', 'fill-extrusion-opacity': 0.85, 'fill-extrusion-height': 0 } },
      { id: 'places-halo', type: 'circle', source: 'places', filter: ['>=', ['get', 'crisis'], 70], paint: {
        'circle-color': '#ff6b3d', 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 7, 12, 10, 26] } },
      { id: 'places-low', type: 'circle', source: 'places', filter: ['<', ['get', 'crisis'], 40], paint: {
        'circle-color': '#9fe0ee', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 6, 1.3, 9, 2.4, 12, 3.6],
        'circle-opacity': 0, 'circle-pitch-alignment': 'map' } },
      { id: 'places', type: 'circle', source: 'places', filter: ['>=', ['get', 'crisis'], 40], paint: {
        'circle-color': ['step', ['get', 'crisis'], '#f2b552', 70, '#ff6b3d'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], ...[[3, 1.1], [6, 2.2], [9, 4], [12, 6]].flatMap(([z, r]) => [z, ['*', r, ['step', ['get', 'crisis'], 1, 70, 1.3]]])] as unknown as ExpressionSpecification,
        'circle-stroke-color': 'rgba(3,7,12,0.55)', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0, 8, 0.8],
        'circle-opacity': 0, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } },
      { id: 'depots', type: 'circle', source: 'depots', paint: {
        'circle-color': '#e9fbff', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 6], 'circle-stroke-color': '#0a7f99',
        'circle-stroke-width': 2, 'circle-opacity': 0, 'circle-stroke-opacity': 0 } },
      { id: 'town-names', type: 'symbol', source: 'osm', 'source-layer': 'place', minzoom: 9, maxzoom: 15,
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-letter-spacing': 0.05, 'text-padding': 30 },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10,20,26,0.6)', 'text-halo-width': 1.4 } },
      { id: 'road-names', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 15.5,
        layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#2b2622', 'text-halo-color': '#f4efe6', 'text-halo-width': 1.4 } },
    ],
  };
}

/** Draw a line from its start up to `prog` (0..1) with line-gradient. */
const drawTo = (prog: number, color: string): ExpressionSpecification =>
  ['step', ['line-progress'], color, Math.max(0.0005, Math.min(0.9995, prog)), 'rgba(0,0,0,0)'];

export const OpenEarth: React.FC<OpenEarthProps> = ({ geo, summary, quality, reduce, anchors, onReady, onFail }) => {
  const wrap = useRef<HTMLDivElement>(null), mapEl = useRef<HTMLDivElement>(null);
  const cloudEl = useRef<HTMLCanvasElement>(null), svgEl = useRef<SVGSVGElement>(null), wordEl = useRef<HTMLDivElement>(null);
  const cb = useRef({ onReady, onFail }); cb.current = { onReady, onFail };

  useEffect(() => {
    const box = wrap.current, mapBox = mapEl.current, cloudCanvas = cloudEl.current, svg = svgEl.current;
    if (!box || !mapBox || !cloudCanvas || !svg) return;
    let disposed = false, map: MLMap | null = null, raf = 0, deck: CloudDeck | null = null;
    let timer = 0, imageryTimer = 0, cleanupExtra = () => {};
    const fail = (why: string) => {
      if (disposed || earthState.mode === 'failed') return;
      earthState.mode = 'failed'; earthState.ready = false;
      console.warn('Open Earth unavailable; using the fallback world:', why);
      cb.current.onFail(why);
    };

    (async () => {
      const r = await fetch('/landing/journey.json');
      if (!r.ok) throw new Error(`journey.json ${r.status}`);
      const j = (await r.json()) as JourneyData;
      if (disposed) return;
      const road = new Path(j.route.lngLat);
      const F: LngLat = [j.focus.lng, j.focus.lat], N: LngLat = [j.next.lng, j.next.lat];
      let portrait = box.clientHeight > box.clientWidth * 1.05;
      let keys = buildKeys(j, road, portrait);
      addPackProtocol();
      try {
        map = new maplibregl.Map({
          container: mapBox, style: style(geo, summary, j, quality), interactive: false, maxPitch: 85, renderWorldCopies: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5),
          maxTileCacheSize: quality === 'high' ? 1200 : 400, fadeDuration: 250, attributionControl: { compact: true },
          canvasContextAttributes: { antialias: quality === 'high', powerPreference: 'high-performance' },
          center: [79.6, 21.4], zoom: 1.5,
        });
      } catch (e) { fail(`map: ${e}`); return; }
      const m = map;
      // dev aid: ?debug=noclouds,nohill,nobuild,notank,nopaint switch parts off to measure their cost
      const dbg = new URLSearchParams(window.location.search).get('debug') ?? '';
      try { if (!dbg.includes('noclouds')) deck = new CloudDeck(cloudCanvas, quality); } catch (e) { console.warn('cloud deck off:', e); }
      timer = window.setTimeout(() => { if (!earthState.ready) fail('the first view did not load within 20 s'); }, 20000);
      // imagery that never arrives (offline with no tile pack, provider down) hands the film to the fallback world
      let s2ok = 0, s2err = 0;
      m.on('sourcedata', ev => { if (ev.sourceId === 's2' && ev.tile) s2ok++; });
      m.on('error', ev => {
        if (++s2err <= 3) console.warn('Open Earth:', ev.error?.message);
      });
      // not one imagery tile after 12 s: the provider (or the network, with no tile pack) is gone
      imageryTimer = window.setTimeout(() => { if (s2ok === 0) fail('satellite imagery is unreachable'); }, 12000);

      const tank: TankerState = { at: road.at(0), heading: road.heading(0), visible: false };
      m.once('load', () => {
        if (disposed) return;
        window.clearTimeout(timer);
        if (!dbg.includes('notank')) m.addLayer(tankerLayer(m, () => tank), 'column');
        if (dbg.includes('nohill')) m.removeLayer('relief');
        if (dbg.includes('nobuild')) m.removeLayer('buildings');
        m.setLight({ anchor: 'map', position: [1.4, SUN_AZ, 90 - SUN_EL], color: '#fff3df', intensity: 0.45 });
        mapBox.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(n => n.classList.remove('maplibregl-compact-show'));
        earthState.ready = true; earthState.mode = 'ready'; earthState.opacity = 1;
        box.style.opacity = '1';
        cb.current.onReady?.({ focusName: j.focus.name, focusDistrict: j.focus.district, focusCrisis: j.focus.crisis, focusPop: j.focus.population,
          depotName: j.depot.name, routeKm: j.route.km, nextName: j.next.name, nextCrisis: j.next.crisis, nextDistrict: j.next.district, asOf: j.generatedAt });
      });
      if (new URLSearchParams(window.location.search).get('debug')?.includes('expose')) Object.assign(window, { __earth: m, __clock: clock });

      // ---- the visitor's own look-around while the shot holds over the streets
      const user = { bearing: 0, pitch: 0 };
      let drag: { x: number; y: number; b: number; p: number; id: number } | null = null;
      const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, b: user.bearing, p: user.pitch, id: e.pointerId }; box.setPointerCapture(e.pointerId); box.style.cursor = 'grabbing'; };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        user.bearing = drag.b - (e.clientX - drag.x) * 0.25;
        user.pitch = clamp(drag.p + (e.clientY - drag.y) * 0.12, -40, 8);
      };
      const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; box.style.cursor = 'grab'; } };
      box.addEventListener('pointerdown', onDown); box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp); box.addEventListener('pointercancel', onUp);

      // ---- per-frame state
      const shot = blank();
      const last: Record<string, number> = {};
      const setPaint = (layer: string, prop: string, v: number, eps = 0.004, value?: unknown) => {
        const k = `${layer}.${prop}`;
        if (last[k] !== undefined && Math.abs(last[k] - v) < eps) return;
        last[k] = v;
        m.setPaintProperty(layer, prop, value ?? v);
      };
      const D2R = Math.PI / 180;
      const sun: [number, number, number] = [Math.sin(SUN_AZ * D2R) * Math.cos(SUN_EL * D2R), Math.cos(SUN_AZ * D2R) * Math.cos(SUN_EL * D2R), Math.sin(SUN_EL * D2R)];
      const cloudAnchors: [[number, number], [number, number]] = [[0, 0], enu(F, N)];
      const topPlaces = [...summary.points].filter(p => p[2] >= 70).sort((a, b) => b[2] - a[2] || b[3] - a[3]).slice(0, 30);
      const lines = Array.from({ length: topPlaces.length }, () => {
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('stroke', '#9be7f6'); l.setAttribute('stroke-width', '1'); l.setAttribute('stroke-linecap', 'round');
        svg.appendChild(l); return l;
      });
      const dots = topPlaces.map(() => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', '2.6'); c.setAttribute('fill', '#ff6b3d'); svg.appendChild(c); return c;
      });
      const deficitTop = summary.rainfall.slice(0, 3).map(r => geo.districts.find(d => d.key === plain(r.district))?.c ?? null);
      let roll = 0, lastP = -1, lastW = 0, lastH = 0, interactive = false, elevT = 0, elevAt: LngLat = [0, 0];
      // dynamic resolution: drop the pixel ratio a step when moving frames run slow, restore it when there is headroom
      const maxPR = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5);
      let pr = maxPR, slowFrames = 0, fastFrames = 0, lastPRChange = 0;
      let lastT = performance.now();

      const placeAnchor = (key: string, pt: [number, number] | null, alpha: number) => {
        const el = anchors.current[key];
        if (!el) return;
        if (!pt || alpha < 0.01) { if (el.style.visibility !== 'hidden') { el.style.visibility = 'hidden'; el.style.opacity = '0'; } return; }
        el.style.transform = `translate3d(${pt[0].toFixed(1)}px, ${pt[1].toFixed(1)}px, 0)`;
        el.style.opacity = alpha.toFixed(3); el.style.visibility = 'visible';
      };
      const projectGround = (ll: LngLat): [number, number] | null => {
        const q = m.project(ll);
        return Number.isFinite(q.x) && Number.isFinite(q.y) ? [q.x, q.y] : null;
      };

      const applyScene = (sc: Scene, p: number) => {
        // low-stress places stay small and quiet; the eye goes to the places in crisis
        setPaint('places', 'circle-opacity', sc.places * 0.95, 0.01);
        setPaint('places-low', 'circle-opacity', sc.places * 0.5, 0.01);
        setPaint('places', 'circle-stroke-opacity', sc.places * 0.8, 0.01);
        setPaint('places-halo', 'circle-opacity', sc.crisis * 0.55);
        setPaint('deficit', 'fill-opacity', sc.deficit * 0.62);
        setPaint('district-lines', 'line-opacity', Math.max(sc.deficit * 0.35, sc.rise * 0.4));
        setPaint('states', 'line-opacity', 0.16 + sc.national * 0.55);
        setPaint('depots', 'circle-opacity', sc.depots); setPaint('depots', 'circle-stroke-opacity', sc.depots);
        setPaint('links', 'line-opacity', sc.depots * 0.8);
        setPaint('links', 'line-gradient', sc.links, 0.01, drawTo(sc.links, '#9be7f6'));
        // the district lifts off the map like a tile, then settles back so the real terrain takes over
        const lift = sc.rise * (1 + 0.06 * Math.sin(Math.PI * clamp((p - 0.3) / 0.05, 0, 1)));
        setPaint('rise', 'fill-extrusion-height', lift * RISE_M, 10);
        setPaint('rise', 'fill-extrusion-opacity', Math.min(1, sc.rise * 1.6) * 0.5, 0.01);
        setPaint('column', 'fill-extrusion-height', sc.column * (j.focus.crisis / 100) * COLUMN_M, 25);
        setPaint('column', 'fill-extrusion-opacity', Math.min(1, sc.column * 2) * 0.92, 0.01);
        setPaint('beacon', 'fill-extrusion-height', sc.next * 70, 1);
        setPaint('route', 'line-opacity', sc.route * 0.95); setPaint('route-glow', 'line-opacity', sc.route * 0.45);
        setPaint('route', 'line-gradient', sc.routeDraw, 0.008, drawTo(sc.routeDraw, '#e9fbff'));
        setPaint('route-glow', 'line-gradient', sc.routeDraw, 0.008, drawTo(sc.routeDraw, '#7fe3f5'));
      };

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
        stepClock(dt);
        if (!earthState.ready) return;
        const p = clock.p;
        const W = box.clientWidth, H = box.clientHeight;
        if (W !== lastW || H !== lastH) {
          lastW = W; lastH = H; deck?.resize(W, H);
          const port = H > W * 1.05;
          if (port !== portrait) { portrait = port; keys = buildKeys(j, road, portrait); }
          lastP = -1;
        }

        // street hold: the visitor can look around; leaving it, the look-around eases back
        const holding = p > HOLD[0] && p < HOLD[1];
        if (holding !== interactive) {
          interactive = holding;
          box.style.pointerEvents = holding ? 'auto' : 'none'; box.style.touchAction = holding ? 'pan-y' : '';
          box.style.cursor = holding ? 'grab' : '';
          if (!holding) drag = null;
        }
        if (!holding && !drag) { const k = 1 - Math.exp(-dt * 3); user.bearing -= user.bearing * k; user.pitch -= user.pitch * k; }

        // banking: lean into turns in proportion to how fast the heading is changing right now
        const rollTarget = reduce ? 0 : clamp(-turnRate(keys, road, p) * clock.v * 0.035, -5, 5);
        roll += (rollTarget - roll) * (1 - Math.exp(-dt * 5));
        const moving = Math.abs(p - lastP) > 1e-7 || Math.abs(roll) > 0.01 || Math.abs(user.bearing) > 0.01 || Math.abs(user.pitch) > 0.01 || drag;
        if (!moving) return;
        lastP = p;
        if (dt > 0.03) { slowFrames++; fastFrames = 0; } else if (dt < 0.012) { fastFrames++; if (fastFrames > 240) slowFrames = 0; }
        if (now - lastPRChange > 4000) {
          if (slowFrames > 20 && pr > 1) { pr = Math.max(1, pr - 0.25); m.setPixelRatio(pr); lastPRChange = now; slowFrames = 0; }
          else if (fastFrames > 600 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.25); m.setPixelRatio(pr); lastPRChange = now; fastFrames = 0; }
        }

        shotAt(keys, road, p, shot);
        const pitch = clamp(shot.pitch + user.pitch, 0, 85), bearing = shot.bearing + user.bearing;
        // the subject makes room for the type: to the right of it on wide screens, below it on tall ones
        const padL = portrait ? 0 : shot.pad * W * 0.5, padT = portrait ? shot.pad * H * 0.5 : 0;
        m.jumpTo({ center: shot.target, zoom: rangeToZoom(shot.range, shot.target[1], H), pitch, bearing, roll, padding: { left: padL, top: padT, right: 0, bottom: 0 } });

        const sc = sceneAt(p);
        if (!dbg.includes('nopaint')) applyScene(sc, p);

        // tanker on the road
        const d = tankerAt(p, road);
        tank.at = road.at(d); tank.heading = road.heading(d, 40); tank.visible = sc.tanker > 0.02;
        groundState.arrived = d > road.length - 180; groundState.stopped = p > 0.6; groundState.delivering = p > 0.606;

        // ---- camera in local metres (for the cloud deck and for points above the ground)
        if (haversine(elevAt, shot.target) > 30) { elevT = m.queryTerrainElevation(shot.target) ?? elevT; elevAt = shot.target; }
        const basis = cameraBasis(bearing, pitch, roll);
        const [tx, ty] = enu(F, shot.target);
        const eye: [number, number, number] = [tx - basis.f[0] * shot.range, ty - basis.f[1] * shot.range, elevT - basis.f[2] * shot.range];
        const tanHalf = Math.tan((FOV * D2R) / 2);
        const shift: [number, number] = [padL / W, -padT / H]; // map padding moves the principal point
        const cloudsOn = clamp((26000 - eye[2]) / 10000, 0, 1); // a cumulus deck is weather seen from the air, not from orbit
        deck?.render({ eye, f: basis.f, r: basis.r, u: basis.u, tanHalf, shift }, cloudAnchors, sun, cloudsOn);
        const projectUp = (ll: LngLat, alt: number): [number, number] | null => {
          const [x, y] = enu(F, ll), v = [x - eye[0], y - eye[1], alt - eye[2]];
          const z = v[0] * basis.f[0] + v[1] * basis.f[1] + v[2] * basis.f[2];
          if (z < 1) return null;
          const sx = (v[0] * basis.r[0] + v[1] * basis.r[1] + v[2] * basis.r[2]) / (z * tanHalf);
          const sy = (v[0] * basis.u[0] + v[1] * basis.u[1] + v[2] * basis.u[2]) / (z * tanHalf);
          return [W / 2 + padL / 2 + (sx * H) / 2, H / 2 + padT / 2 - (sy * H) / 2];
        };

        // ---- labels that live in the world
        const colTop = sc.column * (j.focus.crisis / 100) * COLUMN_M;
        placeAnchor('focus', sc.column > 0.05 ? projectUp(F, elevT + colTop) : null, clamp((sc.column - 0.55) / 0.4, 0, 1));
        const tankPt = sc.tanker > 0.02 ? projectGround(tank.at) : null;
        placeAnchor('truck', tankPt, p < 0.51 ? sc.tanker * (1 - clamp((p - 0.49) / 0.02, 0, 1)) : 0);
        placeAnchor('gtruck', tankPt, p > 0.535 ? sc.tanker : 0);
        deficitTop.forEach((c, i) => placeAnchor(`d${i}`, c && p > 0.6 ? projectGround(c) : null, p > 0.6 ? clamp((sc.deficit - 0.2 - i * 0.15) / 0.5, 0, 1) : 0));

        // ---- the name lying on the plateau: four real ground points, the element warped onto them
        const word = wordEl.current;
        if (word) {
          const [hx, hy] = wordHalf(portrait);
          const corners: LngLat[] = [
            [WORD_CENTER[0] - hx, WORD_CENTER[1] + hy], [WORD_CENTER[0] + hx, WORD_CENTER[1] + hy],
            [WORD_CENTER[0] + hx, WORD_CENTER[1] - hy], [WORD_CENTER[0] - hx, WORD_CENTER[1] - hy],
          ];
          const q = sc.word > 0.01 && corners.every(c => projectUp(c, 600) !== null) ? corners.map(projectGround) : null;
          if (q && q.every(Boolean)) {
            word.style.transform = quadMatrix(WORD_W, WORD_H, q as [number, number][]);
            word.style.opacity = sc.word.toFixed(3); word.style.visibility = 'visible';
          } else if (word.style.visibility !== 'hidden') { word.style.visibility = 'hidden'; word.style.opacity = '0'; }
        }

        // ---- impact: the places with the highest crisis scores feed the numbers
        const panel = anchors.current.impact;
        svg.style.opacity = sc.impact.toFixed(3);
        if (sc.impact > 0.01 && panel) {
          const slots = (Array.from(panel.children) as HTMLElement[]).map(el => el.getBoundingClientRect());
          const draw = clamp((sc.impact - 0.15) / 0.75, 0, 1);
          topPlaces.forEach((pl, i) => {
            const a = projectGround([pl[0], pl[1]]), slot = slots[i % Math.max(1, slots.length)];
            if (!a || !slot) { lines[i].setAttribute('opacity', '0'); dots[i].setAttribute('opacity', '0'); return; }
            const bx = slot.left + 8, by = slot.top + 2;
            lines[i].setAttribute('x1', a[0].toFixed(1)); lines[i].setAttribute('y1', a[1].toFixed(1));
            lines[i].setAttribute('x2', (a[0] + (bx - a[0]) * draw).toFixed(1)); lines[i].setAttribute('y2', (a[1] + (by - a[1]) * draw).toFixed(1));
            lines[i].setAttribute('opacity', (0.5 * sc.impact).toFixed(3));
            dots[i].setAttribute('cx', a[0].toFixed(1)); dots[i].setAttribute('cy', a[1].toFixed(1)); dots[i].setAttribute('opacity', sc.impact.toFixed(3));
          });
        }
      };
      raf = requestAnimationFrame(tick);

      cleanupExtra = () => {
        box.removeEventListener('pointerdown', onDown); box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp); box.removeEventListener('pointercancel', onUp);
      };
    })().catch(e => fail(String(e)));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf); window.clearTimeout(timer); window.clearTimeout(imageryTimer);
      cleanupExtra();
      deck?.dispose(); map?.remove();
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      earthState.ready = false; earthState.opacity = 0; if (earthState.mode !== 'failed') earthState.mode = 'loading';
    };
  }, [geo, summary, quality, reduce, anchors]);

  return (
    <div ref={wrap} className="landing-earth absolute inset-0 opacity-0 transition-opacity duration-[1400ms]" style={{ pointerEvents: 'none' }}
      aria-label="3D Earth: the camera travels over real terrain, imagery and OpenStreetMap buildings">
      {/* MapLibre makes its container position:relative, so it fills the frame by size, not by inset */}
      <div ref={mapEl} className="h-full w-full" />
      <canvas ref={cloudEl} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <svg ref={svgEl} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
      {/* the name, lying on the Deccan plateau (warped onto four real ground points every frame) */}
      <div ref={wordEl} aria-hidden className="pointer-events-none absolute left-0 top-0 flex h-[250px] w-[1300px] origin-top-left items-center justify-center font-display text-[236px] font-semibold leading-none tracking-[0.02em] text-white/90 opacity-0 [font-variation-settings:'wdth'_112] [text-shadow:0_0_40px_rgba(155,231,246,0.35)]"
        style={{ visibility: 'hidden' }}>JalSetu</div>
    </div>
  );
};

export default OpenEarth;
