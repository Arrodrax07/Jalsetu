import React, { useState } from 'react';
import { FileText, AlertTriangle, Truck, Building2, AlertOctagon, MessageSquare, Clock, PieChart, Plus, Cpu, Route, ArrowUpRight } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { KpiCard } from '../components/common/KpiCard';
import { CommandMap } from '../components/maps/CommandMap';
import { CreateRequestModal } from '../components/requests/CreateRequestModal';
import { StatusBadge } from '../components/common/StatusBadge';
import type { Community } from '../types';
import { pct } from '../utils/format';

export const Dashboard: React.FC = () => {
  const { communities, requests, complaints, tankers, depots, dashboard: d, selectedCommunity, setSelectedCommunity, setActiveTab, runAllocation, isAllocationRunning, currentUser } = useWaterData();
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);

  const activeRequests = requests.filter(r => !['Delivered', 'Rejected'].includes(r.status)).length;
  const criticalRequests = requests.filter(r => r.urgency === 'Critical' && !['Delivered', 'Rejected'].includes(r.status)).length;
  const openComplaints = complaints.filter(c => c.status !== 'Resolved');
  const repeated = openComplaints.filter(c => c.isRepeated).length;
  const liveTankers = [...tankers].sort((a, b) => Number(b.status === 'En Route') - Number(a.status === 'En Route')).slice(0, 4);

  const handleSelectCommunity = (c: Community) => {
    setSelectedCommunity(c);
    setActiveTab('communities');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Community Water Intelligence</h2>
          <p className="text-xs text-slate-500 mt-1">Live overview of demand, allocation, complaints and tanker operations.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {currentUser?.role !== 'driver' && (
            <button onClick={() => runAllocation()} disabled={isAllocationRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold shadow-sm">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>{isAllocationRunning ? 'Optimizing…' : 'Run Allocation'}</span>
            </button>
          )}
          <button onClick={() => setIsRequestModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card">
            <Plus className="w-4 h-4" /> <span>Create Water Request</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Active Water Requests" value={activeRequests} subtitle={`${d?.requestsLast24h ?? 0} received in last 24 h`}
          icon={<FileText className="w-5 h-5" />}
          trend={d?.requestsChangePct != null ? { value: `${d.requestsChangePct > 0 ? '+' : ''}${d.requestsChangePct}%`, isPositive: d.requestsChangePct <= 0, label: 'vs previous 24 h' } : undefined}
          accentColor="brand" onClick={() => setActiveTab('requests')} />
        <KpiCard title="Critical Requests" value={criticalRequests} subtitle="Open, priority ≥ 75" icon={<AlertTriangle className="w-5 h-5" />}
          accentColor="rose" onClick={() => setActiveTab('requests')} />
        <KpiCard title="Tankers Active" value={`${d?.tankersActive ?? 0} / ${d?.fleetTotal ?? 0}`}
          subtitle={d ? `${d.fleetOperational} operational` : ''} icon={<Truck className="w-5 h-5" />} accentColor="cyan" onClick={() => setActiveTab('tracking')} />
        <KpiCard title="Communities Served" value={`${d?.communitiesServed ?? 0} / ${d?.communitiesTotal ?? 0}`} subtitle="Allocation ≥ 85% of demand"
          icon={<Building2 className="w-5 h-5" />} accentColor="emerald" onClick={() => setActiveTab('communities')} />
        <KpiCard title="Underserved Communities" value={d?.underserved ?? 0} subtitle="Coverage < 75% or critical request" icon={<AlertOctagon className="w-5 h-5" />}
          accentColor="amber" onClick={() => setActiveTab('demandAnalysis')} />
        <KpiCard title="Open Complaints" value={openComplaints.length} subtitle={`${repeated} repeated / duplicate`} icon={<MessageSquare className="w-5 h-5" />}
          trend={d ? { value: `${d.complaintsResolved24h} resolved`, isPositive: true, label: 'last 24 h' } : undefined}
          accentColor="rose" onClick={() => setActiveTab('complaints')} />
        <KpiCard title="Avg Trip-to-Delivery" value={d?.avgDeliveryMinutes != null ? `${d.avgDeliveryMinutes} min` : '—'}
          subtitle={d?.avgDeliveryMinutes != null ? 'Dispatch → POD, last 7 days' : 'No deliveries recorded yet'} icon={<Clock className="w-5 h-5" />}
          trend={d?.avgDeliveryChangeMin != null ? { value: `${d.avgDeliveryChangeMin > 0 ? '+' : ''}${d.avgDeliveryChangeMin} min`, isPositive: d.avgDeliveryChangeMin <= 0, label: 'vs prior week' } : undefined}
          accentColor="emerald" onClick={() => setActiveTab('deliveryVerification')} />
        <KpiCard title="Need-Weighted Equity" value={pct(d?.coverageBalance, 1)} subtitle={`Worst-off community at ${pct(d?.minCoveragePct)}`}
          icon={<PieChart className="w-5 h-5" />}
          trend={d?.lastPlanFairnessGain != null ? { value: `${d.lastPlanFairnessGain > 0 ? '+' : ''}${d.lastPlanFairnessGain} pts`, isPositive: d.lastPlanFairnessGain >= 0, label: 'last approved plan' } : undefined}
          accentColor="cyan" onClick={() => setActiveTab('impactAnalytics')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">Coverage & Demand Map</h3>
            <span className="text-xs text-slate-500 hidden sm:inline">Click a pin for shortfall, population and priority</span>
          </div>
          <CommandMap communities={communities} tankers={tankers} depots={depots} selectedCommunity={selectedCommunity}
            onSelectCommunity={handleSelectCommunity} height="540px" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2"><Truck className="w-4 h-4 text-sky-600" /> Live Operations</h3>
            <button onClick={() => setActiveTab('tracking')} className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-0.5">
              Full telemetry <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            {liveTankers.length === 0 && <p className="text-xs text-slate-500 p-4 bg-white rounded-xl border border-slate-200">No tankers registered.</p>}
            {liveTankers.map(t => (
              <div key={t.id} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-subtle">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900">{t.vehicleNumber}</h4>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Driver: {t.driverName || '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-900">ETA {t.eta}</p>
                    <p className="text-[10px] text-slate-400">Load {t.currentLoad.toLocaleString('en-IN')} L</p>
                  </div>
                </div>
                <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
                  <span>Next: <strong className="text-slate-800">{t.destinationCommunity}</strong></span>
                  <span className="font-semibold text-slate-700">{t.progressPercent}%</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700 bg-sky-500" style={{ width: `${t.progressPercent}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-sky-900 to-slate-900 text-white shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <Route className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300">Route Efficiency (30 days)</h4>
            </div>
            <p className="text-xs text-slate-300 mb-3">
              {d?.routeAvgKmSaved != null
                ? <>Optimized routing saved <strong className="text-white">{d.routeAvgKmSaved} km</strong> and <strong className="text-white">₹{d.routeAvgFuelSavedInr}</strong> diesel per trip on average over {d.routeTrips30d} trips.</>
                : 'No dispatched trips yet. Savings appear once tankers are dispatched on optimized routes.'}
            </p>
            <button onClick={() => setActiveTab('routeOptimizer')} className="w-full py-2 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold">
              Plan & dispatch a route
            </button>
          </div>
        </div>
      </div>

      <CreateRequestModal isOpen={isRequestModalOpen} onClose={() => setIsRequestModalOpen(false)} preselectedCommunity={selectedCommunity} />
    </div>
  );
};
