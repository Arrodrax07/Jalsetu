import React, { useEffect, useState } from 'react';
import { Search, MapPin, Phone, Plus, Pencil, Loader2 } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { Modal } from '../components/common/Modal';
import { api } from '../services/api';
import type { Community } from '../types';
import { dateTime, litres, timeAgo } from '../utils/format';

const input = 'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20';

export const Communities: React.FC = () => {
  const { communities, selectedCommunity, setSelectedCommunity, currentUser } = useWaterData();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Community | 'new' | null>(null);
  const isAdmin = currentUser?.role === 'admin';

  const rows = communities.filter(c => !q.trim() || [c.name, c.ward, c.contactOfficer].some(v => v.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Communities</h2>
          <p className="text-xs text-slate-500 mt-1">{communities.length} service clusters. Coverage, status and priority are computed live from allocations, deliveries and complaints.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-60">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" placeholder="Search community, ward, officer…" value={q} onChange={e => setQ(e.target.value)} className={`${input} pl-9 bg-white`} />
          </div>
          {isAdmin && <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"><Plus className="w-4 h-4" />Add</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.map(c => (
          <button key={c.id} onClick={() => setSelectedCommunity(c)} className="text-left p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle hover:shadow-card hover:border-slate-300 transition-all space-y-3">
            <div className="flex items-start justify-between">
              <div><h3 className="text-sm font-black text-slate-900">{c.name}</h3><p className="text-[11px] text-slate-500">{c.ward}</p></div>
              <StatusBadge status={c.status} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded-lg bg-slate-50"><p className="text-[10px] text-slate-400 uppercase">Population</p><p className="font-bold">{c.population.toLocaleString('en-IN')}</p></div>
              <div className="p-2 rounded-lg bg-slate-50"><p className="text-[10px] text-slate-400 uppercase">Vulnerability</p><p className="font-bold">{c.vulnerabilityScore}</p></div>
              <div className="p-2 rounded-lg bg-slate-50"><p className="text-[10px] text-slate-400 uppercase">Priority</p><p className="font-bold text-sky-700">{c.priorityScore}</p></div>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-slate-600 mb-1"><span>Coverage {c.currentCoverage}%</span><span>short {litres(c.shortfall)}</span></div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${c.currentCoverage >= 85 ? 'bg-emerald-500' : c.currentCoverage >= 65 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${c.currentCoverage}%` }} /></div>
            </div>
            <p className="text-[11px] text-slate-500">Last delivery {timeAgo(c.lastDelivery)} · {c.openComplaints} open complaint(s)</p>
          </button>
        ))}
      </div>

      {selectedCommunity && <CommunityDetail c={communities.find(x => x.id === selectedCommunity.id) || selectedCommunity} onClose={() => setSelectedCommunity(null)} onEdit={isAdmin ? (c) => { setSelectedCommunity(null); setEditing(c); } : undefined} />}
      {editing && <CommunityForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

const CommunityDetail: React.FC<{ c: Community; onClose: () => void; onEdit?: (c: Community) => void }> = ({ c, onClose, onEdit }) => {
  const { requests, complaints, deliveries } = useWaterData();
  const [fc, setFc] = useState<{ weatherSource: string; days: any[] } | null>(null);
  const [fcErr, setFcErr] = useState<string | null>(null);
  useEffect(() => { api.communityForecast(c.id, 7).then(setFc).catch(e => setFcErr(e.message)); }, [c.id]);

  const reqs = requests.filter(r => r.communityId === c.id).slice(0, 5);
  const comps = complaints.filter(x => x.communityId === c.id).slice(0, 5);
  const dels = deliveries.filter(d => d.communityId === c.id).slice(0, 5);

  return (
    <Modal isOpen onClose={onClose} title={c.name} subtitle={`${c.ward} · ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`} maxWidth="3xl">
      <div className="space-y-4 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([['Daily demand', litres(c.dailyDemand)], ['Allocated', `${litres(c.allocatedWater)} (${c.currentCoverage}%)`], ['Shortfall', litres(c.shortfall)], ['Priority', `${c.priorityScore}/100`]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100"><p className="text-[10px] uppercase font-bold text-slate-400">{k}</p><p className="font-bold text-slate-900">{v}</p></div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-slate-600">
          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />Vulnerability {c.vulnerabilityScore} ({c.vulnerability})</span>
          {c.contactOfficer && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{c.contactOfficer} {c.officerPhone}</span>}
          {onEdit && <button onClick={() => onEdit(c)} className="ml-auto flex items-center gap-1 text-sky-700 font-semibold"><Pencil className="w-3.5 h-3.5" />Edit</button>}
        </div>

        <div className="p-3 rounded-xl border border-sky-200 bg-sky-50/60">
          <p className="font-bold text-sky-900 mb-2">7-day demand forecast {fc && <span className="font-normal text-slate-500">(weather: {fc.weatherSource})</span>}</p>
          {fcErr ? <p className="text-rose-700">{fcErr}</p> : !fc ? <p className="flex items-center gap-1 text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</p> : (
            <div className="grid grid-cols-7 gap-1 text-center">
              {fc.days.map((d: any) => (
                <div key={d.date} className="p-1.5 rounded-lg bg-white border border-sky-100">
                  <p className="text-[10px] text-slate-500">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                  <p className="font-bold text-slate-900">{Math.round(d.litres_p50 / 1000)}k</p>
                  <p className="text-[10px] text-slate-500">{d.temp_max}° · {d.precip_mm}mm</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <List title="Requests" empty="No requests" items={reqs.map(r => ({ k: r.id, a: `${r.id} · ${litres(r.requestedAmount)}`, b: `${r.status} · ${timeAgo(r.submittedAt)}` }))} />
          <List title="Complaints" empty="No complaints" items={comps.map(x => ({ k: x.id, a: `${x.id} · ${x.category}`, b: `${x.severity} · ${x.status}` }))} />
          <List title="Deliveries" empty="No deliveries" items={dels.map(d => ({ k: d.id, a: `${d.id} · ${litres(d.deliveredAmount)}`, b: `${d.status} · ${dateTime(d.deliveryTime)}` }))} />
        </div>
      </div>
    </Modal>
  );
};

const List: React.FC<{ title: string; empty: string; items: { k: string; a: string; b: string }[] }> = ({ title, empty, items }) => (
  <div className="p-3 rounded-xl border border-slate-200">
    <p className="font-bold text-slate-800 mb-1.5">{title}</p>
    {items.length === 0 ? <p className="text-slate-400">{empty}</p> : items.map(i => <div key={i.k} className="py-1 border-b border-slate-50 last:border-0"><p className="font-semibold text-slate-800">{i.a}</p><p className="text-[10px] text-slate-500">{i.b}</p></div>)}
  </div>
);

const CommunityForm: React.FC<{ initial: Community | null; onClose: () => void }> = ({ initial, onClose }) => {
  const { refresh, handleError, addToast } = useWaterData();
  const [f, setF] = useState({
    name: initial?.name || '', ward: initial?.ward || '', population: initial?.population || 1000, dailyDemand: initial?.dailyDemand || 10000,
    allocatedWater: initial?.allocatedWater || 0, vulnerabilityScore: initial?.vulnerabilityScore ?? 50, lat: initial?.lat ?? 19.06, lng: initial?.lng ?? 72.89,
    contactOfficer: initial?.contactOfficer || '', officerPhone: initial?.officerPhone || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: typeof s[k] === 'number' ? Number(v) : v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (initial) await api.updateCommunity(initial.id, f); else await api.createCommunity(f);
      addToast(initial ? 'Community updated' : 'Community added', f.name, 'success');
      await refresh('communities', 'dashboard');
      onClose();
    } catch (err) { handleError(err, 'Could not save community'); }
    setBusy(false);
  };

  const field = (k: keyof typeof f, label: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <div><label className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</label><input type={type} value={f[k] as any} onChange={e => set(k, e.target.value)} className={input} required={k === 'name' || k === 'ward'} {...extra} /></div>
  );

  return (
    <Modal isOpen onClose={onClose} title={initial ? `Edit ${initial.name}` : 'Add community'} subtitle="Vulnerability score: 0–100 from census / socio-economic survey (higher = more vulnerable)." maxWidth="xl">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {field('name', 'Name')}{field('ward', 'Ward')}
        {field('population', 'Population', 'number', { min: 1 })}{field('dailyDemand', 'Baseline daily demand (L)', 'number', { min: 1 })}
        {field('allocatedWater', 'Current allocation (L/day)', 'number', { min: 0 })}{field('vulnerabilityScore', 'Vulnerability score', 'number', { min: 0, max: 100 })}
        {field('lat', 'Latitude', 'number', { step: 'any', min: -90, max: 90 })}{field('lng', 'Longitude', 'number', { step: 'any', min: -180, max: 180 })}
        {field('contactOfficer', 'Contact officer')}{field('officerPhone', 'Officer phone')}
        <div className="col-span-2 flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-xl">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
};
