/**
 * Operations map (MapLibre GL): the main working surface of the control room.
 *
 * Truth rules
 *  - A vehicle is drawn ONLY at its last accepted real GPS fix. When a new fix arrives the marker glides from the
 *    previous real fix to the new one (<= 900 ms); nothing is extrapolated or predicted, and when fixes stop the
 *    marker stops. Stale and offline vehicles change shape, not just colour.
 *  - Communities cluster at state zoom (counts + how many are critical); clicking a cluster drills in.
 *  - Drill-down: India -> state -> district -> place, each a camera move with a breadcrumb.
 *
 * 3D mode adds real terrain (AWS Terrain Tiles / Mapzen terrarium DEM) with hillshade and extrudes a column over
 * every community whose height encodes its live crisis score.
 */
import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, LngLatBoundsLike, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Box, Layers, Map as MapIcon } from '../icons';
import type { Community, Depot, TrackingState, Vehicle } from '../../types';
import { cx, Segmented } from '../ui';
import { DUR, EASE_OUT } from '../../motion';
import { useTheme } from '../../theme';

export const BASEMAPS = {
  auto: { label: 'Map', url: '', dark: false },
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

const HOME: LngLatBoundsLike = [[72.6, 15.6], [80.9, 22.1]];
const INDIA: LngLatBoundsLike = [[67.5, 6.0], [97.8, 37.4]];
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const fallbackStyle = (dark: boolean): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#0b1218' : '#e9edf0' } }] });

export interface MapRoute { id: string; coords: [number, number][]; kind: 'planned' | 'actual' | 'proposal'; highlight?: boolean }
export interface MapVehicle { v: Vehicle; state: TrackingState; age?: number | null }
export interface MapPadding { top?: number; right?: number; bottom?: number; left?: number }

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
  selectedAlertId?: number | null;
  onVehicle?: (id: string) => void;
  onCommunity?: (id: string) => void;
  onAlert?: (id: number) => void;
  onState?: (id: number, bbox: number[]) => void;
  onDistrict?: (id: number, name: string, bbox: number[]) => void;
  onMapClick?: (lat: number, lng: number) => void;
  fit?: { bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null;
  /** Screen space covered by overlays (side rails, headers): the camera keeps targets out from under them. */
  padding?: MapPadding;
  className?: string;
  cinematic?: boolean;
  controls?: boolean;
  /** Where the floating controls sit (to clear page overlays). */
  controlsClassName?: string;
  /** Cluster communities at low zoom (state view). */
  cluster?: boolean;
}

// Map colours resolve from the theme tokens at style load (MapLibre needs literal colours).
const css = (name: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')})`;
export const MAP_COLORS = { critical: '#c2361f', high: '#c98706', served: '#16804a', normal: '#0a6896', depot: '#0c1822' };
const SEV_COLOR = ['match', ['get', 'severity'], 'Extreme', '#a01e1a', 'Severe', '#c44e20', 'Moderate', '#b47c06', 'Minor', '#2462c4', '#808c96'];
const LAYER_GROUPS = {
  crisis: ['communities-crisis', 'clusters-crisis'],
  communities: ['communities', 'communities-label', 'clusters', 'clusters-count'],
  alerts: ['alerts-fill', 'alerts-line'],
  depots: ['depots', 'depots-label'],
  boundaries: ['states-line', 'districts-line'],
} as const;
type LayerGroup = keyof typeof LAYER_GROUPS;
const LAYER_LABEL: Record<LayerGroup, string> = { crisis: 'Crisis glow', communities: 'Places', alerts: 'Official alerts', depots: 'Depots', boundaries: 'Boundaries' };

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

function column(lat: number, lng: number, sideM: number): GeoJSON.Polygon {
  const dLat = sideM / 2 / 111320, dLng = sideM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return { type: 'Polygon', coordinates: [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]] };
}

async function resolveStyle(url: string, dark: boolean): Promise<{ style: string | StyleSpecification; labels: boolean }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return { style: url, labels: true };
  } catch { /* fall through */ }
  return { style: fallbackStyle(dark), labels: false };
}

/** Quiet the basemap so operational layers carry the colour: neutral land, tinted water, softer roads. */
function tuneBasemap(m: MLMap, dark: boolean, kind: Basemap) {
  if (kind === 'colour') return;
  const land = dark ? '#0b1218' : '#e9edf0', water = dark ? '#0d2231' : '#c9dde8';
  for (const l of m.getStyle().layers || []) {
    try {
      if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', land);
      else if (l.type === 'fill' && /water|ocean|lake|river/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', water);
      else if (l.type === 'line' && /waterway|river/.test(l.id)) m.setPaintProperty(l.id, 'line-color', water);
      else if (l.type === 'fill' && /landcover|landuse|park|wood|grass/.test(l.id)) m.setPaintProperty(l.id, 'fill-opacity', dark ? 0.25 : 0.35);
    } catch { /* layer without that paint property */ }
  }
}

interface Hover { x: number; y: number; p: Record<string, any>; kind: 'community' | 'cluster' | 'district' }

type MarkerRec = { marker: maplibregl.Marker; el: HTMLDivElement; at: [number, number]; raf: number };

export const OpsMap: React.FC<Props> = (p) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const reduce = useReducedMotion();
  const { mode } = useTheme();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [basemapOk, setBasemapOk] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>(() => pref('jalsetu.basemap2', ['auto', 'colour', 'light', 'dark'] as const, 'auto'));
  const [threeD, setThreeD] = useState(() => pref('jalsetu.map3d', ['on', 'off'] as const, 'off') === 'on');
  const [hidden, setHidden] = useState<Set<LayerGroup>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const handlers = useRef(p);
  handlers.current = p;
  const firstLoad = useRef(true);
  const markers = useRef(new Map<string, MarkerRec>());
  const pad = useRef(p.padding);
  pad.current = p.padding;
  const effectiveDark = basemap === 'auto' ? mode === 'dark' : BASEMAPS[basemap].dark;
  const styleUrl = basemap === 'auto' ? (mode === 'dark' ? BASEMAPS.dark.url : BASEMAPS.light.url) : BASEMAPS[basemap].url;
  const padding = (extra = 40) => ({ top: (pad.current?.top ?? 0) + extra, right: (pad.current?.right ?? 0) + extra, bottom: (pad.current?.bottom ?? 0) + extra, left: (pad.current?.left ?? 0) + extra });

  // ---------------------------------------------------------------- map + layers (rebuilt when the basemap changes)
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const dark = effectiveDark;
    const ink = dark ? { text: '#e2e9ef', halo: '#080d12', muted: '#98a7b4', state: '#7f93a6', district: '#4f6172' }
      : { text: '#0c1822', halo: '#fcfdfd', muted: '#485866', state: '#0c1822', district: '#8796a2' };
    const accent = css('cc-accent');
    setLoading(true);
    resolveStyle(styleUrl, dark).then(({ style, labels }) => {
      if (cancelled || !el.current) return;
      setBasemapOk(labels);
      const cinematic = p.cinematic && firstLoad.current && !reduce;
      const m = new maplibregl.Map({ container: el.current, style, bounds: cinematic ? INDIA : HOME, fitBoundsOptions: { padding: padding(24) },
        attributionControl: { compact: true }, maxPitch: 72, dragRotate: false, pitchWithRotate: false, fadeDuration: 250 });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      m.once('style.load', () => {
        tuneBasemap(m, dark, basemap === 'auto' ? (dark ? 'dark' : 'light') : basemap);
        const src = (id: string, extra: Record<string, unknown> = {}) => m.addSource(id, { type: 'geojson', data: empty, ...extra } as any);
        ['states', 'districts', 'alerts', 'routes', 'geofence', 'columns', 'depots', 'vehicles'].forEach(id => src(id));
        src('route-focus', { lineMetrics: true });
        src('communities', p.cluster ? {
          cluster: true, clusterMaxZoom: 7, clusterRadius: 38,
          clusterProperties: {
            critical: ['+', ['case', ['==', ['get', 'status'], 'Critical'], 1, 0]],
            high: ['+', ['case', ['==', ['get', 'status'], 'High Demand'], 1, 0]],
            maxCrisis: ['max', ['get', 'crisis']],
          },
        } : {});
        m.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: Mapzen / AWS Open Data' });
        m.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
          paint: { 'hillshade-shadow-color': dark ? '#000000' : '#3a4650', 'hillshade-highlight-color': dark ? '#2a3a48' : '#ffffff', 'hillshade-accent-color': '#55636e', 'hillshade-exaggeration': 0.4 } });
        m.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { 'fill-color': accent, 'fill-opacity': dark ? 0.02 : 0.03 } });
        m.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': ink.state, 'line-width': dark ? 0.9 : 1.2, 'line-opacity': 0.5 } });
        m.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', paint: { 'fill-color': accent, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.08, 0] } });
        m.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': ink.district, 'line-width': 0.8, 'line-dasharray': [2, 2] } });
        m.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': SEV_COLOR as any, 'fill-opacity': ['case', ['==', ['get', 'id'], -1], 0.4, dark ? 0.16 : 0.2] } });
        m.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': SEV_COLOR as any, 'line-width': 1.2, 'line-opacity': 0.85 } });
        m.addLayer({ id: 'routes-planned', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'planned'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': accent, 'line-width': ['case', ['get', 'highlight'], 0, 2.2], 'line-dasharray': [2, 1.6], 'line-opacity': 0.55 } });
        m.addLayer({ id: 'routes-proposal', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'proposal'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#624ea8', 'line-width': 4, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'routes-actual', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'actual'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': css('cc-live'), 'line-width': 4.5, 'line-opacity': 0.95 } });
        // The selected route draws itself from depot to destination (line-progress gradient, see the effect below).
        m.addLayer({ id: 'route-focus-casing', type: 'line', source: 'route-focus', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': dark ? '#080d12' : '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'route-focus', type: 'line', source: 'route-focus', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 4, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, accent, 1, accent] as any } });
        m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofence', paint: { 'fill-color': css('cc-live'), 'fill-opacity': 0.1 } });
        m.addLayer({ id: 'geofence-line', type: 'line', source: 'geofence', paint: { 'line-color': css('cc-live'), 'line-width': 1.5, 'line-dasharray': [1, 1] } });
        m.addLayer({ id: 'columns', type: 'fill-extrusion', source: 'columns', layout: { visibility: 'none' },
          paint: { 'fill-extrusion-color': ['match', ['get', 'status'], 'Critical', MAP_COLORS.critical, 'High Demand', MAP_COLORS.high, 'Recently Served', MAP_COLORS.served, MAP_COLORS.normal] as any,
            'fill-extrusion-height': ['+', 600, ['*', ['get', 'crisis'], 260]], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true } });
        const point: any = ['!', ['has', 'point_count']];
        const sel: any = ['boolean', ['get', 'selected'], false];
        const anySel: any = ['boolean', ['get', 'anySelected'], false];
        m.addLayer({ id: 'communities-crisis', type: 'circle', source: 'communities', filter: ['all', point, ['>=', ['get', 'crisis'], 20]] as any,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 'crisis'], 20, 5, 100, 15], 10, ['interpolate', ['linear'], ['get', 'crisis'], 20, 12, 100, 34]],
            'circle-color': ['interpolate', ['linear'], ['get', 'crisis'], 20, '#e0a020', 60, '#d96a2b', 85, '#c2361f'],
            'circle-opacity': ['case', anySel, 0.08, dark ? 0.3 : 0.2], 'circle-blur': 0.75 } });
        m.addLayer({ id: 'clusters-crisis', type: 'circle', source: 'communities', filter: ['has', 'point_count'],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 16, 60, 34], 'circle-blur': 0.8,
            'circle-color': ['interpolate', ['linear'], ['get', 'maxCrisis'], 0, 'rgba(0,0,0,0)', 30, '#e0a020', 70, '#c2361f'], 'circle-opacity': dark ? 0.35 : 0.25 } });
        m.addLayer({ id: 'clusters', type: 'circle', source: 'communities', filter: ['has', 'point_count'],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 11, 25, 16, 120, 22],
            'circle-color': dark ? '#0e151c' : '#fcfdfd',
            'circle-stroke-color': ['case', ['>', ['get', 'critical'], 0], MAP_COLORS.critical, ['>', ['get', 'high'], 0], MAP_COLORS.high, MAP_COLORS.normal],
            'circle-stroke-width': ['case', ['>', ['get', 'critical'], 0], 3, 2] } });
        m.addLayer({ id: 'communities', type: 'circle', source: 'communities', filter: point as any,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', sel, 8, ['==', ['get', 'status'], 'Critical'], 4.5, 3], 9, ['case', sel, 10, 6.5], 14, ['case', sel, 13, 10]],
            'circle-color': ['match', ['get', 'status'], 'Critical', MAP_COLORS.critical, 'High Demand', MAP_COLORS.high, 'Recently Served', MAP_COLORS.served, MAP_COLORS.normal] as any,
            'circle-opacity': ['case', sel, 1, anySel, 0.35, 0.95],
            'circle-stroke-color': ['case', sel, dark ? '#ffffff' : '#0c1822', dark ? '#080d12' : '#ffffff'], 'circle-stroke-width': ['case', sel, 3, 1.2],
            'circle-radius-transition': { duration: 300 }, 'circle-opacity-transition': { duration: 300 } } as any });
        m.addLayer({ id: 'depots', type: 'circle', source: 'depots',
          paint: { 'circle-radius': 6.5, 'circle-color': dark ? '#e2e9ef' : MAP_COLORS.depot, 'circle-stroke-color': dark ? '#080d12' : '#ffffff', 'circle-stroke-width': 2.5 } });
        m.addLayer({ id: 'vehicles-acc', type: 'circle', source: 'vehicles', filter: ['get', 'selected'],
          paint: { 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, ['/', ['get', 'acc'], 152.87], 20, ['/', ['get', 'acc'], 0.1493]],
            'circle-color': accent, 'circle-opacity': 0.08, 'circle-stroke-color': accent, 'circle-stroke-width': 0.6 } });
        if (labels) {
          m.addLayer({ id: 'clusters-count', type: 'symbol', source: 'communities', filter: ['has', 'point_count'],
            layout: { 'text-field': ['to-string', ['get', 'point_count']], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
            paint: { 'text-color': ink.text } });
          m.addLayer({ id: 'communities-label', type: 'symbol', source: 'communities', minzoom: 8.5, filter: point as any,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
            paint: { 'text-color': ink.muted, 'text-halo-color': ink.halo, 'text-halo-width': 1.4 } });
          m.addLayer({ id: 'depots-label', type: 'symbol', source: 'depots', minzoom: 7,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
            paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.6 } });
        }
        const click = (layer: string, fn: (f: maplibregl.MapGeoJSONFeature, e: maplibregl.MapLayerMouseEvent) => void) => {
          m.on('click', layer, e => { e.originalEvent.stopPropagation(); if (e.features?.[0]) fn(e.features[0], e); });
          m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
          m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
        };
        click('communities', f => handlers.current.onCommunity?.(String(f.properties.id)));
        click('columns', f => handlers.current.onCommunity?.(String(f.properties.id)));
        click('clusters', async f => {
          const s = m.getSource('communities') as GeoJSONSource;
          const z = await s.getClusterExpansionZoom(Number(f.properties.cluster_id));
          m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.3, duration: reduce ? 0 : 900, easing: t => 1 - Math.pow(1 - t, 3) });
        });
        click('alerts-fill', f => handlers.current.onAlert?.(Number(f.properties.realId ?? f.properties.id)));
        click('states-fill', f => handlers.current.onState?.(Number(f.properties.id), JSON.parse(String(f.properties.bbox))));
        click('districts-fill', f => handlers.current.onDistrict?.(Number(f.properties.id), String(f.properties.name), JSON.parse(String(f.properties.bbox))));
        const hoverOn = (layer: string, kind: Hover['kind']) => {
          m.on('mousemove', layer, e => { const f = e.features?.[0]; if (f) setHover({ x: e.point.x, y: e.point.y, p: f.properties as Record<string, any>, kind }); });
          m.on('mouseleave', layer, () => setHover(null));
        };
        hoverOn('communities', 'community');
        hoverOn('columns', 'community');
        hoverOn('clusters', 'cluster');
        let hoveredDistrict: number | string | null = null;
        m.on('mousemove', 'districts-fill', e => {
          const f = e.features?.[0];
          if (!f || f.id === hoveredDistrict) return;
          if (hoveredDistrict != null) m.setFeatureState({ source: 'districts', id: hoveredDistrict }, { hover: false });
          hoveredDistrict = f.id ?? null;
          if (hoveredDistrict != null) m.setFeatureState({ source: 'districts', id: hoveredDistrict }, { hover: true });
        });
        m.on('mouseleave', 'districts-fill', () => { if (hoveredDistrict != null) m.setFeatureState({ source: 'districts', id: hoveredDistrict }, { hover: false }); hoveredDistrict = null; });
        m.on('movestart', () => setHover(null));
        m.on('click', e => {
          const hits = m.queryRenderedFeatures(e.point, { layers: ['communities', 'clusters', 'alerts-fill'].filter(l => m.getLayer(l)) });
          if (!hits.length) handlers.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng);
        });
        setReady(true);
        setLoading(false);
        if (cinematic) setTimeout(() => m.fitBounds(HOME, { padding: padding(24), duration: 2400, curve: 1.3, essential: false }), 250);
        firstLoad.current = false;
      });
    });
    const mk = markers.current;
    return () => {
      cancelled = true; cancelAnimationFrame(raf);
      mk.forEach(r => { cancelAnimationFrame(r.raf); r.marker.remove(); });
      mk.clear();
      setReady(false); map.current?.remove(); map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, basemap, effectiveDark]);

  const set = (id: string, data: GeoJSON.FeatureCollection) => {
    const s = map.current?.getSource(id) as GeoJSONSource | undefined;
    s?.setData(data);
  };

  // ---------------------------------------------------------------- 3D
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const vis = threeD ? 'visible' : 'none';
    m.setLayoutProperty('hillshade', 'visibility', vis);
    m.setLayoutProperty('columns', 'visibility', vis);
    m.setTerrain(threeD ? { source: 'dem', exaggeration: 1.6 } : null);
    if (threeD) { m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); } else { m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); }
    const frame = threeD && m.getZoom() < 6.6 ? { center: [76.4, 17.7] as [number, number], zoom: 6.5 } : {};
    m.easeTo({ ...frame, pitch: threeD ? 58 : 0, bearing: threeD ? -14 : 0, duration: reduce ? 0 : 1600, easing: t => 1 - Math.pow(1 - t, 3) });
  }, [ready, threeD, reduce]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (Object.keys(LAYER_GROUPS) as LayerGroup[]).forEach(g => LAYER_GROUPS[g].forEach(l => {
      if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', hidden.has(g) ? 'none' : 'visible');
    }));
    if (m.getLayer('columns')) m.setLayoutProperty('columns', 'visibility', threeD && !hidden.has('communities') ? 'visible' : 'none');
  }, [ready, hidden, threeD]);

  // ---------------------------------------------------------------- data
  useEffect(() => { if (ready) set('states', p.states || empty); }, [ready, p.states]);
  useEffect(() => { if (ready) set('districts', p.districts || empty); }, [ready, p.districts]);
  useEffect(() => {
    if (!ready) return;
    const fc = p.alerts || empty;
    set('alerts', { ...fc, features: fc.features.map(f => ({ ...f, properties: { ...(f.properties || {}), id: (f.properties as any)?.id === p.selectedAlertId ? -1 : (f.properties as any)?.id, realId: (f.properties as any)?.id } })) });
  }, [ready, p.alerts, p.selectedAlertId]);
  useEffect(() => {
    if (!ready) return;
    set('routes', { type: 'FeatureCollection', features: (p.routes || []).filter(r => r.coords.length > 1).map(r => ({
      type: 'Feature', properties: { id: r.id, kind: r.kind, highlight: !!r.highlight },
      geometry: { type: 'LineString', coordinates: r.coords.map(([lat, lng]) => [lng, lat]) },
    })) });
  }, [ready, p.routes]);

  // Selected route draws itself (line-progress reveal) so the eye follows depot -> destination.
  const focusRoute = (p.routes || []).find(r => r.highlight && r.coords.length > 1);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    set('route-focus', focusRoute ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: focusRoute.coords.map(([lat, lng]) => [lng, lat]) } }] } : empty);
    if (!focusRoute) return;
    const color = css('cc-accent');
    const paint = (t: number) => {
      const k = Math.max(0.0001, Math.min(1, t));
      m.setPaintProperty('route-focus', 'line-gradient', k >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color]
        : ['step', ['line-progress'], color, k, 'rgba(0,0,0,0)'] as any);
    };
    if (reduce) { paint(1); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 1100); paint(1 - Math.pow(1 - k, 3)); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusRoute?.id, focusRoute?.coords.length, reduce]);

  useEffect(() => { if (ready) set('geofence', p.geofence ? { type: 'FeatureCollection', features: [circle(p.geofence.lat, p.geofence.lng, p.geofence.radiusM)] } : empty); }, [ready, p.geofence]);
  useEffect(() => {
    if (!ready) return;
    const comms = p.communities || [];
    const anySelected = !!p.selectedCommunityId;
    const props = (c: Community) => ({ id: c.id, name: c.name, status: c.status, origin: c.dataOrigin, crisis: c.crisisScore ?? 0,
      district: c.districtName ?? '', pop: c.population, shortfall: c.shortfall, priority: c.priorityScore, kind: c.settlementType ?? '',
      selected: c.id === p.selectedCommunityId, anySelected });
    set('communities', { type: 'FeatureCollection', features: comms.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: props(c) })) });
    set('columns', { type: 'FeatureCollection', features: comms.map(c => ({ type: 'Feature', geometry: column(c.lat, c.lng, 4200), properties: props(c) })) });
  }, [ready, p.communities, p.selectedCommunityId]);
  useEffect(() => {
    if (!ready) return;
    set('depots', { type: 'FeatureCollection', features: (p.depots || []).map(d => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] }, properties: { id: d.id, name: d.name } })) });
  }, [ready, p.depots]);

  // ---------------------------------------------------------------- vehicles: HTML markers that glide between real fixes
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    set('vehicles', { type: 'FeatureCollection', features: p.vehicles.filter(x => x.v.position).map(({ v }) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [v.position!.lng, v.position!.lat] },
      properties: { id: v.vehicleId, selected: v.vehicleId === p.selectedVehicleId, acc: v.position!.accuracyM || 0 } })) });
    const seen = new Set<string>();
    const anySel = !!p.selectedVehicleId;
    for (const { v, state, age } of p.vehicles) {
      if (!v.position) continue;
      seen.add(v.vehicleId);
      const target: [number, number] = [v.position.lng, v.position.lat];
      let rec = markers.current.get(v.vehicleId);
      if (!rec) {
        const node = document.createElement('div');
        node.className = 'vm';
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        node.innerHTML = '<span class="vm-ring"></span><span class="vm-head"></span><span class="vm-dot"></span><span class="vm-label"></span>';
        node.addEventListener('click', e => { e.stopPropagation(); handlers.current.onVehicle?.(node.dataset.id!); });
        node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.current.onVehicle?.(node.dataset.id!); } });
        const marker = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat(target).addTo(m);
        rec = { marker, el: node, at: target, raf: 0 };
        markers.current.set(v.vehicleId, rec);
      }
      const node = rec.el;
      const moving = state === 'live' && (v.position.speedKmh ?? 0) >= 3 && v.position.heading != null;
      node.dataset.id = v.vehicleId;
      node.dataset.state = state;
      node.dataset.moving = moving ? '1' : '0';
      node.dataset.selected = v.vehicleId === p.selectedVehicleId ? '1' : '0';
      node.dataset.dim = anySel && v.vehicleId !== p.selectedVehicleId ? '1' : '0';
      node.style.zIndex = v.vehicleId === p.selectedVehicleId ? '3' : state === 'live' ? '2' : '1';
      const head = node.querySelector('.vm-head') as HTMLElement;
      head.style.transform = `rotate(${v.position.heading ?? 0}deg)`;
      const ageTxt = age != null ? (age < 60 ? `${Math.round(age)}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`) : '';
      const label = node.querySelector('.vm-label') as HTMLElement;
      label.innerHTML = `${v.registration}<b>${state === 'live' ? 'LIVE' : state === 'stale' ? 'STALE' : 'OFFLINE'}${ageTxt ? ' ' + ageTxt : ''}</b>`;
      node.setAttribute('aria-label', `${v.registration}, ${state}${ageTxt ? `, last fix ${ageTxt} ago` : ''}${v.trip ? `, trip ${v.trip.id} to ${v.trip.destination ?? ''}` : ''}`);
      // Glide from the previously drawn real fix to the new one. Never beyond it.
      if (rec.at[0] !== target[0] || rec.at[1] !== target[1]) {
        cancelAnimationFrame(rec.raf);
        const from = rec.at, r = rec;
        r.at = target;
        if (reduce) { r.marker.setLngLat(target); continue; }
        const t0 = performance.now(), dur = 900;
        const tick = (t: number) => {
          const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          r.marker.setLngLat([from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e]);
          if (k < 1) r.raf = requestAnimationFrame(tick);
        };
        r.raf = requestAnimationFrame(tick);
      }
    }
    for (const [id, r] of markers.current) {
      if (!seen.has(id)) { cancelAnimationFrame(r.raf); r.marker.remove(); markers.current.delete(id); }
    }
  }, [ready, p.vehicles, p.selectedVehicleId, reduce]);

  // ---------------------------------------------------------------- camera
  useEffect(() => {
    if (!ready || !p.fit || !map.current) return;
    const opts = { duration: reduce ? 0 : DUR.map * 1000, essential: false, padding: padding() };
    if (p.fit.bbox) map.current.fitBounds([[p.fit.bbox[0], p.fit.bbox[1]], [p.fit.bbox[2], p.fit.bbox[3]]], { maxZoom: 15, ...opts });
    else if (p.fit.center) map.current.flyTo({ center: [p.fit.center[1], p.fit.center[0]], zoom: p.fit.zoom ?? 14, curve: 1.42, ...opts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.fit?.key]);

  const toggleLayer = (g: LayerGroup) => setHidden(h => { const n = new Set(h); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const pick3d = (on: boolean) => { setThreeD(on); save('jalsetu.map3d', on ? 'on' : 'off'); };
  const pickBasemap = (b: Basemap) => { setBasemap(b); save('jalsetu.basemap2', b); };
  const showControls = p.controls !== false;
  const hp = hover?.p;

  return (
    <div className={p.className || 'relative h-full w-full'}>
      <div ref={el} className="absolute inset-0 h-full w-full" role="region" aria-label="Operations map" />

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.slow }} className="shimmer pointer-events-none absolute inset-0 z-map overflow-hidden bg-cc-sunken">
            <p className="absolute inset-x-0 bottom-8 text-center text-[12px] text-cc-muted">Loading basemap</p>
          </motion.div>
        )}
      </AnimatePresence>

      {!basemapOk && (
        <div className="absolute bottom-10 left-3 z-overlay rounded-control border border-cc-warn/30 bg-cc-surface/95 px-2.5 py-1.5 text-[11.5px] text-amber-800 shadow-panel">
          Basemap tiles unavailable. Operational layers are still accurate.
        </div>
      )}

      {showControls && (
        <div className={cx('absolute right-3 top-3 z-overlay flex items-center gap-2', p.controlsClassName)}>
          <div className="glass rounded-control p-0.5">
            <Segmented label="Basemap" value={basemap} onChange={id => pickBasemap(id as Basemap)} className="!bg-transparent"
              options={(Object.keys(BASEMAPS) as Basemap[]).map(b => ({ id: b, label: BASEMAPS[b].label }))} />
          </div>
          <button onClick={() => pick3d(!threeD)} aria-pressed={threeD} title={threeD ? 'Back to flat map' : 'Tilt into 3D terrain; columns show crisis strength'}
            className={cx('flex h-9 items-center gap-1.5 rounded-control px-3 text-[12.5px] font-semibold transition-colors duration-150',
              threeD ? 'bg-cc-ink text-cc-on-ink shadow-float' : 'glass text-cc-text hover:border-cc-strong')}>
            {threeD ? <MapIcon className="h-4 w-4" /> : <Box className="h-4 w-4" />}{threeD ? '2D' : '3D'}
          </button>
          <div className="relative">
            <button onClick={() => setLayersOpen(o => !o)} aria-expanded={layersOpen} aria-label="Map layers" title="Layers"
              className="glass flex h-9 w-9 items-center justify-center rounded-control text-cc-text">
              <Layers className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {layersOpen && (
                <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: DUR.quick, ease: EASE_OUT }} style={{ transformOrigin: 'top right' }}
                  className="absolute right-0 mt-2 w-48 rounded-card border border-cc-border bg-cc-surface p-1.5 shadow-pop">
                  {(Object.keys(LAYER_GROUPS) as LayerGroup[]).map(g => (
                    <label key={g} className="flex cursor-pointer items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[13px] hover:bg-cc-hover">
                      {LAYER_LABEL[g]}
                      <input type="checkbox" checked={!hidden.has(g)} onChange={() => toggleLayer(g)} className="h-3.5 w-3.5 accent-[rgb(var(--cc-accent))]" />
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
          <motion.div key={hover.kind + (hp.id ?? hp.cluster_id)} initial={{ opacity: 0, y: 4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.instant }}
            className="pointer-events-none absolute z-sticky w-60 rounded-control border border-cc-border bg-cc-surface/95 p-3 shadow-pop backdrop-blur"
            style={{ left: Math.min(hover.x + 14, (el.current?.clientWidth ?? 600) - 250), top: Math.max(8, hover.y - 20) }}>
            {hover.kind === 'cluster' ? (
              <>
                <p className="text-[13px] font-semibold">{hp.point_count} places</p>
                <p className="mt-1 text-[12px] text-cc-muted"><span className="font-medium text-red-700">{hp.critical} critical</span> · {hp.high} high demand</p>
                <p className="mt-1 text-[11px] text-cc-faint">Click to zoom in</p>
              </>
            ) : (
              <>
                <p className="truncate text-[13px] font-semibold">{hp.name}</p>
                <p className="truncate text-[11.5px] capitalize text-cc-muted">{[hp.kind, hp.district && `${hp.district} district`].filter(Boolean).join(' · ')}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                  <span className="text-cc-muted">Status</span><span className="text-right font-medium" style={{ color: hp.status === 'Critical' ? MAP_COLORS.critical : hp.status === 'High Demand' ? MAP_COLORS.high : undefined }}>{hp.status}</span>
                  <span className="text-cc-muted">Crisis signals</span><span className="mono text-right font-medium">{Math.round(Number(hp.crisis))}/100</span>
                  <span className="text-cc-muted">Population</span><span className="mono text-right">{Number(hp.pop).toLocaleString('en-IN')}</span>
                  <span className="text-cc-muted">Shortfall</span><span className="mono text-right">{Number(hp.shortfall).toLocaleString('en-IN')} L/d</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-cc-hover"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Number(hp.crisis))}%`, background: Number(hp.crisis) >= 70 ? MAP_COLORS.critical : Number(hp.crisis) >= 30 ? MAP_COLORS.high : MAP_COLORS.normal }} /></div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
