import React, { useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Eye,
  MapPin,
  Phone,
  AlertTriangle,
  Droplet,
  CheckCircle2,
  Calendar,
  Building2,
  TrendingDown,
  ArrowRight
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { Modal } from '../components/common/Modal';
import { Community } from '../types';

export const Communities: React.FC = () => {
  const { communities, selectedCommunity, setSelectedCommunity, requests, complaints, deliveries } = useWaterData();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);

  const filteredCommunities = communities.filter(c => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.ward.toLowerCase().includes(q) ||
        c.vulnerability.toLowerCase().includes(q) ||
        c.contactOfficer.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleOpenDetail = (comm: Community) => {
    setSelectedCommunity(comm);
    setDetailModalOpen(true);
  };

  const activeComm = selectedCommunity || communities[0];

  // Specific community records
  const commRequests = requests.filter(r => r.communityId === activeComm?.id || r.communityName === activeComm?.name);
  const commComplaints = complaints.filter(c => c.communityId === activeComm?.id || c.communityName === activeComm?.name);
  const commDeliveries = deliveries.filter(d => d.communityName === activeComm?.name);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Monitored Urban Communities
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Demographic profiles, vulnerability indices, and water delivery history across 10 municipal wards.
          </p>
        </div>

        {/* View mode toggle & search */}
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search community or ward..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                viewMode === 'table' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCommunities.map(comm => {
            const isCritical = comm.status === 'Critical';

            return (
              <div
                key={comm.id}
                onClick={() => handleOpenDetail(comm)}
                className={`p-5 rounded-2xl bg-white border transition-all cursor-pointer shadow-subtle hover:shadow-card space-y-3 ${
                  isCritical ? 'border-rose-200 hover:border-rose-300' : 'border-slate-200/90 hover:border-sky-400'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{comm.name}</h3>
                    <p className="text-xs text-slate-500">{comm.ward}</p>
                  </div>
                  <StatusBadge status={comm.status} />
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Daily Demand</span>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{comm.dailyDemand.toLocaleString()} L</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Shortfall</span>
                    <p className={`text-sm font-bold mt-0.5 ${comm.shortfall > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {comm.shortfall.toLocaleString()} L
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Population</span>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{comm.population.toLocaleString()}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Coverage</span>
                    <p className="text-sm font-bold text-sky-700 mt-0.5">{comm.currentCoverage}%</p>
                  </div>
                </div>

                {/* Coverage Bar */}
                <div>
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Coverage Progress</span>
                    <span className="font-semibold text-slate-700">{comm.allocatedWater.toLocaleString()} / {comm.dailyDemand.toLocaleString()} L</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        comm.currentCoverage >= 85 ? 'bg-emerald-500' : comm.currentCoverage >= 70 ? 'bg-sky-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${comm.currentCoverage}%` }}
                    />
                  </div>
                </div>

                {/* Footer details */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>Last: {comm.lastDelivery}</span>
                  <div className="flex items-center gap-1.5 font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">
                    <span>Priority: {comm.priorityScore}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Community</th>
                  <th className="px-4 py-3">Ward</th>
                  <th className="px-4 py-3">Population</th>
                  <th className="px-4 py-3">Daily Demand</th>
                  <th className="px-4 py-3">Allocated</th>
                  <th className="px-4 py-3">Coverage</th>
                  <th className="px-4 py-3">Vulnerability</th>
                  <th className="px-4 py-3">Open Complaints</th>
                  <th className="px-4 py-3 text-center">Priority</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCommunities.map(comm => (
                  <tr
                    key={comm.id}
                    onClick={() => handleOpenDetail(comm)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-bold text-slate-900">{comm.name}</td>
                    <td className="px-4 py-3 text-slate-500">{comm.ward}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{comm.population.toLocaleString()}</td>
                    <td className="px-4 py-3">{comm.dailyDemand.toLocaleString()} L</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{comm.allocatedWater.toLocaleString()} L</td>
                    <td className="px-4 py-3 font-bold text-sky-700">{comm.currentCoverage}%</td>
                    <td className="px-4 py-3"><StatusBadge status={comm.vulnerability} /></td>
                    <td className="px-4 py-3 font-semibold text-rose-600">{comm.openComplaints}</td>
                    <td className="px-4 py-3 text-center font-bold text-sky-800">{comm.priorityScore}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(comm);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Community Detail Modal */}
      {activeComm && (
        <Modal
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          title={`Community Profile: ${activeComm.name}`}
          subtitle={`${activeComm.ward} • Ward Officer: ${activeComm.contactOfficer} (${activeComm.officerPhone})`}
          maxWidth="2xl"
        >
          <div className="space-y-4 text-xs">
            {/* Overview Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Population</span>
                <p className="text-base font-bold text-slate-900 mt-0.5">{activeComm.population.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Daily Demand</span>
                <p className="text-base font-bold text-slate-900 mt-0.5">{activeComm.dailyDemand.toLocaleString()} L</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Shortfall</span>
                <p className="text-base font-bold text-rose-600 mt-0.5">{activeComm.shortfall.toLocaleString()} L</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Priority Score</span>
                <p className="text-base font-bold text-sky-700 mt-0.5">{activeComm.priorityScore}/100</p>
              </div>
            </div>

            {/* Geographical Location */}
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-sky-600" />
                <span className="font-semibold text-slate-800">
                  GPS Coordinates: {activeComm.lat.toFixed(4)}°N, {activeComm.lng.toFixed(4)}°E
                </span>
              </div>
              <span className="font-bold text-sky-800">Vulnerability Score: {activeComm.vulnerabilityScore}/100</span>
            </div>

            {/* Active Water Requests for this community */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-slate-700 mb-2">
                Active Water Requests ({commRequests.length})
              </h4>
              <div className="space-y-1.5">
                {commRequests.slice(0, 3).map(r => (
                  <div key={r.id} className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 mr-2">{r.id}</span>
                      <span className="text-slate-600">{r.requestedAmount.toLocaleString()} L</span>
                      <span className="text-slate-400 ml-2">({r.reason})</span>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Complaints */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-slate-700 mb-2">
                Citizen Grievance Records ({commComplaints.length})
              </h4>
              <div className="space-y-1.5">
                {commComplaints.slice(0, 2).map(c => (
                  <div key={c.id} className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 mr-2">{c.id}</span>
                      <span className="text-slate-600">{c.category}: "{c.description}"</span>
                    </div>
                    <StatusBadge status={c.severity} />
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery History */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-slate-700 mb-2">
                Recent Tanker Delivery Log
              </h4>
              <div className="space-y-1.5">
                {commDeliveries.slice(0, 2).map(d => (
                  <div key={d.id} className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 mr-2">{d.id}</span>
                      <span className="text-slate-600">{d.deliveredAmount.toLocaleString()} L delivered via {d.vehicleNumber}</span>
                    </div>
                    <span className="font-semibold text-emerald-600">{d.deliveryTime}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setDetailModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
