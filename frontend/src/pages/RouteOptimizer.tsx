import React, { useEffect, useMemo, useState } from 'react';
import { Route, Zap, Clock, Fuel, Leaf, Truck, MapPin, Send, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { CommandMap } from '../components/maps/CommandMap';
import { StatusBadge } from '../components/common/StatusBadge';
import { api } from '../services/api';
import type { RouteOptimizationResult, Trip } from '../types';
import { litres, timeAgo } from '../utils/format';

export const RouteOptimizer: React.FC = () => {
  const { tankers, communities, depots, handleError, addToast, refresh, operations } = useWaterData();
  const available = tankers.filter(t => t.status === 'Idle');
  const [tankerId, setTankerId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<RouteOptimizationResult | null>(null);
  const [busy, setBusy] = useState<'opt' | 'dispatch' | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);

  const loadTrips = () => api.trips(true).then(setTrips).catch(() => undefined);
  useEffect(() => { loadTrips(); }, [tankers]);
  useEffect(() => { if (!tankerId && available[0]) setTankerId(available[0].id); }, [available, tankerId]);
  useEffect(() => {
    // Default selection: the three highest-priority communities with a shortfall.
    if (selected.length === 0 && communities.length) {
      setSelected([...communities].filter(c => c.shortfall > 0).sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3).map(c => c.id));
    }
  }, [communities, selected.length]);
  useEffect(() => setResult(null), [tankerId, selected]);

  const ranked = useMemo(() => [...communities].sort((a, b) => b.priorityScore - a.priorityScore), [communities]);
  const tanker = tankers.find(t => t.id === tankerId);
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= 8 ? s : [...s, id]);

  const optimize = async () => {
    setBusy('opt');
    try { setResult(await api.optimizeRoute(tankerId, selected)); } catch (e) { handleError(e, 'Route optimisation failed'); }
    setBusy(null);
  };

  const dispatch = async () => {
    setBusy('dispatch');
    try {
      const trip = await api.dispatch(tankerId, selected);
      addToast('Tanker dispatched', `${trip.vehicleNumber} on ${trip.id}: ${trip.stops.map(s => s.communityName).join(' → ')}`, 'success');
      setResult(null);
      setSelected([]);
      setTankerId('');
      await Promise.all([refresh('tankers', 'requests', 'dashboard'), loadTrips()]);
    } catch (e) { handleError(e, 'Dispatch failed'); }
    setBusy(null);
  };

  const cancel = async (t: Trip) => {
    try { await api.cancelTrip(t.dbId); addToast('Trip cancelled', t.id, 'info'); await Promise.all([refresh('tankers'), loadTrips()]); }
    catch (e) { handleError(e, 'Could not cancel'); }
  };

  const order: Record<string, number> = {};
  result?.sequence.forEach((s, i) => { order[s.communityId] = i + 1; });
  const shownCommunities = result ? communities.filter(c => order[c.id]) : communities.filter(c => selected.includes(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Route Optimizer & Dispatch</h2>
        <p className="text-xs text-slate-500 mt-1">
          Road distances and times from OSRM (OpenStreetMap). Stops are ordered to minimise trip time plus priority-weighted arrival time, so critical communities are reached early.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5"><Truck className="w-4 h-4 text-sky-600" /> 1. Tanker</h3>
            {available.length === 0 ? <p className="text-xs text-slate-500">No idle tankers. Wait for a trip to finish or restore a tanker.</p> : (
              <select value={tankerId} onChange={e => setTankerId(e.target.value)} className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50">
                {available.map(t => <option key={t.id} value={t.id}>{t.vehicleNumber} · {t.capacity.toLocaleString('en-IN')} L · {t.driverName || 'no driver'}</option>)}
              </select>
            )}
            {tanker && !tanker.driverUserId && <p className="text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />No driver account linked; GPS will only come from the simulator.</p>}
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-sky-600" /> 2. Stops <span className="text-slate-400 font-medium normal-case">({selected.length}/8, by priority)</span></h3>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {ranked.map(c => (
                <label key={c.id} className="flex items-center gap-2 py-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1 font-semibold text-slate-800">{c.name}</span>
                  <span className="text-[10px] text-slate-500">short {litres(c.shortfall)}</span>
                  <span className={`text-[10px] font-bold px-1.5 rounded ${c.priorityScore >= 75 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{c.priorityScore}</span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Load is split across stops in proportion to each community's shortfall.</p>
          </div>

          <button onClick={optimize} disabled={!tankerId || !selected.length || busy !== null}
            className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-card">
            {busy === 'opt' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />} Optimise route
          </button>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {result && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-900 to-slate-900 text-white grid grid-cols-2 md:grid-cols-4 gap-3">
              <Saving icon={<Zap className="w-4 h-4" />} label="Distance" before={`${result.distanceBeforeKm} km`} after={`${result.distanceAfterKm} km`} delta={`${result.distanceSavedKm} km saved`} />
              <Saving icon={<Clock className="w-4 h-4" />} label="Drive time" before={`${result.timeBeforeMin} min`} after={`${result.timeAfterMin} min`} delta={`${result.timeSavedMin} min saved`} />
              <Saving icon={<Fuel className="w-4 h-4" />} label="Diesel" after={`₹${result.fuelSavedInr}`} delta={`@ ₹${operations?.dieselPricePerLitre}/L, ${operations?.tankerKmPerLitre} km/L`} />
              <Saving icon={<Leaf className="w-4 h-4" />} label="CO₂ avoided" after={`${result.co2SavedKg} kg`} delta={result.routingSource === 'osrm' ? 'OSRM road network' : 'fallback estimate'} />
            </div>
          )}
          {result && result.routingSource !== 'osrm' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Routing service unreachable — distances estimated from straight-line distance × {operations?.roadCircuityFactor}.</p>
          )}

          <CommandMap communities={shownCommunities} tankers={tanker ? [tanker] : []} depots={depots} height="420px" showRoutes={false}
            extraRoute={result?.routeGeometry} stopOrder={order} />

          {result && (
            <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Manifest: {result.vehicleNumber}</h3>
              <ol className="space-y-1.5 text-xs">
                <li className="flex items-center gap-2 text-slate-500"><span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center">D</span>{result.depot.name} (load {litres(result.sequence.reduce((a, s) => a + s.litres, 0))})</li>
                {result.sequence.map((s, i) => (
                  <li key={s.communityId} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="font-semibold text-slate-800 flex-1">{s.name}</span>
                    <span className="text-slate-500">priority {s.priorityScore}</span>
                    <span className="font-bold text-sky-700 w-24 text-right">{litres(s.litres)}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-slate-500"><span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center">D</span>Return to depot</li>
              </ol>
              <p className="text-[11px] text-slate-500">Baseline for comparison: stops in the order entered ({result.stops.join(' → ')}).</p>
              <button onClick={dispatch} disabled={busy !== null}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2">
                {busy === 'dispatch' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Dispatch tanker on this route
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
        <div className="p-4 border-b border-slate-100"><h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">Active trips</h3></div>
        {trips.length === 0 ? <p className="p-4 text-xs text-slate-500">No active trips.</p> : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {trips.map(t => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-bold">{t.id}</td>
                  <td className="px-4 py-3">{t.vehicleNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{t.stops.map(s => `${s.communityName}${s.status === 'Delivered' ? ' ✓' : ''}`).join(' → ')}</td>
                  <td className="px-4 py-3">{t.distanceKm} km · {t.durationMin} min</td>
                  <td className="px-4 py-3 text-slate-500">{timeAgo(t.startedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => cancel(t)} className="text-rose-600 hover:text-rose-700 inline-flex items-center gap-1 font-semibold"><XCircle className="w-3.5 h-3.5" />Cancel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const Saving: React.FC<{ icon: React.ReactNode; label: string; before?: string; after: string; delta: string }> = ({ icon, label, before, after, delta }) => (
  <div>
    <p className="text-[10px] uppercase font-bold tracking-wider text-sky-300 flex items-center gap-1">{icon}{label}</p>
    <p className="text-lg font-black">{before && <span className="text-sm text-slate-400 line-through mr-1.5">{before}</span>}{after}</p>
    <p className="text-[10px] text-emerald-300">{delta}</p>
  </div>
);
