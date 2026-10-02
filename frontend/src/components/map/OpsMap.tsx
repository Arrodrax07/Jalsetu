/**
 * Operations map (MapLibre GL).
 *
 * Vehicles are drawn ONLY at their last accepted real GPS fix; there is no interpolation or animation.
 * A marker moves when (and only when) the vehicles prop changes because a new fix arrived.
 */
import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, LngLatBoundsLike, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Community, Depot, TrackingState, Vehicle } from '../../types';

export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';
const INDIA: LngLatBoundsLike = [[67.5, 6.0], [97.8, 37.4]];

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#060a11' } }],
};

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
  onVehicle?: (id: string) => void;
  onCommunity?: (id: string) => void;
  onAlert?: (id: number) => void;
  onState?: (id: number, bbox: number[]) => void;
  onMapClick?: (lat: number, lng: number) => void;
  fit?: { bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null;
  className?: string;
}

const STATE_COLOR: Record<TrackingState, string> = { live: '#22c55e', stale: '#f59e0b', offline: '#ef4444', no_signal: '#64748b' };
const COMMUNITY_COLOR = ['match', ['get', 'status'], 'Critical', '#ef4444', 'High Demand', '#f59e0b', 'Recently Served', '#22c55e', '#38bdf8'];
const SEV_COLOR = ['match', ['get', 'severity'], 'Extreme', '#dc2626', 'Severe', '#f97316', 'Moderate', '#eab308', 'Minor', '#3b82f6', '#64748b'];

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

async function resolveStyle(): Promise<{ style: string | StyleSpecification; labels: boolean }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(MAP_STYLE_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return { style: MAP_STYLE_URL, labels: true };
  } catch { /* fall through */ }
  return { style: FALLBACK_STYLE, labels: false };
}

export const OpsMap: React.FC<Props> = (p) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapOk, setBasemapOk] = useState(true);
  const handlers = useRef(p);
  handlers.current = p;

  useEffect(() => {
    let cancelled = false;
    resolveStyle().then(({ style, labels }) => {
      if (cancelled || !el.current) return;
      setBasemapOk(labels);
      const m = new maplibregl.Map({ container: el.current, style, bounds: INDIA, attributionControl: { compact: true }, maxPitch: 0, dragRotate: false });
      map.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      m.on('load', () => {
        const src = (id: string) => m.addSource(id, { type: 'geojson', data: empty });
        ['states', 'districts', 'alerts', 'routes', 'geofence', 'communities', 'depots', 'vehicles'].forEach(src);
        m.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.015 } });
        m.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': '#5b6b84', 'line-width': 0.8, 'line-opacity': 0.7 } });
        m.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': '#475569', 'line-width': 0.6, 'line-dasharray': [2, 2] } });
        m.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': SEV_COLOR as any, 'fill-opacity': 0.18 } });
        m.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': SEV_COLOR as any, 'line-width': 1.2, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'routes-planned', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'planned'],
          paint: { 'line-color': '#38bdf8', 'line-width': ['case', ['get', 'highlight'], 3, 2], 'line-dasharray': [2, 1.5], 'line-opacity': ['case', ['get', 'highlight'], 0.9, 0.45] } });
        m.addLayer({ id: 'routes-proposal', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'proposal'], paint: { 'line-color': '#a78bfa', 'line-width': 4, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'routes-actual', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'actual'], paint: { 'line-color': '#22c55e', 'line-width': 3.5, 'line-opacity': 0.95 } });
        m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofence', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.08 } });
        m.addLayer({ id: 'geofence-line', type: 'line', source: 'geofence', paint: { 'line-color': '#22c55e', 'line-width': 1.5, 'line-dasharray': [1, 1] } });
        m.addLayer({ id: 'communities', type: 'circle', source: 'communities',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 7, 14, 10], 'circle-color': COMMUNITY_COLOR as any, 'circle-opacity': 0.9,
            'circle-stroke-color': ['case', ['==', ['get', 'origin'], 'seeded'], '#a78bfa', '#0b1220'], 'circle-stroke-width': 1.5 } });
        m.addLayer({ id: 'depots', type: 'circle', source: 'depots', paint: { 'circle-radius': 6, 'circle-color': '#0b1220', 'circle-stroke-color': '#e6edf6', 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'vehicles-halo', type: 'circle', source: 'vehicles', filter: ['get', 'selected'], paint: { 'circle-radius': 16, 'circle-color': '#ffffff', 'circle-opacity': 0.12 } });
        m.addLayer({ id: 'vehicles-acc', type: 'circle', source: 'vehicles', filter: ['get', 'selected'],
          paint: { 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, ['/', ['get', 'acc'], 152.87], 20, ['/', ['get', 'acc'], 0.1493]], 'circle-color': '#38bdf8', 'circle-opacity': 0.08, 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 0.5 } });
        m.addLayer({ id: 'vehicles', type: 'circle', source: 'vehicles',
          paint: { 'circle-radius': ['case', ['get', 'selected'], 9, 7], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#060a11', 'circle-stroke-width': 2.5 } });
        if (labels) {
          m.addLayer({ id: 'vehicles-label', type: 'symbol', source: 'vehicles',
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true },
            paint: { 'text-color': '#e6edf6', 'text-halo-color': '#060a11', 'text-halo-width': 1.5 } });
          m.addLayer({ id: 'communities-label', type: 'symbol', source: 'communities', minzoom: 11,
            layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
            paint: { 'text-color': '#94a3bd', 'text-halo-color': '#060a11', 'text-halo-width': 1.2 } });
        }
        const click = (layer: string, fn: (f: maplibregl.MapGeoJSONFeature) => void) => {
          m.on('click', layer, e => { e.originalEvent.stopPropagation(); if (e.features?.[0]) fn(e.features[0]); });
          m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
          m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
        };
        click('vehicles', f => handlers.current.onVehicle?.(String(f.properties.id)));
        click('communities', f => handlers.current.onCommunity?.(String(f.properties.id)));
        click('alerts-fill', f => handlers.current.onAlert?.(Number(f.properties.id)));
        click('states-fill', f => handlers.current.onState?.(Number(f.properties.id), JSON.parse(String(f.properties.bbox))));
        m.on('click', e => {
          const hits = m.queryRenderedFeatures(e.point, { layers: ['vehicles', 'communities', 'alerts-fill'] });
          if (!hits.length) handlers.current.onMapClick?.(e.lngLat.lat, e.lngLat.lng);
        });
        setReady(true);
      });
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  const set = (id: string, data: GeoJSON.FeatureCollection) => {
    const s = map.current?.getSource(id) as GeoJSONSource | undefined;
    s?.setData(data);
  };

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
    set('communities', { type: 'FeatureCollection', features: (p.communities || []).map(c => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: { id: c.id, name: c.name, status: c.status, origin: c.dataOrigin } })) });
  }, [ready, p.communities]);
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
    if (p.fit.bbox) map.current.fitBounds([[p.fit.bbox[0], p.fit.bbox[1]], [p.fit.bbox[2], p.fit.bbox[3]]], { padding: 48, maxZoom: 15, duration: 600 });
    else if (p.fit.center) map.current.flyTo({ center: [p.fit.center[1], p.fit.center[0]], zoom: p.fit.zoom ?? 14, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.fit?.key]);

  return (
    <div className={p.className || 'relative h-full w-full'}>
      <div ref={el} className="absolute inset-0" />
      {!basemapOk && (
        <div className="absolute left-3 top-3 z-10 rounded-md border border-cc-warn/40 bg-cc-bg/90 px-2.5 py-1.5 text-2xs text-amber-200">
          Basemap tiles unavailable. Operational layers are still accurate.
        </div>
      )}
    </div>
  );
};
