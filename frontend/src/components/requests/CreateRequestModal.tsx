import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import type { AIAssessment, Community, NewWaterRequest } from '../../types';
import { useWaterData } from '../../context/WaterDataContext';
import { api } from '../../services/api';
import { Sparkles, CheckCircle, Calculator } from 'lucide-react';

interface CreateRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedCommunity?: Community | null;
}

export const FACTOR_LABELS: Record<string, string> = {
  demand: 'Demand severity',
  vulnerability: 'Vulnerability',
  unmetNeed: 'Unmet need',
  previousCoverage: 'Coverage gap (7 d)',
  population: 'Population',
};

export const AssessmentPanel: React.FC<{ a: AIAssessment }> = ({ a }) => (
  <div className="p-4 rounded-xl bg-sky-50/80 border border-sky-200 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 font-bold text-xs text-sky-900 uppercase tracking-wider">
        <Sparkles className="w-4 h-4 text-sky-600" /> Priority assessment
      </div>
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-600 text-white">{a.priorityScore}/100 · {a.urgency}</span>
    </div>
    <div className="space-y-1.5">
      {Object.entries(a.contributions).map(([k, pts]) => (
        <div key={k} className="text-[11px]">
          <div className="flex justify-between text-slate-600">
            <span>{FACTOR_LABELS[k] || k} <span className="text-slate-400">({(a.factors as any)[k]?.toFixed(0)}/100 × {Math.round(((a.weights as any)[k] || 0) * 100)}%)</span></span>
            <span className="font-semibold text-slate-800">+{(pts as number).toFixed(1)}</span>
          </div>
          <div className="w-full bg-white h-1.5 rounded-full overflow-hidden border border-sky-100">
            <div className="bg-sky-500 h-full" style={{ width: `${Math.min(100, (pts as number) * 2.5)}%` }} />
          </div>
        </div>
      ))}
    </div>
    <p className="text-xs text-sky-950 bg-white/70 p-2.5 rounded-lg border border-sky-200/60 leading-relaxed">{a.reasoning}</p>
  </div>
);

const input = 'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium';

export const CreateRequestModal: React.FC<CreateRequestModalProps> = ({ isOpen, onClose, preselectedCommunity }) => {
  const { communities, createRequest, handleError } = useWaterData();
  const blank = (): NewWaterRequest => ({
    communityId: preselectedCommunity?.id || communities[0]?.id || '',
    requestedAmount: 10000,
    peopleCurrentlyServed: 0,
    reason: '',
    daysWithoutWater: 0,
    contactPerson: '',
    phone: '',
  });
  const [form, setForm] = useState<NewWaterRequest>(blank);
  const [assessment, setAssessment] = useState<AIAssessment | null>(null);
  const [busy, setBusy] = useState<'assess' | 'submit' | null>(null);

  useEffect(() => {
    if (isOpen) { setForm(blank()); setAssessment(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, preselectedCommunity?.id]);

  const set = <K extends keyof NewWaterRequest>(k: K, v: NewWaterRequest[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setAssessment(null);
  };
  const community = communities.find(c => c.id === form.communityId);
  const complete = form.reason.trim().length >= 3 && form.contactPerson.trim().length >= 2 && form.phone.trim().length >= 6;

  const analyze = async () => {
    setBusy('assess');
    try { setAssessment(await api.assessRequest(form)); } catch (e) { handleError(e, 'Assessment failed'); }
    setBusy(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('submit');
    const created = await createRequest(form);
    setBusy(null);
    if (created) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Community Water Request"
      subtitle="Priority is scored from live community data with transparent, admin-tunable weights." maxWidth="2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Community</label>
            <select value={form.communityId} onChange={(e) => set('communityId', e.target.value)} className={input} required>
              {communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Community snapshot</label>
            <div className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-100 text-slate-600">
              {community ? `${community.population.toLocaleString('en-IN')} residents · ${community.currentCoverage}% covered · vulnerability ${community.vulnerabilityScore}` : '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Water required (L)</label>
            <input type="number" min={100} step={100} value={form.requestedAmount} onChange={(e) => set('requestedAmount', Number(e.target.value))} required className={input} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">People currently served</label>
            <input type="number" min={0} value={form.peopleCurrentlyServed} onChange={(e) => set('peopleCurrentlyServed', Number(e.target.value))} className={input} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Days without adequate water</label>
            <input type="number" min={0} max={60} value={form.daysWithoutWater} onChange={(e) => set('daysWithoutWater', Number(e.target.value))} className={input} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Reason</label>
          <textarea rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} required minLength={3}
            placeholder="e.g. feeder line ruptured, standposts dry; health centre needs supply" className={input} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contact person / community rep</label>
            <input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} required minLength={2} className={input} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contact phone</label>
            <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} required minLength={6} className={input} />
          </div>
        </div>

        <button type="button" onClick={analyze} disabled={busy !== null || !complete}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 disabled:opacity-50 text-white text-xs font-bold shadow-card">
          {busy === 'assess' ? <><Calculator className="w-4 h-4 animate-spin" /> Scoring…</> : <><Sparkles className="w-4 h-4 text-sky-200" /> Preview priority assessment</>}
        </button>

        {assessment && <AssessmentPanel a={assessment} />}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
          <button type="submit" disabled={busy !== null || !complete}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-sm">
            <CheckCircle className="w-4 h-4" /> {busy === 'submit' ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
