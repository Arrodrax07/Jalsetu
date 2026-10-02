import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, AlertTriangle, ShieldCheck, Search, MapPin, Camera, Droplets, Eye } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { KpiCard } from '../components/common/KpiCard';
import { Modal } from '../components/common/Modal';
import { api } from '../services/api';
import type { DeliveryRecord } from '../types';
import { dateTime, litres, timeAgo } from '../utils/format';

const FILTERS = ['All', 'Pending Verification', 'Mismatch', 'Under Investigation', 'Verified'] as const;

export const DeliveryVerification: React.FC = () => {
  const { deliveries, verifyDelivery, investigateDelivery, operations } = useWaterData();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [q, setQ] = useState('');
  const [inspect, setInspect] = useState<DeliveryRecord | null>(null);

  const rows = useMemo(() => deliveries.filter(d =>
    (filter === 'All' || d.status === filter) &&
    (!q.trim() || [d.id, d.communityName, d.vehicleNumber].some(v => v.toLowerCase().includes(q.toLowerCase())))
  ), [deliveries, filter, q]);

  const flagged = deliveries.filter(d => d.status === 'Mismatch' || d.status === 'Under Investigation');
  const verified = deliveries.filter(d => d.status === 'Verified').length;
  const variance = flagged.reduce((a, d) => a + Math.max(0, d.varianceAmount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Proof-of-Delivery Verification</h2>
        <p className="text-xs text-slate-500 mt-1">
          Each delivery is checked automatically: GPS within {operations?.geofenceRadiusM ?? '—'} m of the community and delivered volume within ±{operations?.varianceTolerancePct ?? '—'}% of allocation.
          Clean deliveries await officer sign-off; anything else is flagged.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="Verified" value={verified} subtitle={`of ${deliveries.length} deliveries`} icon={<ShieldCheck className="w-5 h-5" />} accentColor="emerald" />
        <KpiCard title="Flagged" value={flagged.length} subtitle="Geofence or volume variance" icon={<AlertTriangle className="w-5 h-5" />} accentColor="rose" />
        <KpiCard title="Short-delivered volume" value={litres(variance)} subtitle="Across flagged deliveries" icon={<Droplets className="w-5 h-5" />} accentColor="amber" />
      </div>

      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col md:flex-row gap-3 justify-between">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${filter === f ? 'bg-sky-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{f}</button>
          ))}
        </div>
        <div className="relative md:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search ID, community, tanker…" className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
          {deliveries.length === 0 ? 'No deliveries recorded yet. Drivers record proof of delivery from the driver app at each stop.' : 'No deliveries match.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map(d => {
            const flaggedRow = d.status === 'Mismatch' || d.status === 'Under Investigation';
            return (
              <div key={d.id} className={`p-4 rounded-2xl bg-white border shadow-subtle space-y-3 ${flaggedRow ? 'border-rose-200' : 'border-slate-200/90'}`}>
                <div className="flex items-start justify-between">
                  <div><h4 className="text-sm font-black text-slate-900">{d.id}</h4><p className="text-[11px] text-slate-500">{d.vehicleNumber} · {timeAgo(d.deliveryTime)}</p></div>
                  <StatusBadge status={d.status} />
                </div>
                <p className="text-xs font-bold text-slate-800">{d.communityName}</p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded-lg bg-slate-50"><p className="text-[10px] text-slate-400 uppercase">Allocated</p><p className="font-bold">{litres(d.allocatedAmount)}</p></div>
                  <div className="p-2 rounded-lg bg-slate-50"><p className="text-[10px] text-slate-400 uppercase">Delivered</p><p className="font-bold">{litres(d.deliveredAmount)}</p></div>
                  <div className={`p-2 rounded-lg ${d.varianceAmount !== 0 ? 'bg-rose-50' : 'bg-emerald-50'}`}><p className="text-[10px] text-slate-400 uppercase">Variance</p><p className={`font-bold ${d.varianceAmount !== 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{d.varianceAmount.toLocaleString('en-IN')} L</p></div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                  <span className={`px-2 py-0.5 rounded-full border ${d.gpsVerified ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                    <MapPin className="inline w-3 h-3" /> {d.geofenceDistanceM != null ? `${d.geofenceDistanceM} m from site` : 'no GPS'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full border ${d.officerVerified ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{d.officerVerified ? `Signed: ${d.verifiedBy}` : 'Awaiting sign-off'}</span>
                  {d.photoUrl && <span className="px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200"><Camera className="inline w-3 h-3" /> photo</span>}
                </div>
                {d.notes && <p className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2">{d.notes}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setInspect(d)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1"><Eye className="w-3.5 h-3.5" />Inspect</button>
                  {d.status !== 'Verified' && <button onClick={() => verifyDelivery(d.id)} className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1"><CheckSquare className="w-3.5 h-3.5" />Sign off</button>}
                  {d.status !== 'Under Investigation' && d.status !== 'Verified' && <button onClick={() => investigateDelivery(d.id)} className="flex-1 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">Investigate</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inspect && <InspectModal d={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
};

const InspectModal: React.FC<{ d: DeliveryRecord; onClose: () => void }> = ({ d, onClose }) => {
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!d.photoUrl) return;
    let url: string | null = null;
    api.deliveryPhoto(d.photoUrl).then(u => { url = u; setPhoto(u); }).catch(e => setErr(e.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [d.photoUrl]);
  return (
    <Modal isOpen onClose={onClose} title={`Delivery ${d.id}`} subtitle={`${d.communityName} · ${dateTime(d.deliveryTime)}`} maxWidth="lg">
      <div className="space-y-3 text-xs">
        <table className="w-full"><tbody className="divide-y divide-slate-100">
          {([
            ['Tanker', d.vehicleNumber], ['Recorded by', d.recordedBy], ['Allocated', litres(d.allocatedAmount)], ['Delivered', litres(d.deliveredAmount)],
            ['Variance', `${d.varianceAmount.toLocaleString('en-IN')} L`], ['Distance from community', d.geofenceDistanceM != null ? `${d.geofenceDistanceM} m` : 'No GPS fix'],
            ['Dispatch → delivery', d.tripMinutes != null ? `${d.tripMinutes} min` : '—'], ['Status', d.status], ['Verified by', d.verifiedBy || '—'],
          ] as [string, string][]).map(([k, v]) => <tr key={k}><td className="py-1.5 text-slate-500">{k}</td><td className="py-1.5 font-semibold text-slate-900 text-right">{v}</td></tr>)}
        </tbody></table>
        {d.notes && <p className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{d.notes}</p>}
        {d.photoUrl ? (photo ? <img src={photo} alt="Proof of delivery" className="w-full rounded-xl border border-slate-200" /> : <p className="text-slate-500">{err || 'Loading photo…'}</p>) : <p className="text-slate-400">No photo attached.</p>}
      </div>
    </Modal>
  );
};
