import React, { useState } from 'react';
import {
  Route,
  Zap,
  Clock,
  Fuel,
  TrendingDown,
  Navigation,
  CheckCircle2,
  Truck,
  ArrowRight,
  ShieldCheck,
  MapPin
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { CommandMap } from '../components/maps/CommandMap';
import { calculateOptimizedRoute } from '../services/routeOptimizer';

export const RouteOptimizer: React.FC = () => {
  const { tankers, communities, dispatchTanker, setActiveTab } = useWaterData();
  const [selectedTankerId, setSelectedTankerId] = useState<string>('T-2045');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [hasOptimized, setHasOptimized] = useState<boolean>(false);

  const currentTanker = tankers.find(t => t.id === selectedTankerId) || tankers[0];
  const stops = currentTanker.stops.length > 0 ? currentTanker.stops : ['Shivaji Nagar', 'Kurla East', 'Dharavi'];

  const routeResults = calculateOptimizedRoute(currentTanker.id, currentTanker.vehicleNumber, stops);

  const handleRunOptimization = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      setIsOptimizing(false);
      setHasOptimized(true);
    }, 800);
  };

  const handleDispatch = () => {
    dispatchTanker(currentTanker.id);
    setActiveTab('tracking');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            AI Fleet Route Optimizer
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Dynamic shortest-path TSP algorithms balancing priority delivery deadlines with fuel conservation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedTankerId}
            onChange={(e) => {
              setSelectedTankerId(e.target.value);
              setHasOptimized(false);
            }}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          >
            {tankers.map(t => (
              <option key={t.id} value={t.id}>
                {t.id} ({t.vehicleNumber}) - {t.destinationCommunity}
              </option>
            ))}
          </select>

          <button
            onClick={handleRunOptimization}
            disabled={isOptimizing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-card transition-all"
          >
            <Zap className="w-4 h-4 text-sky-400" />
            <span>{isOptimizing ? 'Recalculating...' : 'Optimize Route'}</span>
          </button>

          <button
            onClick={handleDispatch}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <Navigation className="w-4 h-4" />
            <span>Dispatch Tanker</span>
          </button>
        </div>
      </div>

      {/* Optimization Savings Banner */}
      <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-subtle flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-sm">
            <TrendingDown className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
              AI Route Efficiency Optimization
            </h4>
            <p className="text-xs text-emerald-800 mt-0.5">
              Distance before: <strong>{routeResults.distanceBeforeKm} km</strong> → Distance after: <strong>{routeResults.distanceAfterKm} km</strong>.
              Saved <strong className="text-emerald-900">{routeResults.distanceSavedKm} km</strong> & <strong className="text-emerald-900">{routeResults.timeSavedMin} minutes</strong> travel time.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 shadow-sm text-center">
            <span className="text-[10px] text-slate-400 block uppercase font-bold">Fuel Saved</span>
            <span className="font-bold text-emerald-700">₹{routeResults.fuelSavedInr}</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 shadow-sm text-center">
            <span className="text-[10px] text-slate-400 block uppercase font-bold">CO2 Reduced</span>
            <span className="font-bold text-emerald-700">{routeResults.co2SavedKg} kg</span>
          </div>
        </div>
      </div>

      {/* Split: Route Map & Optimization Manifest */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Interactive Route Map (2 Columns) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Route className="w-4 h-4 text-sky-600" />
              <span>Waypoints & Geometric Route Polyline</span>
            </h3>
            <span className="text-xs text-slate-500">
              Depot A ➔ Shivaji Nagar ➔ Kurla East ➔ Dharavi
            </span>
          </div>

          <CommandMap
            communities={communities}
            tankers={tankers}
            height="520px"
            showRoutes={true}
          />
        </div>

        {/* Route Manifest & Stop Order (1 Column) */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-subtle space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Route Manifest: {currentTanker.id}</h3>
                <p className="text-[11px] text-slate-500">Vehicle: {currentTanker.vehicleNumber}</p>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-sky-50 text-sky-700 border border-sky-200">
                {currentTanker.status}
              </span>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Total Distance</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">{routeResults.distanceAfterKm} km</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Estimated Travel</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">{routeResults.timeAfterMin} min</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tanker Capacity</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">{currentTanker.capacity.toLocaleString()} L</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Est. Fuel Cost</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">₹310</p>
              </div>
            </div>

            {/* Sequenced Waypoints */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Optimal Waypoint Delivery Sequence
              </span>

              <div className="space-y-2 text-xs">
                {/* Depot */}
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900 text-white">
                  <div className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center font-bold text-[10px]">
                    0
                  </div>
                  <div>
                    <p className="font-bold">Central Water Depot A</p>
                    <p className="text-[10px] text-slate-300">Loading Bay 3 (Start Location)</p>
                  </div>
                </div>

                {routeResults.recommendedSequence.map((stopName, idx) => (
                  <div
                    key={stopName}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-sky-50/50 transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 border border-sky-300 flex items-center justify-center font-bold text-[10px]">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900">{stopName}</p>
                      <p className="text-[10px] text-slate-500">
                        {idx === 0 ? 'High Priority Drop • ETA: 12 min' : (idx === 1 ? 'Secondary Standpost • ETA: 28 min' : 'Final Terminal Cistern • ETA: 47 min')}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">
                      {idx === 0 ? '8.2 km' : (idx === 1 ? '5.4 km' : '4.8 km')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Optimization Rationale */}
            <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-950 leading-relaxed">
              <span className="font-bold text-sky-900 block mb-0.5">Optimization Heuristic:</span>
              "Shortest route selected while maintaining priority deliveries. Backtracking eliminated along Eastern Express arterial corridor."
            </div>

            {/* Dispatch Button */}
            <button
              onClick={handleDispatch}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card flex items-center justify-center gap-2 transition-all"
            >
              <Navigation className="w-4 h-4" />
              <span>Confirm & Dispatch Tanker</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
