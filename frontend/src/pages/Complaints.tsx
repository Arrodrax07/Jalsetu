import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, MessageSquare, AlertTriangle, CheckCircle2, Sparkles, Search, Filter, ShieldAlert, UserCheck, Plus, Link2, Tag, Loader2 } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { KpiCard } from '../components/common/KpiCard';
import { Modal } from '../components/common/Modal';
import { api } from '../services/api';
import { COMPLAINT_CATEGORIES, type Complaint, type ComplaintAnalysis, type ComplaintCategory, type UrgencyLevel } from '../types';
import { dateTime, timeAgo } from '../utils/format';

const SEVERITIES: UrgencyLevel[] = ['Low', 'Medium', 'High', 'Critical'];
const input = 'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500';

const ConfidenceBar: React.FC<{ value: number }> = ({ value }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
      <div className={`h-full ${value >= 0.75 ? 'bg-emerald-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${value * 100}%` }} />
    </div>
    <span className="text-[10px] font-semibold text-slate-600 w-9 text-right">{Math.round(value * 100)}%</span>
  </div>
);

export const Complaints: React.FC = () => {
  const { complaints, updateComplaint, communities, currentUser } = useWaterData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('All');
  const [showResolved, setShowResolved] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLodgeOpen, setIsLodgeOpen] = useState(false);
  const [assignee, setAssignee] = useState('');

  const selected = complaints.find(c => c.id === selectedId) || null;
  useEffect(() => { if (!selectedId && complaints.length) setSelectedId(complaints[0].id); }, [complaints, selectedId]);
  useEffect(() => { setAssignee(selected?.assignedOfficer || currentUser?.name || ''); }, [selected?.id, selected?.assignedOfficer, currentUser?.name]);

  const filtered = useMemo(() => complaints.filter(c => {
    if (!showResolved && c.status === 'Resolved') return false;
    if (filterCategory !== 'All' && c.category !== filterCategory) return false;
    const q = searchQuery.trim().toLowerCase();
    return !q || c.id.toLowerCase().includes(q) || c.communityName.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  }), [complaints, filterCategory, searchQuery, showResolved]);

  const open = complaints.filter(c => c.status !== 'Resolved');
  const critical = open.filter(c => c.severity === 'Critical').length;
  const dup = complaints.filter(c => c.duplicateOf).length;
  const lowConf = open.filter(c => !c.labelVerified && c.categoryConfidence < 0.6).length;
  const sameCommunityOpen = selected ? open.filter(c => c.communityId === selected.communityId).length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Complaint Intelligence</h2>
          <p className="text-xs text-slate-500 mt-1">
            Multilingual triage model (English, Hinglish, हिंदी, मराठी) classifies category & severity and links duplicates. Officer corrections become training data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/report" target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">Citizen portal ↗</a>
          <button onClick={() => setIsLodgeOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card">
            <Plus className="w-4 h-4" /> Lodge complaint
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Open complaints" value={open.length} icon={<MessageSquare className="w-5 h-5" />} accentColor="brand" />
        <KpiCard title="Critical severity" value={critical} subtitle="Auto-escalated on intake" icon={<ShieldAlert className="w-5 h-5" />} accentColor="rose" />
        <KpiCard title="Duplicates linked" value={dup} subtitle="Same community, last 72 h" icon={<Link2 className="w-5 h-5" />} accentColor="amber" />
        <KpiCard title="Needs review" value={lowConf} subtitle="Model confidence < 60%" icon={<AlertCircle className="w-5 h-5" />} accentColor="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
              {['All', ...COMPLAINT_CATEGORIES].map(cat => (
                <button key={cat} onClick={() => setFilterCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${filterCategory === cat ? 'bg-sky-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-slate-600 whitespace-nowrap">
                <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Resolved
              </label>
              <div className="relative w-full md:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="search" placeholder="Search…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className={`${input} pl-9`} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Ticket</th><th className="px-4 py-3">Community</th><th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No complaints match.</td></tr>}
                  {filtered.map(c => (
                    <tr key={c.id} onClick={() => setSelectedId(c.id)} className={`cursor-pointer hover:bg-slate-50 ${selectedId === c.id ? 'bg-sky-50/60' : ''}`}>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">{c.id}{c.duplicateOf && <Link2 className="w-3 h-3 text-amber-500" />}{c.source === 'citizen' && <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-700">citizen</span>}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{c.communityName}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.category}
                        {!c.labelVerified && c.categoryConfidence < 0.6 && <span className="ml-1 text-[9px] text-amber-600 font-bold">?</span>}
                        {c.labelVerified && <CheckCircle2 className="inline w-3 h-3 ml-1 text-emerald-500" />}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={c.severity} /></td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-slate-500" title={dateTime(c.submittedAt)}>{timeAgo(c.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {!selected ? (
            <div className="p-6 bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">Select a complaint to see its analysis.</div>
          ) : (
            <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-900">{selected.id}</h3>
                  <p className="text-[11px] text-slate-500">{selected.communityName} · {dateTime(selected.submittedAt)}{selected.reporterName ? ` · ${selected.reporterName}` : ''}</p>
                </div>
                <StatusBadge status={selected.status} size="md" />
              </div>
              <p className="text-xs text-slate-700 leading-relaxed p-3 rounded-xl bg-slate-50 border border-slate-200 whitespace-pre-wrap">{selected.description}</p>

              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-900"><Sparkles className="w-3.5 h-3.5 text-sky-600" /> Model output</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Category</span>
                    <p className="font-bold text-slate-900">{selected.category}</p>
                    <ConfidenceBar value={selected.categoryConfidence} />
                  </div>
                  <div className="p-2 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Severity</span>
                    <p className="font-bold text-slate-900">{selected.severity}</p>
                    <ConfidenceBar value={selected.severityConfidence} />
                  </div>
                </div>
                {selected.duplicateOf && (
                  <button onClick={() => setSelectedId(selected.duplicateOf)} className="w-full text-left text-xs p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                    <Link2 className="inline w-3.5 h-3.5 mr-1" /> Likely duplicate of <strong>{selected.duplicateOf}</strong> ({Math.round(selected.duplicateProbability * 100)}% similar)
                  </button>
                )}
                <p className="text-[11px] text-slate-500">{sameCommunityOpen} open complaint(s) from {selected.communityName}; {selected.similarComplaintsCount} of the same category in 72 h.</p>
              </div>

              <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-950 leading-relaxed">
                <span className="font-bold">Recommended action: </span>{selected.recommendedAction}
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700"><Tag className="w-3.5 h-3.5" /> Confirm or correct labels</div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={selected.category} onChange={e => updateComplaint(selected.id, { category: e.target.value as ComplaintCategory })} className={input} aria-label="Category">
                    {COMPLAINT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <select value={selected.severity} onChange={e => updateComplaint(selected.id, { severity: e.target.value as UrgencyLevel })} className={input} aria-label="Severity">
                    {SEVERITIES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {!selected.labelVerified ? (
                  <button onClick={() => updateComplaint(selected.id, { confirmLabels: true })} className="w-full py-1.5 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold">
                    Labels are correct
                  </button>
                ) : <p className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Verified — included in next retraining</p>}
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex gap-2">
                  <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Officer name" className={input} />
                  <button onClick={() => updateComplaint(selected.id, { assignedOfficer: assignee })} disabled={!assignee.trim()}
                    className="px-3 rounded-xl bg-slate-900 text-white text-xs font-bold whitespace-nowrap disabled:opacity-50 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" />Assign</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => updateComplaint(selected.id, { status: 'Escalated' })} disabled={selected.status === 'Escalated' || selected.status === 'Resolved'}
                    className="py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Escalate</button>
                  {selected.status === 'Resolved' ? (
                    <button onClick={() => updateComplaint(selected.id, { status: 'Pending' })} className="py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Reopen</button>
                  ) : (
                    <button onClick={() => updateComplaint(selected.id, { status: 'Resolved' })} className="py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Resolve</button>
                  )}
                </div>
                {selected.assignedOfficer && <p className="text-[11px] text-slate-500">Assigned to {selected.assignedOfficer}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <LodgeComplaintModal isOpen={isLodgeOpen} onClose={() => setIsLodgeOpen(false)} onCreated={(c) => setSelectedId(c.id)} communities={communities} />
    </div>
  );
};

const LodgeComplaintModal: React.FC<{ isOpen: boolean; onClose: () => void; onCreated: (c: Complaint) => void; communities: { id: string; name: string; ward: string }[] }> = ({ isOpen, onClose, onCreated, communities }) => {
  const { createComplaint } = useWaterData();
  const [communityId, setCommunityId] = useState('');
  const [text, setText] = useState('');
  const [reporter, setReporter] = useState('');
  const [phone, setPhone] = useState('');
  const [preview, setPreview] = useState<ComplaintAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (isOpen) { setCommunityId(communities[0]?.id || ''); setText(''); setReporter(''); setPhone(''); setPreview(null); } }, [isOpen, communities]);

  // Live triage preview, debounced.
  useEffect(() => {
    if (text.trim().length < 8) { setPreview(null); return; }
    setAnalyzing(true);
    const t = setTimeout(() => {
      api.analyzeComplaint(text, communityId).then(setPreview).catch(() => setPreview(null)).finally(() => setAnalyzing(false));
    }, 500);
    return () => clearTimeout(t);
  }, [text, communityId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const c = await createComplaint({ communityId, description: text, reporterName: reporter, reporterPhone: phone });
    setBusy(false);
    if (c) { onCreated(c); onClose(); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Lodge Complaint" subtitle="Write in any language. The model triages it as you type." maxWidth="xl">
      <form onSubmit={submit} className="space-y-3">
        <select value={communityId} onChange={e => setCommunityId(e.target.value)} className={input} required>
          {communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>)}
        </select>
        <textarea rows={4} value={text} onChange={e => setText(e.target.value)} required minLength={5} className={input}
          placeholder="e.g. 3 din se pani nahi aaya, bachche beemar hain / टँकर अजून आला नाही" />
        <div className="grid grid-cols-2 gap-3">
          <input value={reporter} onChange={e => setReporter(e.target.value)} placeholder="Reporter name (optional)" className={input} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" className={input} />
        </div>
        <div className="p-3 rounded-xl border border-sky-200 bg-sky-50/70 min-h-[64px] text-xs">
          {analyzing ? <span className="flex items-center gap-2 text-sky-700"><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing…</span>
            : preview ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-bold text-sky-900">{preview.category}</span><span className="text-slate-500">({Math.round(preview.categoryConfidence * 100)}%)</span>
                  <StatusBadge status={preview.severity} />
                  {preview.duplicateOf && <span className="text-amber-700 font-semibold">Possible duplicate of {preview.duplicateOf}</span>}
                </div>
                <p className="text-slate-600">{preview.recommendedAction}</p>
              </div>
            ) : <span className="text-slate-400">Type at least a few words to see the live triage.</span>}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl">{busy ? 'Saving…' : 'Register complaint'}</button>
        </div>
      </form>
    </Modal>
  );
};
