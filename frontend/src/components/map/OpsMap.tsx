/**
 * Operations map (MapLibre GL).
 *
 * Vehicles are drawn ONLY at their last accepted real GPS fix; there is no interpolation or animation.
 * A marker moves when (and only when) the vehicles prop changes because a new fix arrived.
 *
 * 3D mode adds real terrain (AWS Terrain Tiles / Mapzen terrarium DEM) with hillshade, and extrudes a column
 * over every community whose height encodes its live crisis score.
 */
import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, LngLatBoundsLike, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Box, Layers, Map as MapIcon } from 'lucide-react';
import type { Community, Depot, TrackingState, Vehicle } from '../../types';
import { cx, EASE, Segmented } from '../ui';

// Basemaps (OpenFreeMap, no key). VITE_MAP_STYLE_URL overrides the default colour style.
export const BASEMAPS = {
  colour: { label: 'Colour', url: import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty', dark: false },
  light: { label: 'Light', url: 'https://tiles.openfreemap.org/styles/positron', dark: false },
  dark: { label: 'Dark', url: 'https://tiles.openfreemap.org/styles/dark', dark: true },
} as const;
type Basemap = keyof typeof BASEMAPS;
const pref = <T extends string>(key: string, ok: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(key); if (v && (ok as readonly string[]).includes(v)) return v as T; } catch { /* storage unavailable */ }
  return fallback;
};
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

// Operating area: Maharashtra (communities, depots and crisis signals are imported for this state).
const HOME: LngLatBoundsLike = [[72.6, 15.6], [80.9, 22.1]];
const INDIA: LngLatBoundsLike = [[67.5, 6.0], [97.8, 37.4]];
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const FALLBACK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#efece5' } }] };

export interface MapRoute { id: string; coords: [number, number][]; kind: 'planned' | 'actual' | 'proposal'; highlight?: boolean }
export interface MapVehicle { v: Vehicle; state: TrackingState }

interface Props {
  vehicles: MapVehicle[];
  communities?: Community[];
  depots?: Depot[];
  alerts?: GeoJSON.FeatureCollection | null;
  states?: GeoJSON.FeatureCollection | null;
  districts?: GeoJSON.FeatureCollection | null;
  routes?: MapRoute[];
  geofence?: { lat: number; lng: number; radiusM: number } | null;
  selectedVehicleId?: string | null;
  selectedCommunityId?: string | null;
  onVehicle?: (id: string) => void;
  onCommunity?: (id: string) => void;
  onAlert?: (id: number) => void;
  onState?: (id: number, bbox: number[]) => void;
  onMapClick?: (lat: number, lng: number) => void;
  fit?: { bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null;
  className?: string;
  /** Fly in from India to Maharashtra on first load. */
  cinematic?: boolean;
  /** Show the floating basemap / 3D / layer controls. */
  controls?: boolean;
}

// Palette tuned for light basemaps ("water atlas" tokens).
export const MAP_COLORS = { critical: '#c2361f', high: '#d48806', served: '#16804a', normal: '#0c6e96', depot: '#131f2a' };
const STATE_COLOR: Record<TrackingState, string> = { live: '#169648', stale: '#c68008', offline: '#c82824', no_signal: '#8c96a0' };
const COMMUNITY_COLOR = ['match', ['get', 'status'], 'Critical', MAP_COLORS.critical, 'High Demand', MAP_COLORS.high, 'Recently Served', MAP_COLORS.served, MAP_COLORS.normal];
const SEV_COLOR = ['match', ['get', 'severity'], 'Extreme', '#a8201a', 'Severe', '#cc5422', 'Moderate', '#c4880a', 'Minor', '#2860c8', '#8c96a0'];
const LAYER_GROUPS = {
  crisis: ['communities-crisis', 'communities-pulse'],
  communities: ['communities', 'communities-label'],
  alerts: ['alerts-fill', 'alerts-line'],
  depots: ['depots', 'depots-label'],
  boundaries: ['states-line', 'districts-line'],
} as const;
type LayerGroup = keyof typeof LAYER_GROUPS;
const LAYER_LABEL: Record<LayerGroup, string> = { crisis: 'Crisis glow', communities: 'Communities', alerts: 'Official alerts', depots: 'Depots', boundaries: 'Boundaries' };

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function circle(lat: number, lng: number, radiusM: number): GeoJSON.Feature {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

/** Small square footprint (≈ side metres) used to extrude a 3D column at a point. */
function column(lat: number, lng: number, sideM: number): GeoJSON.Polygon {
  const dLat = sideM / 2 / 111320, dLng = sideM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return { type: 'Polygon', coordinates: [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]] };
}

async function resolveStyle(url: string): Promise<{ style: string | StyleSpecification; labels: boolean }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return { style: url, labels: true };
  } catch { /* fall through */ }
  return { style: FALLBACK_STYLE, labels: false };
}

interface Hover { x: number; y: number; p: Record<string, any> }

export const OpsMap: React.FC<Props> = (p) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [basemapOk, setBasemapOk] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>(() => pref('jalsetu.basemap', ['colour', 'light', 'dark'] as const, 'colour'));
  const [threeD, setThreeD] = useState(() => pref('jalsetu.map3d', ['on', 'off'] as const, 'off') === 'on');
  const [hidden, setHidden] = useState<Set<LayerGroup>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const handlers = useRef(p);
  handlers.current = p;
  const firstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const dark = BASEMAPS[basemap].dark;
    const ink = dark ? { text: '#e6edf6', halo: '#060a11', muted: '#94a3bd', state: '#8a9ab2', district: '#556274' }
      : { text: '#131f2a', halo: '#ffffff', muted: '#3c4a56', state: '#131f2a', district: '#7d8790' };
    setLoading(true);
    resolveStyle(BASEMAPS[basemap].url).then(({ style, labels }) => {
      if (cancelled || !el.current) return;
      setBasemapOk(labels);
      const cinematic = p.cinematic && firstLoad.current && !reduce;
      const m = new maplibregl.Map({ container: el.current, style, bounds: cinematic ? INDIA : HOME, fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true }, maxPitch: 72, dragRotate: false, pitchWithRotate: false, fadeDuration: 200 });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      // 'style.load' fires as soon as the style is parsed (~0.3 s); 'load' waits for every tile and glyph (~10 s).
      // Adding our layers here lets operational data appear immediately while basemap tiles stream in.
      m.once('style.load', () => {
        const src = (id: string) => m.addSource(id, { type: 'geojson', data: empty });
        ['states', 'districts', 'alerts', 'routes', 'geofence', 'communities', 'columns', 'depots', 'vehicles'].forEach(src);
        m.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: Mapzen / AWS Open Data' });
        m.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
          paint: { 'hillshade-shadow-color': '#4a3f2e', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#6b5b45', 'hillshade-exaggeration': 0.45 } });
        m.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { 'fill-color': '#0c6e96', 'fill-opacity': dark ? 0.015 : 0.025 } });
        m.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': ink.state, 'line-width': dark ? 0.8 : 1.2, 'line-opacity': 0.55 } });
        m.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': ink.district, 'line-width': 0.7, 'line-dasharray': [2, 2] } });
        m.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': SEV_COLOR as any, 'fill-opacity': dark ? 0.18 : 0.22 } });
        m.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': SEV_COLOR as any, 'line-width': 1.2, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'routes-planned', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'planned'], layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#0c6e96', 'line-width': ['case', ['get', 'highlight'], 4, 2.5], 'line-dasharray': [2, 1.5], 'line-opacity': ['case', ['get', 'highlight'], 0.95, 0.6] } });
        m.addLayer({ id: 'routes-proposal', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'proposal'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#684cb4', 'line-width': 4, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'routes-actual', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'actual'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#169648', 'line-width': 4.5, 'line-opacity': 0.95 } });
        m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofence', paint: { 'fill-color': '#169648', 'fill-opacity': 0.1 } });
        m.addLayer({ id: 'geofence-line', type: 'line', source: 'geofence', paint: { 'line-color': '#169648', 'line-width': 1.5, 'line-dasharray': [1, 1] } });
        // 3D columns (hidden in 2D): height encodes the live crisis score.
        m.addLayer({ id: 'columns', type: 'fill-extrusion', source: 'columns', layout: { visibility: 'none' },
          paint: { 'fill-extrusion-color': COMMUNITY_COLOR as any, 'fill-extrusion-height': ['+', 600, ['*', ['get', 'crisis'], 260]],
            'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true } });
        // Crisis glow under each community.
        m.addLayer({ id: 'communities-crisis', type: 'circle', source: 'communities', filter: ['>=', ['get', 'crisis'], 20],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 'crisis'], 20, 5, 100, 15], 10, ['interpolate', ['linear'], ['get', 'crisis'], 20, 12, 100, 34]],
            'circle-color': ['interpolate', ['linear'], ['get', 'crisis'], 20, '#e0a020', 60, '#d96a2b', 85, '#c2361f'],
            'circle-opacity': dark ? 0.32 : 0.22, 'circle-blur': 0.75 } });
        m.addLayer({ id: 'communities-pulse', type: 'circle', source: 'communities', filter: ['==', ['get', 'status'], 'Critical'],
          paint: { 'circle-radius': 8, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': MAP_COLORS.critical, 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6 } });
        m.addLayer({ id: 'communities', type: 'circle', source: 'communities',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['==', ['get', 'status'], 'Critical'], 4.5, 3], 9, 6.5, 14, 10],
            'circle-color': COMMUNITY_COLOR as any, 'circle-opacity': 0.95,
            'circle-stroke-color': ['case', ['get', 'selected'], '#131f2a', dark ? '#0b1220' : '#ffffff'], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.2] } });
        m.addLayer({ id: 'depots', type: 'circle', source: 'depots', paint: { 'circle-radius': 7, 'circle-color': MAP_COLORS.depot, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
        m.addLayer({ id: 'vehicles-halo', type: 'circle', source: 'vehicles', filter: ['get', 'selected'], paint: { 'circle-radius': 18, 'circle-color': '#131f2a', 'circle-opacity': 0.08 } });
        m.addLayer({ id: 'vehicles-acc', type: 'circle', source: 'vehicles', filter: ['get', 'selected'],
          paint: { 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, ['/', ['get', 'acc'], 152.87], 20, ['/', ['get', 'acc'], 0.1493]], 'circle-color': '#0c6e96', 'circle-opacity': 0.08, 'circle-stroke-color': '#0c6e96', 'circle-stroke-width': 0.5 } });
        m.addLayer({ id: 'vehicles', type: 'circle', source: 'vehicles',
          paint: { 'circle-radius': ['case', ['get', 'selected'], 9, 7.5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
        if (labels) {
          m.addLayer({ id: 'vehicles-label', type: 'symbol', source: 'vehicles',
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true },
            paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.6 } });
          m.addLayer({ id: 'communities-label', type: 'symbol', source: 'communities', minzoom: 9,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
            paint: { 'text-color': ink.muted, 'text-halo-color': ink.halo, 'text-halo-width': 1.4 } });
          m.addLayer({ id: 'depots-label', type: 'symbol', source: 'depots', minzoom: 7,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
            paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.6 } });
        }
        const click = (layer: string, fn: (f: maplibregl.MapGeoJSONFeature) => void) => {
          m.on('click', layer, e => { e.originalEvent.stopPropagation(); if (e.features?.[0]) fn(e.features[0]); });
          m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
          m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
        };
        click('vehicles', f => handlers.current.onVehicle?.(String(f.properties.id)));
        click('communities', f => handlers.current.onCommunity?.(String(f.properties.id)));
        click('columns', f => handlers.current.onCommunity?.(String(f.properties.id)));
        click('alerts-fill', f => handlers.current.onAlert?.(Number(f.properties.id)));
        click('states-fill', f => handlers.current.onState?.(Number(f.properties.id), JSON.parse(String(f.properties.bbox))));
        const hoverOn = (layer: string) => {
          m.on('mousemove', layer, e => { const f = e.features?.[0]; if (f) setHover({ x: e.point.x, y: e.point.y, p: f.properties as Record<string, any> }); });
          m.on('mouseleave', layer, () => setHover(null));
        };
        hoverOn('communities');
        hoverOn('columns');
        m.on('movestart', () => setHover(null));
        m.on('click', e => {
          const hits = m.queryRenderedFeatures(e.point, { layers: ['vehicles', 'communities', 'alerts-fill'].filter(l => m.getLayer(l)) });
          if (!hits.length) handlers.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng);
        });
        // Breathing ring on critical communities (skipped for reduced motion).
        if (!reduce) {
          const t0 = performance.now();
          const tick = (t: number) => {
            const k = ((t - t0) % 2000) / 2000;
            if (m.getLayer('communities-pulse')) {
              m.setPaintProperty('communities-pulse', 'circle-radius', 6 + k * 16);
              m.setPaintProperty('communities-pulse', 'circle-stroke-opacity', 0.65 * (1 - k));
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }
        setReady(true);
        setLoading(false);
        if (cinematic) setTimeout(() => m.fitBounds(HOME, { padding: 32, duration: 2600, curve: 1.3, essential: false }), 250);
        firstLoad.current = false;
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); setReady(false); map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  const set = (id: string, data: GeoJSON.FeatureCollection) => {
    const s = map.current?.getSource(id) as GeoJSONSource | undefined;
    s?.setData(data);
  };

  // 3D: terrain + hillshade + columns + tilt.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const vis = threeD ? 'visible' : 'none';
    m.setLayoutProperty('hillshade', 'visibility', vis);
    m.setLayoutProperty('columns', 'visibility', vis);
    m.setTerrain(threeD ? { source: 'dem', exaggeration: 1.6 } : null);
    if (threeD) { m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); } else { m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); }
    // Entering 3D frames Maharashtra up close (tilt otherwise pushes the state into the distance).
    const frame = threeD && m.getZoom() < 6.6 ? { center: [76.4, 17.7] as [number, number], zoom: 6.5 } : {};
    m.easeTo({ ...frame, pitch: threeD ? 58 : 0, bearing: threeD ? -14 : 0, duration: reduce ? 0 : 1800, easing: t => 1 - Math.pow(1 - t, 3) });
  }, [ready, threeD, reduce]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (Object.keys(LAYER_GROUPS) as LayerGroup[]).forEach(g => LAYER_GROUPS[g].forEach(l => {
      if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', hidden.has(g) ? 'none' : 'visible');
    }));
    if (m.getLayer('columns')) m.setLayoutProperty('columns', 'visibility', threeD && !hidden.has('communities') ? 'visible' : 'none');
  }, [ready, hidden, threeD]);

  useEffect(() => { if (ready) set('states', p.states || empty); }, [ready, p.states]);
  useEffect(() => { if (ready) set('districts', p.districts || empty); }, [ready, p.districts]);
  useEffect(() => { if (ready) set('alerts', p.alerts || empty); }, [ready, p.alerts]);
  useEffect(() => {
    if (!ready) return;
    set('routes', { type: 'FeatureCollection', features: (p.routes || []).filter(r => r.coords.length > 1).map(r => ({
      type: 'Feature', properties: { id: r.id, kind: r.kind, highlight: !!r.highlight },
      geometry: { type: 'LineString', coordinates: r.coords.map(([lat, lng]) => [lng, lat]) },
    })) });
  }, [ready, p.routes]);
  useEffect(() => { if (ready) set('geofence', p.geofence ? { type: 'FeatureCollection', features: [circle(p.geofence.lat, p.geofence.lng, p.geofence.radiusM)] } : empty); }, [ready, p.geofence]);
  useEffect(() => {
    if (!ready) return;
    const comms = p.communities || [];
    const props = (c: Community) => ({ id: c.id, name: c.name, status: c.status, origin: c.dataOrigin, crisis: c.crisisScore ?? 0,
      district: c.districtName ?? '', pop: c.population, shortfall: c.shortfall, priority: c.priorityScore, kind: c.settlementType ?? '',
      selected: c.id === p.selectedCommunityId });
    set('communities', { type: 'FeatureCollection', features: comms.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: props(c) })) });
    set('columns', { type: 'FeatureCollection', features: comms.map(c => ({ type: 'Feature', geometry: column(c.lat, c.lng, 4200), properties: props(c) })) });
  }, [ready, p.communities, p.selectedCommunityId]);
  useEffect(() => {
    if (!ready) return;
    set('depots', { type: 'FeatureCollection', features: (p.depots || []).map(d => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] }, properties: { id: d.id, name: d.name } })) });
  }, [ready, p.depots]);
  useEffect(() => {
    if (!ready) return;
    set('vehicles', { type: 'FeatureCollection', features: p.vehicles.filter(x => x.v.position).map(({ v, state }) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [v.position!.lng, v.position!.lat] },
      properties: { id: v.vehicleId, label: `${v.registration} · ${state === 'live' ? 'LIVE' : state === 'stale' ? 'STALE' : 'OFFLINE'}`,
        color: STATE_COLOR[state], selected: v.vehicleId === p.selectedVehicleId, acc: v.position!.accuracyM || 0 } })) });
  }, [ready, p.vehicles, p.selectedVehicleId]);
  useEffect(() => {
    if (!ready || !p.fit || !map.current) return;
    const opts = { duration: reduce ? 0 : 1200, essential: false };
    if (p.fit.bbox) map.current.fitBounds([[p.fit.bbox[0], p.fit.bbox[1]], [p.fit.bbox[2], p.fit.bbox[3]]], { padding: 48, maxZoom: 15, ...opts });
    else if (p.fit.center) map.current.flyTo({ center: [p.fit.center[1], p.fit.center[0]], zoom: p.fit.zoom ?? 14, ...opts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.fit?.key]);

  const toggleLayer = (g: LayerGroup) => setHidden(h => { const n = new Set(h); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const pick3d = (on: boolean) => { setThreeD(on); save('jalsetu.map3d', on ? 'on' : 'off'); };
  const pickBasemap = (b: Basemap) => { setBasemap(b); save('jalsetu.basemap', b); };
  const showControls = p.controls !== false;
  const hp = hover?.p;

  return (
    <div className={p.className || 'relative h-full w-full'}>
      <div ref={el} className="absolute inset-0 h-full w-full" />

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden bg-[#efece5]">
            <motion.div className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent" animate={{ x: ['-100%', '250%'] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
            <p className="absolute inset-x-0 bottom-6 text-center text-xs text-cc-muted">Loading basemap…</p>
          </motion.div>
        )}
      </AnimatePresence>

      {!basemapOk && (
        <div className="absolute left-3 top-14 z-10 rounded-lg border border-cc-warn/30 bg-cc-surface/95 px-2.5 py-1.5 text-[11px] text-amber-800 shadow-panel">
          Basemap tiles unavailable. Operational layers are still accurate.
        </div>
      )}

      {showControls && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <div className="rounded-full border border-cc-border bg-cc-surface/90 p-0.5 shadow-panel backdrop-blur">
            <Segmented value={basemap} onChange={id => pickBasemap(id as Basemap)} className="!bg-transparent"
              options={(Object.keys(BASEMAPS) as Basemap[]).map(b => ({ id: b, label: BASEMAPS[b].label }))} />
          </div>
          <button onClick={() => pick3d(!threeD)} aria-pressed={threeD} title={threeD ? 'Back to flat map' : 'Tilt into 3D terrain; columns show crisis strength'}
            className={cx('flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-panel backdrop-blur transition-colors',
              threeD ? 'border-cc-text bg-cc-text text-white' : 'border-cc-border bg-cc-surface/90 text-cc-text hover:border-cc-strong')}>
            {threeD ? <MapIcon className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}{threeD ? '2D' : '3D'}
          </button>
          <div className="relative">
            <button onClick={() => setLayersOpen(o => !o)} aria-expanded={layersOpen} title="Layers"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-cc-border bg-cc-surface/90 text-cc-text shadow-panel backdrop-blur hover:border-cc-strong">
              <Layers className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {layersOpen && (
                <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: EASE }} style={{ transformOrigin: 'top right' }}
                  className="absolute right-0 mt-2 w-48 rounded-2xl border border-cc-border bg-cc-surface p-1.5 shadow-pop">
                  {(Object.keys(LAYER_GROUPS) as LayerGroup[]).map(g => (
                    <label key={g} className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-cc-hover">
                      {LAYER_LABEL[g]}
                      <input type="checkbox" checked={!hidden.has(g)} onChange={() => toggleLayer(g)} className="h-3.5 w-3.5 accent-[#0c6e96]" />
                    </label>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <AnimatePresence>
        {hp && hover && (
          <motion.div key="hover" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-20 w-60 rounded-xl border border-cc-border bg-cc-surface/95 p-3 shadow-pop backdrop-blur"
            style={{ left: Math.min(hover.x + 14, (el.current?.clientWidth ?? 600) - 250), top: Math.max(8, hover.y - 20) }}>
            <p className="truncate text-sm font-semibold">{hp.name}</p>
            <p className="truncate text-[11px] capitalize text-cc-muted">{[hp.kind, hp.district && `${hp.district} district`].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
              <span className="text-cc-muted">Status</span><span className="text-right font-medium" style={{ color: hp.status === 'Critical' ? MAP_COLORS.critical : hp.status === 'High Demand' ? '#9a6200' : undefined }}>{hp.status}</span>
              <span className="text-cc-muted">Crisis signals</span><span className="num text-right font-medium">{Math.round(Number(hp.crisis))}/100</span>
              <span className="text-cc-muted">Population</span><span className="num text-right">{Number(hp.pop).toLocaleString('en-IN')}</span>
              <span className="text-cc-muted">Shortfall</span><span className="num text-right">{Number(hp.shortfall).toLocaleString('en-IN')} L/d</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-cc-hover"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Number(hp.crisis))}%`, background: Number(hp.crisis) >= 70 ? MAP_COLORS.critical : Number(hp.crisis) >= 30 ? MAP_COLORS.high : MAP_COLORS.normal }} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
