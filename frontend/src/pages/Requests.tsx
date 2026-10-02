import React, { useState } from 'react';
import {
  Plus,
  Filter,
  Search,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { CreateRequestModal } from '../components/requests/CreateRequestModal';
import { Modal } from '../components/common/Modal';
import type { WaterRequest } from '../types';
import { AssessmentPanel } from '../components/requests/CreateRequestModal';
import { timeAgo, dateTime } from '../utils/format';

export const Requests: React.FC = () => {
  const { requests, updateRequestStatus, setActiveTab } = useWaterData();
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedRequest, setSelectedRequest] = useState<WaterRequest | null>(null);

  const filters = ['All', 'Critical', 'High', 'Medium', 'Pending', 'Allocated', 'Dispatched', 'Delivered'];

  const filteredRequests = requests.filter(req => {
    // Status / urgency filter
    if (filterStatus === 'Critical' && req.urgency !== 'Critical') return false;
    if (filterStatus === 'High' && req.urgency !== 'High') return false;
    if (filterStatus === 'Medium' && req.urgency !== 'Medium') return false;
    if (filterStatus === 'Pending' && req.status !== 'Pending') return false;
    if (filterStatus === 'Allocated' && req.status !== 'Allocated') return false;
    if (filterStatus === 'Dispatched' && req.status !== 'Dispatched') return false;
    if (filterStatus === 'Delivered' && req.status !== 'Delivered') return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        req.id.toLowerCase().includes(q) ||
        req.communityName.toLowerCase().includes(q) ||
        req.reason.toLowerCase().includes(q) ||
        req.contactPerson.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Community Water Requests
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Ward water-supply requisitions, scored by the explainable priority model. Approving an allocation plan moves pending requests to Allocated.
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Create Water Request</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <Filter className="w-4 h-4 text-slate-400 mr-1 flex-shrink-0" />
          {filters.map(filter => (
            <button
              key={filter}
              onClick={() => setFilterStatus(filter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filterStatus === filter
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by ID, community, reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Request ID</th>
                <th className="px-4 py-3">Community</th>
                <th className="px-4 py-3">Requested Amount</th>
                <th className="px-4 py-3">Urgency</th>
                <th className="px-4 py-3">Population</th>
                <th className="px-4 py-3">Vulnerability</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">AI Priority</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    No water requests match the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredRequests.map(req => {
                  const isHighPriority = req.priorityScore >= 90;

                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                      onClick={() => setSelectedRequest(req)}
                    >
                      <td className="px-4 py-3 font-bold text-slate-900 flex items-center gap-1.5">
                        {isHighPriority && (
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                        )}
                        <span>{req.id}</span>
                      </td>

                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {req.communityName}
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-700">
                        {req.requestedAmount.toLocaleString()} L
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={req.urgency} />
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {req.population.toLocaleString()}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={req.vulnerability} />
                      </td>

                      <td className="px-4 py-3 text-slate-500" title={dateTime(req.submittedAt)}>
                        {timeAgo(req.submittedAt)}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={req.status} />
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-xs ${
                            req.priorityScore >= 90
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : req.priorityScore >= 75
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-sky-100 text-sky-800 border border-sky-200'
                          }`}
                        >
                          {req.priorityScore}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedRequest(req)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                            title="Inspect AI Assessment"
                          >
                            <Sparkles className="w-4 h-4 text-sky-500" />
                          </button>

                          {req.status === 'Pending' && (
                            <button
                              onClick={() => updateRequestStatus(req.id, 'Allocated')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] shadow-sm transition-colors"
                            >
                              Allocate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Inspection Modal */}
      {selectedRequest && (
        <Modal
          isOpen={!!selectedRequest}
          onClose={() => setSelectedRequest(null)}
          title={`Water Request: ${selectedRequest.id}`}
          subtitle={`Submitted for ${selectedRequest.communityName} • ${dateTime(selectedRequest.submittedAt)}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Current Status</p>
                <div className="mt-1">
                  <StatusBadge status={selectedRequest.status} size="md" />
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase font-bold text-slate-400">AI Priority Score</p>
                <p className="text-lg font-black text-sky-700 mt-0.5">{selectedRequest.priorityScore} / 100</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-slate-100 bg-white">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Requested Volume</span>
                <span className="text-sm font-bold text-slate-900 mt-0.5 block">
                  {selectedRequest.requestedAmount.toLocaleString()} Litres
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 bg-white">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Days Without Water</span>
                <span className="text-sm font-bold text-rose-600 mt-0.5 block">
                  {selectedRequest.daysWithoutWater} consecutive days
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 bg-white">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Contact Person</span>
                <span className="text-xs font-semibold text-slate-800 mt-0.5 block">
                  {selectedRequest.contactPerson} ({selectedRequest.phone})
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-100 bg-white">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Target Population</span>
                <span className="text-xs font-semibold text-slate-800 mt-0.5 block">
                  {selectedRequest.population.toLocaleString()} residents
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
              <span className="font-bold text-slate-700 block mb-1">Reason for Requisition:</span>
              <p className="text-slate-600 leading-relaxed">{selectedRequest.reason}</p>
            </div>

            {selectedRequest.aiAssessment && <AssessmentPanel a={selectedRequest.aiAssessment} />}

            {/* Status Change Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              {selectedRequest.status === 'Pending' && (
                <button
                  onClick={() => {
                    updateRequestStatus(selectedRequest.id, 'Allocated');
                    setSelectedRequest(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm transition-colors"
                >
                  Approve Allocation
                </button>
              )}
              {selectedRequest.status === 'Pending' && (
                <button
                  onClick={() => {
                    updateRequestStatus(selectedRequest.id, 'Rejected');
                    setSelectedRequest(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition-colors"
                >
                  Reject
                </button>
              )}
              {selectedRequest.status === 'Allocated' && (
                <button
                  onClick={() => {
                    setSelectedRequest(null);
                    setActiveTab('routeOptimizer');
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors"
                >
                  Plan dispatch route
                </button>
              )}
              <button
                onClick={() => setSelectedRequest(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for creating a new request */}
      <CreateRequestModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
};
