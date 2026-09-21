import React, { useState } from 'react';
import {
  CheckSquare,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Search,
  Filter,
  Eye,
  AlertOctagon,
  FileCheck,
  Clock,
  MapPin,
  Camera,
  FileText
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { Modal } from '../components/common/Modal';
import { DeliveryRecord } from '../types';

export const DeliveryVerification: React.FC = () => {
  const { deliveries, verifyDelivery, investigateDelivery } = useWaterData();
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<DeliveryRecord | null>(null);

  const totalVerified = deliveries.filter(d => d.status === 'Verified').length;
  const totalMismatches = deliveries.filter(d => d.status === 'Mismatch').length;
  const totalInvestigating = deliveries.filter(d => d.status === 'Under Investigation').length;

  const filteredDeliveries = deliveries.filter(d => {
    if (filterStatus === 'Verified' && d.status !== 'Verified') return false;
    if (filterStatus === 'Mismatch' && d.status !== 'Mismatch') return false;
    if (filterStatus === 'Under Investigation' && d.status !== 'Under Investigation') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        d.id.toLowerCase().includes(q) ||
        d.communityName.toLowerCase().includes(q) ||
        d.vehicleNumber.toLowerCase().includes(q) ||
        d.fieldOfficer.toLowerCase().includes(q)
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
            Proof of Delivery (POD) & Verification Audit
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Cryptographic IoT sensor logging and field officer biometric audits to eliminate water theft and delivery variance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
            Audit Accuracy: 98.4%
          </span>
        </div>
      </div>

      {/* 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-subtle flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Verified Deliveries</span>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{totalVerified} / {deliveries.length}</h3>
            <p className="text-[11px] text-emerald-600 font-medium mt-0.5">GPS & officer matched</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-100 bg-rose-50/20 shadow-subtle flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Quantity Mismatches</span>
            <h3 className="text-2xl font-bold text-rose-600 mt-1">{totalMismatches}</h3>
            <p className="text-[11px] text-rose-500 font-medium mt-0.5">Variance &gt; 5% detected</p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
            <AlertOctagon className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-100 bg-amber-50/20 shadow-subtle flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Under Investigation</span>
            <h3 className="text-2xl font-bold text-amber-600 mt-1">{totalInvestigating}</h3>
            <p className="text-[11px] text-amber-500 font-medium mt-0.5">Ward vigilance assigned</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {['All', 'Verified', 'Mismatch', 'Under Investigation'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filterStatus === status
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search delivery ID, tanker, community..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
          />
        </div>
      </div>

      {/* Delivery Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDeliveries.map(record => {
          const isMismatch = record.status === 'Mismatch';
          const isInvestigating = record.status === 'Under Investigation';

          return (
            <div
              key={record.id}
              className={`p-5 rounded-2xl bg-white border transition-all shadow-subtle hover:shadow-card space-y-3.5 ${
                isMismatch
                  ? 'border-rose-300 ring-1 ring-rose-200'
                  : isInvestigating
                  ? 'border-amber-300 ring-1 ring-amber-200'
                  : 'border-slate-200/90'
              }`}
            >
              {/* Top Row: ID & Status */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{record.id}</h4>
                  <p className="text-[11px] text-slate-500">{record.vehicleNumber} • {record.deliveryTime}</p>
                </div>
                <StatusBadge status={record.status} />
              </div>

              {/* Community & Quantities */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Destination</span>
                <p className="text-base font-bold text-slate-900">{record.communityName}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Allocated</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{record.allocatedAmount.toLocaleString()} L</p>
                </div>

                <div className={`p-2.5 rounded-xl border ${isMismatch ? 'bg-rose-50/70 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Delivered</span>
                  <p className={`text-sm font-bold mt-0.5 ${isMismatch ? 'text-rose-600 font-black' : 'text-slate-900'}`}>
                    {record.deliveredAmount.toLocaleString()} L
                  </p>
                </div>
              </div>

              {/* Warning Notice if Mismatch */}
              {isMismatch && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2">
                  <AlertOctagon className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <p className="leading-tight">
                    <strong>{record.varianceAmount.toLocaleString()} L delivery variance detected.</strong> Community received less than scheduled allocation.
                  </p>
                </div>
              )}

              {/* Verification Badges */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1 font-semibold ${record.gpsVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    GPS Geofence
                  </span>
                  <span className={`inline-flex items-center gap-1 font-semibold ${record.officerVerified ? 'text-emerald-600' : 'text-amber-600'}`}>
                    <FileCheck className="w-3.5 h-3.5" />
                    {record.officerVerified ? 'Officer Signed' : 'Pending Sign-off'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => setSelectedRecord(record)}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors flex items-center justify-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Details</span>
                </button>

                {isMismatch ? (
                  <button
                    onClick={() => investigateDelivery(record.id)}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-sm"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Investigate</span>
                  </button>
                ) : (
                  record.status !== 'Verified' && (
                    <button
                      onClick={() => verifyDelivery(record.id)}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1 shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Verify POD</span>
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Inspection Modal */}
      {selectedRecord && (
        <Modal
          isOpen={!!selectedRecord}
          onClose={() => setSelectedRecord(null)}
          title={`Delivery Audit Manifest: ${selectedRecord.id}`}
          subtitle={`Vehicle ${selectedRecord.vehicleNumber} • Destined for ${selectedRecord.communityName}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Audit Status</span>
                <div className="mt-1">
                  <StatusBadge status={selectedRecord.status} size="md" />
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400">Delivery Timestamp</span>
                <p className="text-xs font-bold text-slate-800 mt-1">{selectedRecord.deliveryTime}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Allocated Quota</span>
                <p className="text-base font-black text-slate-900 mt-0.5">{selectedRecord.allocatedAmount.toLocaleString()} L</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400">Delivered Volume</span>
                <p className="text-base font-black text-sky-700 mt-0.5">{selectedRecord.deliveredAmount.toLocaleString()} L</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Field Officer Sign-off</span>
              <p className="text-xs font-bold text-slate-800">{selectedRecord.fieldOfficer}</p>
              <p className="text-[11px] text-slate-500">Digital Geofence Radius: 12m from designated community standpost.</p>
            </div>

            {selectedRecord.notes && (
              <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-950">
                <span className="font-bold text-sky-900 block mb-0.5">Audit Log Notes:</span>
                <p className="leading-relaxed">{selectedRecord.notes}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              {selectedRecord.status !== 'Verified' && (
                <button
                  onClick={() => {
                    verifyDelivery(selectedRecord.id);
                    setSelectedRecord(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm"
                >
                  Verify Delivery
                </button>
              )}
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
