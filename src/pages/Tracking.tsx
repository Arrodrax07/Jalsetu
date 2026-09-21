import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Truck,
  RefreshCw,
  Phone,
  Radio,
  Gauge,
  Droplet,
  Compass,
  Clock,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { CommandMap } from '../components/maps/CommandMap';
import { StatusBadge } from '../components/common/StatusBadge';
import { Tanker } from '../types';

export const Tracking: React.FC = () => {
  const { tankers, communities, addToast } = useWaterData();
  const [selectedTankerId, setSelectedTankerId] = useState<string>('T-2045');
  const [isLiveSimRunning, setIsLiveSimRunning] = useState<boolean>(true);

  // Simulated dynamic GPS movement for tankers
  const [simulatedTankers, setSimulatedTankers] = useState<Tanker[]>(tankers);

  useEffect(() => {
    setSimulatedTankers(tankers);
  }, [tankers]);

  useEffect(() => {
    if (!isLiveSimRunning) return;

    // Advance T-2045 along its route coordinates incrementally
    const interval = setInterval(() => {
      setSimulatedTankers(prev => prev.map(t => {
        if (t.id === 'T-2045' && t.status === 'En Route') {
          // Slight coordinate drift along eastern express route toward Shivaji Nagar (19.0607, 72.9264)
          const targetLat = 19.0607;
          const targetLng = 72.9264;
          const curLat = t.currentCoordinates[0];
          const curLng = t.currentCoordinates[1];

          const dLat = (targetLat - curLat) * 0.05;
          const dLng = (targetLng - curLng) * 0.05;

          const newProgress = Math.min(96, t.progressPercent + 1);

          return {
            ...t,
            currentCoordinates: [curLat + dLat, curLng + dLng],
            progressPercent: newProgress,
            speedKmH: Math.floor(30 + Math.random() * 8),
            eta: newProgress > 90 ? '4 min' : (newProgress > 80 ? '8 min' : '12 min')
          };
        }
        return t;
      }));
    }, 2500);

    return () => clearInterval(interval);
  }, [isLiveSimRunning]);

  const activeTanker = simulatedTankers.find(t => t.id === selectedTankerId) || simulatedTankers[0];

  const handleRefreshLocation = () => {
    addToast('GPS Ping Received', `Satellite lock refreshed for ${activeTanker.vehicleNumber} (Accuracy: ±4.2m).`, 'info');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-slate-900">
              Live GPS Fleet Telemetry
            </h2>
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
              Live Cellular AIS Link
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time geospatial tracking of active municipal water tankers with continuous geofence verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLiveSimRunning(!isLiveSimRunning)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              isLiveSimRunning
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isLiveSimRunning ? 'Simulated Movement: Active' : 'Movement Paused'}
          </button>

          <button
            onClick={handleRefreshLocation}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Location</span>
          </button>
        </div>
      </div>

      {/* Grid: Active Tankers Roster, Map, and Telemetry Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Tanker Roster (1 Column) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Tankers ({simulatedTankers.length})
            </h3>
            <span className="text-[10px] text-slate-400">Click to focus</span>
          </div>

          <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
            {simulatedTankers.map(tanker => {
              const isSelected = tanker.id === selectedTankerId;

              return (
                <div
                  key={tanker.id}
                  onClick={() => setSelectedTankerId(tanker.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-50/80 border-sky-400 shadow-sm ring-1 ring-sky-300'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-subtle'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Truck className={`w-4 h-4 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`} />
                      <span className="font-bold text-xs text-slate-900">{tanker.vehicleNumber}</span>
                    </div>
                    <StatusBadge status={tanker.status} />
                  </div>

                  <div className="text-xs text-slate-600 space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Destination:</span>
                      <strong className="text-slate-800">{tanker.destinationCommunity}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">ETA:</span>
                      <span className="font-semibold text-emerald-600">{tanker.eta}</span>
                    </div>
                  </div>

                  {/* Micro Progress Bar */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-sky-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${tanker.progressPercent}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">{tanker.progressPercent}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Live GPS Map (2 Columns) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-sky-600" />
              <span>Real-time Map: Tracking {activeTanker.vehicleNumber}</span>
            </h3>
            <span className="text-xs text-slate-500">
              Coordinates: {activeTanker.currentCoordinates[0].toFixed(4)}°N, {activeTanker.currentCoordinates[1].toFixed(4)}°E
            </span>
          </div>

          <CommandMap
            communities={communities}
            tankers={simulatedTankers}
            height="560px"
            showRoutes={true}
          />
        </div>

        {/* Right Column: Telemetry & Driver Card (1 Column) */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-subtle space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vehicle Telemetry</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                  GPS Locked
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-1">{activeTanker.vehicleNumber}</h3>
              <p className="text-xs text-slate-500">{activeTanker.currentLocationName}</p>
            </div>

            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase mb-1">
                  <Gauge className="w-3.5 h-3.5" />
                  <span>Current Speed</span>
                </div>
                <p className="text-lg font-black text-slate-900">{activeTanker.speedKmH} <span className="text-xs font-normal text-slate-500">km/h</span></p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase mb-1">
                  <Droplet className="w-3.5 h-3.5 text-sky-500" />
                  <span>Water Load</span>
                </div>
                <p className="text-lg font-black text-sky-700">{activeTanker.currentLoad.toLocaleString()} <span className="text-xs font-normal text-slate-500">L</span></p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase mb-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Estimated ETA</span>
                </div>
                <p className="text-lg font-black text-emerald-600">{activeTanker.eta}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase mb-1">
                  <Compass className="w-3.5 h-3.5 text-slate-500" />
                  <span>Route Leg</span>
                </div>
                <p className="text-sm font-bold text-slate-900 mt-1 truncate">{activeTanker.destinationCommunity}</p>
              </div>
            </div>

            {/* Driver Profile */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Assigned Driver</span>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900">{activeTanker.driverName}</p>
                  <p className="text-[11px] text-slate-500">{activeTanker.driverPhone}</p>
                </div>
                <a
                  href={`tel:${activeTanker.driverPhone}`}
                  className="p-2 rounded-xl bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors"
                  title="Call Driver"
                >
                  <Phone className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Geofence Check */}
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-[11px] leading-tight">
                Geofence corridor active. Deviation tolerance configured at ≤50 meters.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
