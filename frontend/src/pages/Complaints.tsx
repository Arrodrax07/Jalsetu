import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Link2, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, Chip, Dialog, Empty, Field, KindLabel, KV, Loading, OriginLabel, PageHeader, Panel, StatusChip } from '../components/ui';
import { COMPLAINT_CATEGORIES, type Complaint, type ComplaintAnalysis, type ComplaintCategory, type UrgencyLevel } from '../types';
import { dt, timeAgo } from '../utils/format';

const SEV: UrgencyLevel[] = ['Low', 'Medium', 'High', 'Critical'];

const Conf: React.FC<{ v: number }> = ({ v }) => (
  <span className="inline-flex items-center gap-1.5" title="Model confidence">
    <span className="h-1.5 w-12 rounded-full bg-cc-bg"><span className={`block h-full rounded-full ${v >= 0.75 ? 'bg-cc-ok' : v >= 0.5 ? 'bg-cc-warn' : 'bg-cc-danger'}`} style={{ width: `${v * 100}%` }} /></span>
    <span className="num text-2xs text-cc-muted">{Math.round(v * 100)}%</span>
  </span>
);

export const Complaints: React.FC = () => {
  const { complaints, can, communities } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState('All');
  const [showResolved, setShowResolved] = useState(false);
  const [lodge, setLodge] = useState(false);
  const rows = useMemo(() => complaints.filter(c => (showResolved || c.status !== 'Resolved') && (cat === 'All' || c.category === cat)), [complaints, cat, showResolved]);
  const current = complaints.find(c => c.id === sel) || null;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Complaints" subtitle="Multilingual triage model (English, Hinglish, हिंदी, मराठी) proposes category and severity with confidence; officers confirm or correct, and corrections train the next model."
        actions={<>
          <a className="text-sm text-cc-accent hover:underline" href="/report" target="_blank" rel="noreferrer">Citizen portal ↗</a>
          {can('manage_complaints') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setLodge(true)}>Lodge complaint</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option>All</option>{COMPLAINT_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm text-cc-muted"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Include resolved</label>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel bodyClassName="overflow-x-auto">
          {rows.length === 0 ? <Empty title="No complaints" /> : (
            <table className="table-cc">
              <thead><tr><th>Ticket</th><th>Community</th><th>Category</th><th>Severity</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>{rows.map(c => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setSel(c.id)}>
                  <td className="font-medium">{c.id} {c.duplicateOf && <Link2 className="inline h-3 w-3 text-amber-800" aria-label="possible duplicate" />}</td>
                  <td>{c.communityName}</td>
                  <td>{c.category} {c.labelVerified ? <CheckCircle2 className="inline h-3 w-3 text-green-700" aria-label="officer verified" /> : <Conf v={c.categoryConfidence} />}</td>
                  <td><StatusChip status={c.severity} /></td><td><StatusChip status={c.status} /></td><td className="text-cc-muted">{timeAgo(c.submittedAt)}</td>
                </tr>))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title={current ? current.id : 'Details'}>{current ? <ComplaintDetail c={current} /> : <Empty title="Select a complaint" />}</Panel>
      </div>
      {lodge && <LodgeDialog onClose={() => setLodge(false)} communities={communities} onCreated={id => setSel(id)} />}
    </div>
  );
};

const ComplaintDetail: React.FC<{ c: Complaint }> = ({ c }) => {
  const { can, fail, refresh } = useApp();
  const [officer, setOfficer] = useState(c.assignedOfficer || '');
  useEffect(() => setOfficer(c.assignedOfficer || ''), [c.id, c.assignedOfficer]);
  const upd = async (u: Parameters<typeof api.updateComplaint>[1]) => { try { await api.updateComplaint(c.id, u); refresh('complaints', 'overview'); } catch (e) { fail(e); } };
  return (
    <div className="space-y-3 text-sm">
      <p className="whitespace-pre-wrap rounded-lg border border-cc-border bg-cc-raised p-3">{c.description}</p>
      <div className="flex flex-wrap gap-2"><OriginLabel origin={c.dataOrigin} />{!c.labelVerified && <KindLabel kind="predicted" title="Model output awaiting officer confirmation" />}</div>
      <KV k="Community" v={c.communityName} />
      <KV k="Received" v={dt(c.submittedAt)} />
      <KV k="Category" v={<span className="flex items-center justify-end gap-2">{c.category}{!c.labelVerified && <Conf v={c.categoryConfidence} />}</span>} />
      <KV k="Severity" v={<span className="flex items-center justify-end gap-2">{c.severity}{!c.labelVerified && <Conf v={c.severityConfidence} />}</span>} />
      {c.duplicateOf && <KV k="Possible duplicate of" v={`${c.duplicateOf} (${Math.round(c.duplicateProbability * 100)}% similar)`} />}
      <p className="rounded-md border border-cc-accent/30 bg-cc-accent/5 p-2 text-xs">Suggested action: {c.recommendedAction}</p>
      {can('manage_complaints') && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={c.category} onChange={e => upd({ category: e.target.value as ComplaintCategory })} aria-label="Correct category">{COMPLAINT_CATEGORIES.map(x => <option key={x}>{x}</option>)}</select>
            <select className="input" value={c.severity} onChange={e => upd({ severity: e.target.value as UrgencyLevel })} aria-label="Correct severity">{SEV.map(x => <option key={x}>{x}</option>)}</select>
          </div>
          {!c.labelVerified ? <Button size="sm" className="w-full" onClick={() => upd({ confirmLabels: true })}>Labels are correct</Button> : <Chip tone="ok">Officer-verified · used for retraining</Chip>}
          <div className="flex gap-2"><input className="input" placeholder="Assign to officer" value={officer} onChange={e => setOfficer(e.target.value)} /><Button onClick={() => upd({ assignedOfficer: officer })} disabled={!officer.trim()}>Assign</Button></div>
          <div className="flex gap-2">
            {c.status !== 'Escalated' && c.status !== 'Resolved' && <Button variant="danger" className="flex-1" onClick={() => upd({ status: 'Escalated' })}>Escalate</Button>}
            {c.status !== 'Resolved' ? <Button variant="success" className="flex-1" onClick={() => upd({ status: 'Resolved' })}>Resolve</Button> : <Button className="flex-1" onClick={() => upd({ status: 'Pending' })}>Reopen</Button>}
          </div>
        </>
      )}
    </div>
  );
};

const LodgeDialog: React.FC<{ onClose: () => void; communities: { id: string; name: string; ward: string }[]; onCreated: (id: string) => void }> = ({ onClose, communities, onCreated }) => {
  const { fail, toast, refresh } = useApp();
  const [cid, setCid] = useState(communities[0]?.id || '');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [prev, setPrev] = useState<ComplaintAnalysis | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  useEffect(() => {
    if (text.trim().length < 8) { setPrev(null); return; }
    setState('busy');
    const t = setTimeout(() => api.analyzeComplaint(text, cid).then(r => { setPrev(r); setState('idle'); }).catch(() => { setPrev(null); setState('error'); }), 500);
    return () => clearTimeout(t);
  }, [text, cid]);
  const submit = async () => {
    try { const c = await api.createComplaint({ communityId: cid, description: text, reporterName: name, reporterPhone: phone }); toast('Complaint registered', `${c.id}: ${c.category}`, 'success'); refresh('complaints', 'overview'); onCreated(c.id); onClose(); }
    catch (e) { fail(e); }
  };
  return (
    <Dialog open onClose={onClose} title="Lodge complaint" subtitle="Write in any language. The triage model classifies it as you type.">
      <div className="space-y-3">
        <Field label="Community"><select className="input" value={cid} onChange={e => setCid(e.target.value)}>{communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>)}</select></Field>
        <Field label="Complaint"><textarea className="input" rows={4} value={text} onChange={e => setText(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2"><input className="input" placeholder="Reporter (optional)" value={name} onChange={e => setName(e.target.value)} /><input className="input" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        <div className="min-h-[64px] rounded-lg border border-cc-border bg-cc-raised p-3 text-xs">
          {state === 'busy' ? <Loading label="Classifying…" className="py-1" /> : state === 'error' ? <span className="text-amber-800">Triage model unavailable; the complaint can still be registered once it is restored.</span>
            : prev ? <div className="space-y-1"><div className="flex flex-wrap items-center gap-2"><KindLabel kind="predicted" /><b>{prev.category}</b> <Conf v={prev.categoryConfidence} /> <StatusChip status={prev.severity} />{prev.duplicateOf && <Chip tone="warn">possible duplicate of {prev.duplicateOf}</Chip>}</div><p className="text-cc-muted">{prev.recommendedAction}</p></div>
              : <span className="text-cc-faint">Type a few words to see the triage.</span>}
        </div>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={text.trim().length < 5 || !cid} onClick={submit}>Register</Button></div>
      </div>
    </Dialog>
  );
};
