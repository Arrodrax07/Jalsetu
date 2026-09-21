import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Community, Tanker } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { DEPOT_LOCATION } from '../../data/seededTankers';
import { Eye, MapPin, Truck, AlertCircle, WifiOff } from 'lucide-react';

interface CommandMapProps {
  communities: Community[];
  tankers: Tanker[];
  selectedCommunity?: Community | null;
  onSelectCommunity?: (c: Community) => void;
  height?: string;
  showRoutes?: boolean;
}

// Custom Leaflet DivIcon helpers
const createPinIcon = (color: string, label: string, isCritical = false) => {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer group">
        ${isCritical ? '<div class="absolute -inset-1.5 rounded-full bg-rose-500/40 animate-ping"></div>' : ''}
        <div class="w-8 h-8 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white text-[10px] font-bold" style="background-color: ${color};">
          ${label.substring(0, 2).toUpperCase()}
        </div>
        <div class="absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b border-white" style="background-color: ${color};"></div>
      </div>
    `,
    iconSize: [32, 36],
    iconAnchor: [16, 36],
    popupAnchor: [0, -36]
  });
};

const createTankerIcon = (status: string) => {
  const isEnRoute = status === 'En Route';
  const color = isEnRoute ? '#0284c7' : (status === 'Loading' ? '#f59e0b' : '#10b981');

  return L.divIcon({
    className: 'custom-tanker-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer">
        <div class="p-1.5 rounded-lg border-2 border-white shadow-lg text-white" style="background-color: ${color};">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
            <path d="M15 18H9"/>
            <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14v10Z"/>
            <circle cx="17" cy="18" r="2"/>
            <circle cx="7" cy="18" r="2"/>
          </svg>
        </div>
        ${isEnRoute ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-sky-400 border border-white animate-pulse"></span>' : ''}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });
};

const depotIcon = L.divIcon({
  className: 'custom-depot-marker',
  html: `
    <div class="relative flex items-center justify-center cursor-pointer">
      <div class="p-2 rounded-xl bg-slate-900 border-2 border-white shadow-xl text-sky-400">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      </div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20]
});

// Component to dynamically focus on selected community
const MapRecenter: React.FC<{ selectedCommunity?: Community | null }> = ({ selectedCommunity }) => {
  const map = useMap();
  useEffect(() => {
    if (selectedCommunity) {
      map.flyTo([selectedCommunity.lat, selectedCommunity.lng], 14, { duration: 1.2 });
    }
  }, [selectedCommunity, map]);
  return null;
};

export const CommandMap: React.FC<CommandMapProps> = ({
  communities,
  tankers,
  selectedCommunity,
  onSelectCommunity,
  height = '500px',
  showRoutes = true
}) => {
  const [mapError, setMapError] = useState(false);
  const centerCoord: [number, number] = [19.0600, 72.8900]; // Mumbai Central/Eastern Suburban Region

  const getMarkerColor = (status: string) => {
    switch (status) {
      case 'Critical': return '#ef4444'; // Red
      case 'High Demand': return '#f59e0b'; // Orange
      case 'Recently Served': return '#10b981'; // Green
      case 'Normal':
      default: return '#0284c7'; // Blue
    }
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-subtle bg-slate-100" style={{ height }}>
      {/* Map Legend Overlay */}
      <div className="absolute top-3 left-3 z-[400] bg-white/90 backdrop-blur-md px-3 py-2 rounded-xl shadow-card border border-slate-200 text-xs hidden sm:flex items-center gap-3">
        <span className="font-bold text-slate-700">Map Legend:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
          <span className="text-slate-600">Critical</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-slate-600">High Demand</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-600" />
          <span className="text-slate-600">Normal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-slate-600">Recently Served</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-900" />
          <span className="text-slate-600">Tanker Fleet</span>
        </div>
      </div>

      {mapError ? (
        /* Vector Fallback if OSM tiles are blocked or offline */
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-slate-50 text-center">
          <WifiOff className="w-12 h-12 text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-800">Vector Map Mode Active</h3>
          <p className="text-xs text-slate-500 max-w-md mt-1">
            External map tile server connection timed out. Showing simulated civic coordinate layout.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 max-w-lg w-full">
            {communities.slice(0, 6).map(c => (
              <div
                key={c.id}
                onClick={() => onSelectCommunity && onSelectCommunity(c)}
                className="p-2.5 bg-white border rounded-lg shadow-sm text-left cursor-pointer hover:border-sky-500"
              >
                <p className="font-bold text-xs text-slate-900">{c.name}</p>
                <p className="text-[10px] text-slate-500">Shortfall: {c.shortfall.toLocaleString()} L</p>
                <StatusBadge status={c.status} size="sm" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <MapContainer
          center={centerCoord}
          zoom={12}
          scrollWheelZoom={false}
          className="w-full h-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{
              tileerror: () => setMapError(true)
            }}
          />

          <MapRecenter selectedCommunity={selectedCommunity} />

          {/* Central Depot Marker */}
          <Marker position={[DEPOT_LOCATION.lat, DEPOT_LOCATION.lng]} icon={depotIcon}>
            <Popup>
              <div className="p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <MapPin className="w-4 h-4 text-sky-600" />
                  {DEPOT_LOCATION.name}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Primary municipal distribution hub with 6 pressurized gantry bays.
                </p>
              </div>
            </Popup>
          </Marker>

          {/* Communities Markers */}
          {communities.map((c) => {
            const isCritical = c.status === 'Critical';
            const pinColor = getMarkerColor(c.status);

            return (
              <Marker
                key={c.id}
                position={[c.lat, c.lng]}
                icon={createPinIcon(pinColor, c.name, isCritical)}
              >
                <Popup>
                  <div className="p-3.5 min-w-[240px]">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{c.name}</h4>
                        <p className="text-[11px] text-slate-500">{c.ward}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600 mb-3">
                      <div className="flex justify-between">
                        <span>Population:</span>
                        <span className="font-semibold text-slate-800">{c.population.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Daily Demand:</span>
                        <span className="font-semibold text-slate-800">{c.dailyDemand.toLocaleString()} L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Allocated:</span>
                        <span className="font-semibold text-slate-800">{c.allocatedWater.toLocaleString()} L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Shortfall:</span>
                        <span className="font-bold text-rose-600">{c.shortfall.toLocaleString()} L</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Vulnerability:</span>
                        <span className="font-semibold text-slate-800">{c.vulnerability}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last Delivery:</span>
                        <span className="font-medium text-slate-600">{c.lastDelivery}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-100">
                        <span className="font-bold text-slate-800">Priority Score:</span>
                        <span className="font-bold text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">
                          {c.priorityScore}/100
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectCommunity && onSelectCommunity(c)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Community
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Active Tankers Markers */}
          {tankers.map((t) => (
            <Marker
              key={t.id}
              position={t.currentCoordinates}
              icon={createTankerIcon(t.status)}
            >
              <Popup>
                <div className="p-3 min-w-[220px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                      <Truck className="w-4 h-4 text-sky-600" />
                      {t.vehicleNumber}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold border border-sky-200">
                      {t.status}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-slate-600">
                    <p><span className="text-slate-400">Driver:</span> {t.driverName}</p>
                    <p><span className="text-slate-400">Destination:</span> <strong>{t.destinationCommunity}</strong></p>
                    <p><span className="text-slate-400">Load:</span> {t.currentLoad.toLocaleString()} / {t.capacity.toLocaleString()} L</p>
                    <p><span className="text-slate-400">ETA:</span> <strong className="text-emerald-600">{t.eta}</strong></p>
                    <p><span className="text-slate-400">Speed:</span> {t.speedKmH} km/h</p>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Show Tanker T-2045 Route Polyline if enabled */}
          {showRoutes && (
            <Polyline
              positions={[
                [19.0350, 72.8980], // Depot
                [19.0480, 72.9100],
                [19.0550, 72.9180], // Tanker location
                [19.0607, 72.9264], // Shivaji Nagar
                [19.0657, 72.8837], // Kurla East
                [19.0434, 72.8567]  // Dharavi
              ]}
              pathOptions={{ color: '#0284c7', weight: 3.5, dashArray: '6, 6', opacity: 0.8 }}
            />
          )}
        </MapContainer>
      )}
    </div>
  );
};
