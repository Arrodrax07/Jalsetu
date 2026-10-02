import React, { useEffect, useState } from 'react';
import { Navigation, Gauge, Droplets, Clock, Phone, Satellite, SatelliteDish, MapPin, Route } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { CommandMap } from '../components/maps/CommandMap';
import { StatusBadge } from '../components/common/StatusBadge';
import { api } from '../services/api';
import { timeAgo } from '../utils/format';

export const Tracking: React.FC = () => {
  const { tankers, communities, depots } = useWaterData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const t = tankers.find(x => x.id === selectedId) || tankers.find(x => x.status === 'En Route') || tankers[0];

  useEffect(() => {
    if (!t) return;
    let alive = true;
    const load = () => api.trail(t.id).then(p => alive && setTrail(p)).catch(() => undefined);
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [t?.id]);

  const active = tankers.filter(x => x.status === 'En Route' || x.status === 'Loading').length;
  const online = tankers.filter(x => x.gpsOnline).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Live Fleet Tracking</h2>
          <p className="text-xs text-slate-500 mt-1">Positions stream from the driver app (phone GPS) over a live WebSocket. A tanker is online if it reported within 5 minutes.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 font-semibold">{active} on trips</span>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">{online} GPS online</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
          {tankers.map(x => (
            <button key={x.id} onClick={() => setSelectedId(x.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${t?.id === x.id ? 'bg-sky-50 border-sky-300 shadow-card' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">{x.vehicleNumber}</span>
                <StatusBadge status={x.isDisrupted ? 'Maintenance' : x.status} />
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">{x.status === 'En Route' ? `→ ${x.destinationCommunity} · ETA ${x.eta}` : x.currentLocationName}</p>
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden mr-2"><div className="bg-sky-500 h-full" style={{ width: `${x.progressPercent}%` }} /></div>
                {x.gpsOnline ? <Satellite className="w-3.5 h-3.5 text-emerald-500" /> : <SatelliteDish className="w-3.5 h-3.5 text-slate-300" />}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          <CommandMap communities={communities} tankers={tankers} depots={depots} height="620px" highlightTankerId={t?.id} extraRoute={trail.length > 1 ? trail : null} />
        </div>

        {t && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-sky-950 text-white space-y-4">
              <div className="flex items-center justify-between">
                <div><p className="text-[10px] uppercase tracking-wider text-sky-300 font-bold">Telemetry</p><h3 className="text-base font-black">{t.vehicleNumber}</h3></div>
                <Navigation className="w-5 h-5 text-sky-400" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Metric icon={<Gauge className="w-4 h-4" />} label="Speed" value={`${t.speedKmH} km/h`} />
                <Metric icon={<Clock className="w-4 h-4" />} label="ETA next stop" value={t.eta} />
                <Metric icon={<Droplets className="w-4 h-4" />} label="Load" value={`${t.currentLoad.toLocaleString('en-IN')} L`} sub={`of ${t.capacity.toLocaleString('en-IN')} L`} />
                <Metric icon={<Route className="w-4 h-4" />} label="Trip progress" value={`${t.progressPercent}%`} sub={t.activeTripId || 'no trip'} />
              </div>
              <div className="text-[11px] text-slate-300 space-y-1">
                <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{t.currentLocationName}</p>
                <p className="flex items-center gap-1.5"><Satellite className="w-3.5 h-3.5" />{t.gpsOnline ? 'GPS online' : 'GPS offline'} · last fix {timeAgo(t.lastPingAt)}</p>
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-2 text-xs">
              <p className="text-[10px] uppercase font-bold text-slate-400">Driver</p>
              <p className="font-bold text-slate-900">{t.driverName || 'Not assigned'}</p>
              {t.driverPhone && (
                <a href={`tel:${t.driverPhone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  <Phone className="w-3.5 h-3.5" /> Call {t.driverPhone}
                </a>
              )}
            </div>

            {t.stops.length > 0 && (
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle text-xs">
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Route stops</p>
                <ol className="space-y-1 list-decimal list-inside text-slate-700">{t.stops.map(s => <li key={s}>{s}</li>)}</ol>
              </div>
            )}
            {t.isDisrupted && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">Out of service: {t.breakdownNote}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = ({ icon, label, value, sub }) => (
  <div className="p-2.5 rounded-xl bg-white/10 border border-white/10">
    <p className="text-[10px] text-sky-300 uppercase font-bold flex items-center gap-1">{icon}{label}</p>
    <p className="text-sm font-black mt-0.5">{value}</p>
    {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
  </div>
);
