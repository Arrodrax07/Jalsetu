import React, { useState } from 'react';
import {
  FileText,
  AlertTriangle,
  Truck,
  Building2,
  AlertOctagon,
  MessageSquare,
  Clock,
  PieChart,
  Plus,
  RefreshCw,
  Cpu,
  Route,
  ArrowUpRight
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { KpiCard } from '../components/common/KpiCard';
import { CommandMap } from '../components/maps/CommandMap';
import { CreateRequestModal } from '../components/requests/CreateRequestModal';
import { Community } from '../types';

export const Dashboard: React.FC = () => {
  const {
    communities,
    requests,
    complaints,
    tankers,
    selectedCommunity,
    setSelectedCommunity,
    setActiveTab,
    runAllocation,
    isAllocationRunning
  } = useWaterData();

  const [isRequestModalOpen, setIsRequestModalOpen] = useState<boolean>(false);

  // Computed metrics
  const activeRequestsCount = requests.filter(r => r.status !== 'Delivered' && r.status !== 'Rejected').length;
  const criticalRequestsCount = requests.filter(r => r.urgency === 'Critical' && r.status !== 'Delivered').length;
  const activeTankersCount = tankers.filter(t => t.status === 'En Route' || t.status === 'Loading').length;
  const communitiesServedCount = communities.filter(c => c.currentCoverage >= 85).length;
  const underservedCommunitiesCount = communities.filter(c => c.currentCoverage < 75 || c.status === 'Critical').length;
  const pendingComplaintsCount = complaints.filter(c => c.status !== 'Resolved').length;

  const handleSelectCommunity = (comm: Community) => {
    setSelectedCommunity(comm);
    setActiveTab('communities');
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Community Water Intelligence
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time command center overview of water demand, allocation, complaints and tanker operations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => runAllocation()}
            disabled={isAllocationRunning}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-all"
          >
            <Cpu className="w-4 h-4 text-sky-400" />
            <span>{isAllocationRunning ? 'Optimizing...' : 'Run Allocation AI'}</span>
          </button>

          <button
            onClick={() => setIsRequestModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Water Request</span>
          </button>
        </div>
      </div>

      {/* 8 Primary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Active Water Requests"
          value={activeRequestsCount}
          subtitle="Monitored across 10 municipal wards"
          icon={<FileText className="w-5 h-5" />}
          trend={{ value: '+8%', isPositive: false, label: 'vs yesterday' }}
          accentColor="brand"
          onClick={() => setActiveTab('requests')}
        />

        <KpiCard
          title="Critical Requests"
          value={criticalRequestsCount}
          subtitle="Hospital & dry-pipeline zones"
          icon={<AlertTriangle className="w-5 h-5" />}
          trend={{ value: 'Urgent Attention', isNeutral: true }}
          accentColor="rose"
          onClick={() => setActiveTab('requests')}
        />

        <KpiCard
          title="Tankers Active"
          value={`${activeTankersCount} / 18`}
          subtitle="78% fleet operational"
          icon={<Truck className="w-5 h-5" />}
          trend={{ value: '+2 dispatches', isPositive: true, label: 'this hour' }}
          accentColor="cyan"
          onClick={() => setActiveTab('tracking')}
        />

        <KpiCard
          title="Communities Served Today"
          value={`${communitiesServedCount} / 10`}
          subtitle="Sufficient daily water supply"
          icon={<Building2 className="w-5 h-5" />}
          trend={{ value: '70% achieved', isPositive: true }}
          accentColor="emerald"
          onClick={() => setActiveTab('communities')}
        />

        <KpiCard
          title="Underserved Communities"
          value={underservedCommunitiesCount}
          subtitle="Coverage shortfall > 25%"
          icon={<AlertOctagon className="w-5 h-5" />}
          trend={{ value: 'Priority target', isNeutral: true }}
          accentColor="amber"
          onClick={() => setActiveTab('demandAnalysis')}
        />

        <KpiCard
          title="Pending Complaints"
          value={pendingComplaintsCount}
          subtitle={`${complaints.filter(c => c.isRepeated).length} repeated clusters`}
          icon={<MessageSquare className="w-5 h-5" />}
          trend={{ value: '-14%', isPositive: true, label: 'resolved today' }}
          accentColor="rose"
          onClick={() => setActiveTab('complaints')}
        />

        <KpiCard
          title="Average Delivery Time"
          value="42 min"
          subtitle="Target threshold < 60 min"
          icon={<Clock className="w-5 h-5" />}
          trend={{ value: '16 min saved', isPositive: true, label: 'via AI routing' }}
          accentColor="emerald"
          onClick={() => setActiveTab('routeOptimizer')}
        />

        <KpiCard
          title="Coverage Balance"
          value="86%"
          subtitle="City-wide Gini equality index"
          icon={<PieChart className="w-5 h-5" />}
          trend={{ value: '+24%', isPositive: true, label: 'fairness score' }}
          accentColor="cyan"
          onClick={() => setActiveTab('impactAnalytics')}
        />
      </div>

      {/* Main Grid: Interactive Command Map & Live Operations Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Large Leaflet Map (2 Columns) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <span>Geospatial Coverage & Community Demand Map</span>
            </h3>
            <span className="text-xs text-slate-500">
              Click any pin to inspect shortfall, population, and priority score
            </span>
          </div>

          <CommandMap
            communities={communities}
            tankers={tankers}
            selectedCommunity={selectedCommunity}
            onSelectCommunity={handleSelectCommunity}
            height="540px"
          />
        </div>

        {/* Live Operations Panel (1 Column) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Truck className="w-4 h-4 text-sky-600" />
              <span>Live Operations</span>
            </h3>
            <button
              onClick={() => setActiveTab('tracking')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-0.5"
            >
              <span>Full Telemetry</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {tankers.slice(0, 4).map((tanker) => {
              const isEnRoute = tanker.status === 'En Route';
              const isLoading = tanker.status === 'Loading';
              const isDelivered = tanker.status === 'Delivered';

              let statusColor = 'bg-sky-50 text-sky-700 border-sky-200';
              let progressColor = 'bg-sky-500';

              if (isLoading) {
                statusColor = 'bg-amber-50 text-amber-700 border-amber-200';
                progressColor = 'bg-amber-500';
              } else if (isDelivered) {
                statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                progressColor = 'bg-emerald-500';
              }

              return (
                <div
                  key={tanker.id}
                  className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-subtle hover:shadow-card transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-900">{tanker.vehicleNumber}</h4>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {tanker.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">Driver: {tanker.driverName}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-900">
                        {isDelivered ? 'Delivered' : `ETA: ${tanker.eta}`}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Load: {tanker.currentLoad.toLocaleString()} L
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 mb-2 flex items-center justify-between">
                    <span>
                      Destination: <strong className="text-slate-800">{tanker.destinationCommunity}</strong>
                    </span>
                    <span className="font-semibold text-slate-700">{tanker.progressPercent}%</span>
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${progressColor}`}
                      style={{ width: `${tanker.progressPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Route Optimizer Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-sky-900 to-slate-900 text-white shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <Route className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300">Route Efficiency</h4>
            </div>
            <p className="text-xs text-slate-300 mb-3">
              AI batching saves <strong className="text-white">7.2 km</strong> per trip and reduces diesel expenditure by ₹310.
            </p>
            <button
              onClick={() => setActiveTab('routeOptimizer')}
              className="w-full py-2 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold text-center transition-colors shadow-sm"
            >
              Optimize Tanker Fleet Routes
            </button>
          </div>
        </div>
      </div>

      {/* Modal Dialog for Request Creation */}
      <CreateRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        preselectedCommunity={selectedCommunity}
      />
    </div>
  );
};
