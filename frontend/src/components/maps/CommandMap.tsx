import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Community, Depot, Tanker } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { Eye, MapPin, Truck, WifiOff } from 'lucide-react';
import { litres, timeAgo } from '../../utils/format';

interface CommandMapProps {
  communities: Community[];
  tankers: Tanker[];
  depots?: Depot[];
  selectedCommunity?: Community | null;
  onSelectCommunity?: (c: Community) => void;
  height?: string;
  showRoutes?: boolean;
  highlightTankerId?: string | null;
  extraRoute?: [number, number][] | null;
  stopOrder?: Record<string, number>;
  geofenceRadiusM?: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

const createPinIcon = (color: string, label: string, isCritical = false) => L.divIcon({
  className: 'custom-map-marker',
  html: `
    <div class="relative flex items-center justify-center cursor-pointer">
      ${isCritical ? '<div class="absolute -inset-1.5 rounded-full bg-rose-500/40 animate-ping"></div>' : ''}
      <div class="w-8 h-8 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white text-[10px] font-bold" style="background-color:${color};">
        ${esc(label)}
      </div>
    </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

const createTankerIcon = (t: Tanker, highlighted: boolean) => {
  const color = t.isDisrupted ? '#e11d48' : t.status === 'En Route' ? '#0284c7' : t.status === 'Loading' ? '#f59e0b' : '#475569';
  return L.divIcon({
    className: 'custom-tanker-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer ${highlighted ? 'scale-125' : ''}">
        <div class="p-1.5 rounded-lg border-2 ${highlighted ? 'border-amber-300' : 'border-white'} shadow-lg text-white" style="background-color:${color};">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>
            <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14v10Z"/>
            <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
          </svg>
        </div>
        ${t.gpsOnline ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white animate-pulse"></span>' : ''}
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
};

const depotIcon = L.divIcon({
  className: 'custom-depot-marker',
  html: `<div class="p-2 rounded-xl bg-slate-900 border-2 border-white shadow-xl text-sky-400">
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20],
});

const MapFocus: React.FC<{ selected?: Community | null; bounds: [number, number][] }> = ({ selected, bounds }) => {
  const map = useMap();
  const key = bounds.map(b => b.join(',')).join('|');
  useEffect(() => {
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  useEffect(() => {
    if (selected) map.flyTo([selected.lat, selected.lng], 14, { duration: 1 });
  }, [selected, map]);
  return null;
};

const markerColor = (status: string) =>
  status === 'Critical' ? '#ef4444' : status === 'High Demand' ? '#f59e0b' : status === 'Recently Served' ? '#10b981' : '#0284c7';

export const CommandMap: React.FC<CommandMapProps> = ({
  communities, tankers, depots = [], selectedCommunity, onSelectCommunity, height = '500px', showRoutes = true,
  highlightTankerId, extraRoute, stopOrder, geofenceRadiusM,
}) => {
  const [tileError, setTileError] = useState(false);
  const pts: [number, number][] = [...communities.map(c => [c.lat, c.lng] as [number, number]), ...depots.map(d => [d.lat, d.lng] as [number, number])];
  const center: [number, number] = pts.length
    ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
    : [19.06, 72.89];

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-subtle bg-slate-100" style={{ height }}>
      <div className="absolute top-3 left-3 z-[400] bg-white/90 backdrop-blur-md px-3 py-2 rounded-xl shadow-card border border-slate-200 text-xs hidden sm:flex items-center gap-3">
        {[['bg-rose-500', 'Critical'], ['bg-amber-500', 'High demand'], ['bg-sky-600', 'Normal'], ['bg-emerald-500', 'Served <24h'], ['bg-slate-900', 'Depot']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${c}`} /><span className="text-slate-600">{l}</span></div>
        ))}
      </div>
      {tileError && (
        <div className="absolute bottom-3 left-3 z-[400] bg-amber-50 border border-amber-200 text-amber-800 text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
          <WifiOff className="w-3.5 h-3.5" /> Map tiles unavailable; markers still accurate.
        </div>
      )}

      <MapContainer center={center} zoom={12} scrollWheelZoom className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
        <MapFocus selected={selectedCommunity} bounds={extraRoute && extraRoute.length > 1 ? extraRoute : []} />

        {depots.map(d => (
          <Marker key={d.id} position={[d.lat, d.lng]} icon={depotIcon}>
            <Popup><div className="p-3 text-xs font-bold text-slate-900 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-sky-600" />{d.name}</div></Popup>
          </Marker>
        ))}

        {communities.map(c => (
          <React.Fragment key={c.id}>
            <Marker position={[c.lat, c.lng]}
              icon={createPinIcon(markerColor(c.status), stopOrder?.[c.id] ? String(stopOrder[c.id]) : c.name.substring(0, 2).toUpperCase(), c.status === 'Critical')}>
              <Popup>
                <div className="p-3.5 min-w-[240px]">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{c.name}</h4>
                      <p className="text-[11px] text-slate-500">{c.ward}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="space-y-1 text-xs text-slate-600 mb-3">
                    <Row label="Population" value={c.population.toLocaleString('en-IN')} />
                    <Row label="Daily demand" value={litres(c.dailyDemand)} />
                    <Row label="Allocated" value={`${litres(c.allocatedWater)} (${c.currentCoverage}%)`} />
                    <Row label="Shortfall" value={litres(c.shortfall)} strong="text-rose-600" />
                    <Row label="Vulnerability" value={`${c.vulnerability} (${c.vulnerabilityScore})`} />
                    <Row label="Last delivery" value={timeAgo(c.lastDelivery)} />
                    <Row label="Priority score" value={`${c.priorityScore}/100`} strong="text-sky-700" />
                  </div>
                  {onSelectCommunity && (
                    <button onClick={() => onSelectCommunity(c)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
                      <Eye className="w-3.5 h-3.5" /> View community
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
            {geofenceRadiusM && <Circle center={[c.lat, c.lng]} radius={geofenceRadiusM} pathOptions={{ color: '#0284c7', weight: 1, fillOpacity: 0.05 }} />}
          </React.Fragment>
        ))}

        {showRoutes && tankers.filter(t => t.routeWaypoints.length > 1).map(t => (
          <Polyline key={`r-${t.id}`} positions={t.routeWaypoints}
            pathOptions={{ color: t.id === highlightTankerId ? '#0369a1' : '#38bdf8', weight: t.id === highlightTankerId ? 5 : 3, opacity: t.id === highlightTankerId ? 0.9 : 0.55, dashArray: '6, 6' }} />
        ))}
        {extraRoute && extraRoute.length > 1 && (
          <Polyline positions={extraRoute} pathOptions={{ color: '#0284c7', weight: 5, opacity: 0.85 }} />
        )}

        {tankers.map(t => (
          <Marker key={t.id} position={t.currentCoordinates} icon={createTankerIcon(t, t.id === highlightTankerId)}>
            <Popup>
              <div className="p-3 min-w-[220px] text-xs space-y-1 text-slate-600">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900"><Truck className="w-4 h-4 text-sky-600" />{t.vehicleNumber}</div>
                  <StatusBadge status={t.status} />
                </div>
                <p><span className="text-slate-400">Driver:</span> {t.driverName || '—'}</p>
                <p><span className="text-slate-400">Next stop:</span> <strong>{t.destinationCommunity}</strong></p>
                <p><span className="text-slate-400">Load:</span> {t.currentLoad.toLocaleString('en-IN')} / {t.capacity.toLocaleString('en-IN')} L</p>
                <p><span className="text-slate-400">ETA:</span> <strong className="text-emerald-600">{t.eta}</strong> · {t.speedKmH} km/h</p>
                <p><span className="text-slate-400">GPS:</span> {t.gpsOnline ? 'online' : `last fix ${timeAgo(t.lastPingAt)}`}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; strong?: string }> = ({ label, value, strong }) => (
  <div className="flex justify-between gap-3">
    <span>{label}:</span>
    <span className={`font-semibold ${strong || 'text-slate-800'}`}>{value}</span>
  </div>
);
