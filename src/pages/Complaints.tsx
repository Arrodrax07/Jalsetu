import React, { useState } from 'react';
import {
  AlertCircle,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Search,
  Filter,
  ArrowUpRight,
  ShieldAlert,
  UserCheck,
  Plus
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { Modal } from '../components/common/Modal';
import { Complaint, ComplaintCategory, UrgencyLevel, ComplaintStatus } from '../types';
import { analyzeComplaintText } from '../services/complaintIntelligence';

export const Complaints: React.FC = () => {
  const { complaints, updateComplaintStatus, createComplaint, communities } = useWaterData();
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(complaints[0] || null);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);

  // New Complaint Form State
  const [newCommunityId, setNewCommunityId] = useState(communities[0]?.id || '');
  const [newDesc, setNewDesc] = useState('');
  const [livePreview, setLivePreview] = useState<ReturnType<typeof analyzeComplaintText> | null>(null);

  // KPIs
  const totalComplaints = complaints.length;
  const criticalComplaints = complaints.filter(c => c.severity === 'Critical' && c.status !== 'Resolved').length;
  const repeatedComplaints = complaints.filter(c => c.isRepeated).length;
  const resolvedComplaints = complaints.filter(c => c.status === 'Resolved').length;

  const categories = ['All', 'No Water', 'Late Tanker', 'Insufficient Quantity', 'Poor Water Quality', 'Missed Delivery', 'Duplicate Request'];

  const filteredComplaints = complaints.filter(c => {
    if (filterCategory !== 'All' && c.category !== filterCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.id.toLowerCase().includes(q) ||
        c.communityName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleTextChange = (text: string) => {
    setNewDesc(text);
    if (text.length > 5) {
      const comm = communities.find(c => c.id === newCommunityId);
      const existingCount = complaints.filter(c => c.communityId === newCommunityId).length;
      const analysis = analyzeComplaintText(text, comm ? comm.name : 'Target Community', existingCount);
      setLivePreview(analysis);
    } else {
      setLivePreview(null);
    }
  };

  const handleLodgeComplaint = (e: React.FormEvent) => {
    e.preventDefault();
    const comm = communities.find(c => c.id === newCommunityId) || communities[0];
    const existingCount = complaints.filter(c => c.communityId === newCommunityId).length;
    const analysis = analyzeComplaintText(newDesc, comm.name, existingCount);

    createComplaint({
      communityId: comm.id,
      communityName: comm.name,
      category: analysis.category,
      description: newDesc,
      sentiment: analysis.sentiment,
      severity: analysis.severity,
      isRepeated: analysis.isRepeated,
      similarComplaintsCount: existingCount,
      status: 'Pending',
      duplicateProbability: analysis.duplicateProbability,
      recommendedAction: analysis.recommendedAction
    });

    setNewDesc('');
    setLivePreview(null);
    setIsNewModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Complaint Intelligence & Grievance NLP
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Automated grievance classification, multi-ticket cluster detection, and deduplication engine.
          </p>
        </div>

        <button
          onClick={() => setIsNewModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>+ Lodge Citizen Grievance</span>
        </button>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Grievances</p>
          <h3 className="text-2xl font-bold text-slate-900 mt-1">{totalComplaints}</h3>
          <p className="text-[11px] text-slate-500 mt-1">All tickets logged across city</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-100 bg-rose-50/30 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Critical Outages</p>
          <h3 className="text-2xl font-bold text-rose-600 mt-1">{criticalComplaints}</h3>
          <p className="text-[11px] text-rose-500 mt-1">Zero water & medical clinics</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-100 bg-amber-50/30 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Repeated Clusters</p>
          <h3 className="text-2xl font-bold text-amber-600 mt-1">{repeatedComplaints}</h3>
          <p className="text-[11px] text-amber-500 mt-1">Multiple calls from same standpost</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-100 bg-emerald-50/30 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Resolved Grievances</p>
          <h3 className="text-2xl font-bold text-emerald-600 mt-1">{resolvedComplaints}</h3>
          <p className="text-[11px] text-emerald-500 mt-1">Verified via POD & community OTP</p>
        </div>
      </div>

      {/* Main Split: Complaints Table & Selected AI Analysis Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Complaints Table (2 Columns) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    filterCategory === cat
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search complaints..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Community</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Repeated?</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredComplaints.map(c => {
                    const isSelected = selectedComplaint?.id === c.id;

                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedComplaint(c)}
                        className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-50/70 border-l-4 border-l-sky-600' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-bold text-slate-900">{c.id}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{c.communityName}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-700">{c.category}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.severity} />
                        </td>
                        <td className="px-4 py-3">
                          {c.isRepeated ? (
                            <span className="inline-flex items-center gap-1 font-bold text-rose-600">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Yes ({c.similarComplaintsCount})
                            </span>
                          ) : (
                            <span className="text-slate-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-500">{c.submittedAt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Complaint AI Analysis Panel (1 Column) */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-subtle space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Complaint AI Analysis
                </h3>
              </div>
              {selectedComplaint && (
                <span className="text-xs font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
                  {selectedComplaint.id}
                </span>
              )}
            </div>

            {selectedComplaint ? (
              <div className="space-y-4 text-xs">
                {/* Community & Description */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Community</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{selectedComplaint.communityName}</p>
                  <p className="mt-2 text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200/70 italic leading-relaxed">
                    "{selectedComplaint.description}"
                  </p>
                </div>

                {/* AI Detected Properties */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Category Detected</span>
                    <p className="font-bold text-slate-900 mt-0.5">{selectedComplaint.category}</p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Sentiment</span>
                    <p className={`font-bold mt-0.5 ${selectedComplaint.sentiment === 'Negative' ? 'text-rose-600' : 'text-slate-700'}`}>
                      {selectedComplaint.sentiment}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Severity</span>
                    <div className="mt-0.5">
                      <StatusBadge status={selectedComplaint.severity} />
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Duplicate Probability</span>
                    <p className="font-bold text-slate-900 mt-0.5">
                      {Math.round(selectedComplaint.duplicateProbability * 100)}%
                    </p>
                  </div>
                </div>

                {/* Community Impact Assessment */}
                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 leading-relaxed">
                  <span className="font-bold text-amber-900 block mb-1">Community Impact Assessment:</span>
                  {selectedComplaint.isRepeated ? (
                    <p>
                      High priority because this complaint matches{' '}
                      <strong>{selectedComplaint.similarComplaintsCount} similar complaints</strong> from{' '}
                      {selectedComplaint.communityName} in the last 48 hours.
                    </p>
                  ) : (
                    <p>
                      Isolated ticket; monitored for escalation if nearby public taps report pressure loss.
                    </p>
                  )}
                </div>

                {/* Recommended Action */}
                <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-200 text-sky-950 leading-relaxed">
                  <span className="font-bold text-sky-900 block mb-1">AI Recommended Action:</span>
                  <p>{selectedComplaint.recommendedAction}</p>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateComplaintStatus(selectedComplaint.id, 'Escalated')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-colors"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Escalate
                    </button>

                    <button
                      onClick={() => updateComplaintStatus(selectedComplaint.id, 'Assigned')}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Assign Officer
                    </button>
                  </div>

                  <button
                    onClick={() => updateComplaintStatus(selectedComplaint.id, 'Resolved')}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark Resolved
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-center text-slate-400 py-8">Select a complaint from the table to view AI intelligence.</p>
            )}
          </div>
        </div>
      </div>

      {/* Lodge Citizen Grievance Modal */}
      <Modal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        title="Lodge Citizen Water Grievance"
        subtitle="JalSetu AI automatically classifies category, sentiment, duplicate probability, and urgency in real-time."
        maxWidth="lg"
      >
        <form onSubmit={handleLodgeComplaint} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Community / Ward</label>
            <select
              value={newCommunityId}
              onChange={(e) => setNewCommunityId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            >
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Grievance Description</label>
            <textarea
              rows={3}
              value={newDesc}
              onChange={(e) => handleTextChange(e.target.value)}
              required
              placeholder="Type grievance e.g. 'Third day without water', 'Tanker arrived 2 hours late', 'Water smells like chemicals'..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            />
          </div>

          {/* Real-Time NLP Detection Preview */}
          {livePreview && (
            <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 space-y-2 animate-scale-in">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                Live NLP Classification Preview
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-white p-2 rounded-lg border border-sky-100">
                  <span className="text-[10px] text-slate-400 block font-bold">Category</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">{livePreview.category}</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-sky-100">
                  <span className="text-[10px] text-slate-400 block font-bold">Severity</span>
                  <div className="mt-0.5">
                    <StatusBadge status={livePreview.severity} />
                  </div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-sky-100">
                  <span className="text-[10px] text-slate-400 block font-bold">Duplicate %</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">
                    {Math.round(livePreview.duplicateProbability * 100)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsNewModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-card"
            >
              Submit Grievance
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
