import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from '../components/icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, Chip, Dialog, Empty, Field, KindLabel, KV, OriginLabel, PageHeader, StatusChip } from '../components/ui';
import { DataTable, type FilterDef } from '../components/DataTable';
import type { AIAssessment, NewWaterRequest, PriorityFactors, WaterRequest } from '../types';
import { dt, litres, timeAgo } from '../utils/format';

export const FACTOR_LABELS: Record<keyof PriorityFactors, string> = {
  demand: 'Demand severity', vulnerability: 'Socio-economic vulnerability', unmetNeed: 'Unmet need / days without water',
  previousCoverage: 'Coverage gap (last 7 days)', population: 'Population impacted', liveCrisis: 'Live crisis signals (news + rainfall)',
  waterAccess: 'Distance to nearest water source',
};

/** Level + the top reasons, never a bare number. */
export const PriorityBadge: React.FC<{ a: AIAssessment | null; score: number }> = ({ a, score }) => {
  const level = a?.urgency || (score >= 75 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Medium' : 'Low');
  const top = a ? (Object.entries(a.contributions) as [keyof PriorityFactors, number][]).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => FACTOR_LABELS[k].split(' ')[0].toLowerCase()) : [];
  return (
    <span className="inline-flex flex-col">
      <StatusChip status={level} label={level} />
      {top.length > 0 && <span className="mt-0.5 hidden text-2xs text-cc-muted sm:block">driven by {top.join(' + ')}</span>}
    </span>
  );
};

export const AssessmentView: React.FC<{ a: AIAssessment }> = ({ a }) => (
  <div className="space-y-2 rounded-lg border border-cc-border bg-cc-raised p-3">
    <div className="flex items-center justify-between"><p className="text-sm font-semibold">{a.urgency} priority · score {a.priorityScore}/100</p><KindLabel kind="rule-based" title="Weighted factors; weights are set by the administrator" /></div>
    {(Object.entries(a.contributions) as [keyof PriorityFactors, number][]).sort((x, y) => y[1] - x[1]).map(([k, pts]) => (
      <div key={k} className="text-xs">
        <div className="flex justify-between text-cc-muted"><span>{FACTOR_LABELS[k]} <span className="text-cc-faint">({Math.round(a.factors[k] ?? 0)}/100 × {Math.round((a.weights as any)[k] * 100)}%)</span></span><span className="num text-cc-text">+{pts.toFixed(1)}</span></div>
        <div className="mt-0.5 h-1.5 rounded-full bg-cc-bg"><div className="h-full rounded-full bg-cc-accent" style={{ width: `${Math.min(100, pts * 2.5)}%` }} /></div>
      </div>
    ))}
    <p className="text-xs leading-relaxed text-cc-muted">{a.reasoning}</p>
  </div>
);

const LANG_NAME = { en: 'English', mr: 'Marathi', hi: 'Hindi' } as const;
/** "Citizen portal · Marathi · voice", or "Staff" for requests entered by an operator or field worker. */
const sourceLabel = (r: WaterRequest) => r.source === 'citizen'
  ? ['Citizen portal', r.language && r.language !== 'en' ? LANG_NAME[r.language] : null, r.inputMode === 'voice' ? 'voice' : null, r.queuedAt ? 'sent later (offline)' : null].filter(Boolean).join(' · ')
  : 'Staff';

const STATUS_FILTERS: FilterDef<WaterRequest>[] = [
  { id: 'open', label: 'Open', test: r => ['Pending', 'Allocated', 'Dispatched'].includes(r.status) },
  ...(['Pending', 'Allocated', 'Dispatched', 'Delivered', 'Merged', 'Rejected'] as const).map(s => ({ id: s, label: s, test: (r: WaterRequest) => r.status === s })),
  { id: 'citizen', label: 'From citizens', test: r => r.source === 'citizen' },
  { id: 'all', label: 'All', test: () => true },
];

export const Requests: React.FC = () => {
  const { requests, can, fail, refresh } = useApp();
  const [sel, setSel] = useState<WaterRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const merged = useMemo(() => requests.filter(r => r.status === 'Merged').length, [requests]);
  const setReqStatus = async (r: WaterRequest, s: 'Allocated' | 'Rejected' | 'Pending') => {
    try { await api.setRequestStatus(r.id, s); refresh('requests', 'overview'); setSel(null); } catch (e) { fail(e); }
  };
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Water requests" subtitle="Requests from communities and ward offices, ranked by an explainable priority model. Approving an allocation plan moves pending requests to Allocated; dispatch moves them to Dispatched; verified delivery fulfils them."
        actions={can('manage_requests') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New request</Button>} />
      <DataTable label="Water requests" rows={requests} rowKey={r => r.id} onRowClick={setSel} selectedKey={sel?.id}
        filters={STATUS_FILTERS} defaultSort={{ id: 'priority', dir: 'desc' }}
        search={r => `${r.id} ${r.communityName} ${r.reason} ${r.contactPerson}`} searchPlaceholder="Search requests, places, callers"
        toolbar={merged > 0 ? <span className="text-[12px] text-cc-muted">{merged} repeat request{merged === 1 ? '' : 's'} merged</span> : undefined}
        emptyTitle="No requests in this view" emptyHint="New requests from ward offices and communities appear here, ranked by priority."
        expand={r => (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-1 text-[13px]"><p className="text-cc-muted">Reason</p><p>{r.reason}</p>
              <p className="pt-2 text-cc-muted">Contact</p><p>{r.contactPerson} · <span className="mono">{r.phone}</span></p>
              <p className="pt-2 text-cc-muted">Source</p><p>{sourceLabel(r)}{r.peopleAffected ? ` · ${r.peopleAffected} people` : ''}</p>
              {r.duplicateReason && <p className="pt-2 text-[12px] text-cc-muted">{r.duplicateReason}</p>}</div>
            {r.aiAssessment ? <AssessmentView a={r.aiAssessment} /> : <p className="text-[12.5px] text-cc-muted">No assessment stored.</p>}
          </div>
        )}
        columns={[
          { id: 'id', header: 'Request', hideBelow: 'sm', sort: r => r.dbId, cell: r => <span className="mono font-medium">{r.id}</span> },
          { id: 'community', header: 'Place', sort: r => r.communityName, cell: r => <span className="font-medium">{r.communityName}<span className="mono block text-2xs font-normal text-cc-faint sm:hidden">{r.id}</span></span> },
          { id: 'priority', header: 'Priority', sort: r => r.priorityScore, cell: r => <PriorityBadge a={r.aiAssessment} score={r.priorityScore} /> },
          { id: 'litres', header: 'Litres', align: 'right', hideBelow: 'sm', sort: r => r.requestedAmount, cell: r => <span className="mono">{litres(r.requestedAmount)}</span> },
          { id: 'dry', header: 'Days dry', align: 'right', sort: r => r.daysWithoutWater, hideBelow: 'md', cell: r => <span className="mono">{r.daysWithoutWater}</span> },
          { id: 'status', header: 'Status', sort: r => r.status, cell: r => <StatusChip status={r.status} label={r.status === 'Merged' ? `Merged into ${r.duplicateOf}` : undefined} /> },
          { id: 'source', header: 'From', sort: r => r.source ?? 'staff', hideBelow: 'lg', cell: r => r.source === 'citizen'
            ? <span className="rounded-full bg-cc-accent/10 px-2 py-0.5 text-[11.5px] font-medium text-cc-accent-strong" title={sourceLabel(r)}>Citizen</span>
            : <span className="text-[12px] text-cc-muted">Staff</span> },
          { id: 'when', header: 'Received', sort: r => Date.parse(r.submittedAt), hideBelow: 'lg', cell: r => <span className="text-cc-muted">{timeAgo(r.submittedAt)}</span> },
          { id: 'origin', header: 'Record', hideBelow: 'xl', cell: r => <OriginLabel origin={r.dataOrigin} /> },
        ]} />
      {sel && (
        <Dialog open onClose={() => setSel(null)} title={`Request ${sel.id}`} subtitle={`${sel.communityName} · ${dt(sel.submittedAt)}`} wide>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <KV k="Status" v={<StatusChip status={sel.status} />} />
              <KV k="Requested" v={<span className="num">{litres(sel.requestedAmount)}</span>} />
              <KV k="Days without water" v={sel.daysWithoutWater} />
              <KV k="Contact" v={`${sel.contactPerson} · ${sel.phone}`} />
              <KV k="Source" v={sourceLabel(sel)} />
              {sel.peopleAffected ? <KV k="People needing water" v={sel.peopleAffected} /> : null}
              <KV k="Record" v={<OriginLabel origin={sel.dataOrigin} />} />
              {sel.fulfilledAt && <KV k="Fulfilled" v={dt(sel.fulfilledAt)} />}
              {sel.duplicateOf && <KV k="Merged into" v={sel.duplicateOf} />}
              {sel.duplicateReason && <p className="mt-2 rounded-lg bg-cc-raised p-2 text-xs text-cc-muted">{sel.duplicateReason}</p>}
              <p className="mt-3 text-sm">{sel.reason}</p>
            </div>
            {sel.aiAssessment ? <AssessmentView a={sel.aiAssessment} /> : <Empty title="No assessment" />}
          </div>
          {can('manage_requests') && sel.status === 'Merged' && (
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-cc-border pt-3">
              <p className="text-xs text-cc-muted">If this is really a separate need (another part of the village, a second source failing), split it out.</p>
              <Button onClick={() => setReqStatus(sel, 'Pending')}>Split into its own request</Button>
            </div>
          )}
          {can('manage_requests') && sel.status === 'Pending' && (
            <div className="mt-4 flex justify-end gap-2 border-t border-cc-border pt-3">
              <Button variant="danger" onClick={() => setReqStatus(sel, 'Rejected')}>Reject</Button>
              <Button variant="primary" onClick={() => setReqStatus(sel, 'Allocated')}>Mark allocated</Button>
            </div>
          )}
        </Dialog>
      )}
      <NewRequestDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
};

const NewRequestDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { communities, fail, toast, refresh } = useApp();
  const blank: NewWaterRequest = { communityId: '', requestedAmount: 5000, peopleCurrentlyServed: 0, reason: '', daysWithoutWater: 0, contactPerson: '', phone: '' };
  const [f, setF] = useState<NewWaterRequest>(blank);
  const [a, setA] = useState<AIAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ ...blank, communityId: communities[0]?.id || '' }); setA(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = <K extends keyof NewWaterRequest>(k: K, v: NewWaterRequest[K]) => { setF(x => ({ ...x, [k]: v })); setA(null); };
  const complete = f.communityId && f.reason.trim().length >= 3 && f.contactPerson.trim().length >= 2 && f.phone.trim().length >= 6;
  const preview = async () => { try { setA(await api.assessRequest(f)); } catch (e) { fail(e); } };
  const submit = async (allowDuplicate = false) => {
    setBusy(true);
    try {
      const r = await api.createRequest({ ...f, allowDuplicate });
      if (r.status === 'Merged') toast('Merged with an open request', `${r.id} repeats ${r.duplicateOf}; the larger amount is kept there.`, 'info');
      else toast('Request created', `${r.id}: ${r.urgency} priority`, 'success'); await refresh('requests', 'overview'); onClose(); } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onClose={onClose} title="New water request" wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Community" className="col-span-2"><select className="input" value={f.communityId} onChange={e => set('communityId', e.target.value)}>
            {communities.map(c => <option key={c.id} value={c.id}>{c.name} · {c.districtName || c.ward}{c.dataOrigin === 'seeded' ? ' (reference)' : ''}</option>)}</select></Field>
          <Field label="Litres required"><input className="input" type="number" min={100} step={100} value={f.requestedAmount} onChange={e => set('requestedAmount', Number(e.target.value))} /></Field>
          <Field label="Days without water"><input className="input" type="number" min={0} max={60} value={f.daysWithoutWater} onChange={e => set('daysWithoutWater', Number(e.target.value))} /></Field>
          <Field label="People currently served" className="col-span-2"><input className="input" type="number" min={0} value={f.peopleCurrentlyServed} onChange={e => set('peopleCurrentlyServed', Number(e.target.value))} /></Field>
          <Field label="Reason" className="col-span-2"><textarea className="input" rows={2} value={f.reason} onChange={e => set('reason', e.target.value)} /></Field>
          <Field label="Contact person"><input className="input" value={f.contactPerson} onChange={e => set('contactPerson', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          {a?.possibleDuplicateOf && (
            <div role="alert" className="rounded-xl border border-cc-warn/40 bg-cc-warn/[0.07] p-3 text-sm text-amber-900">
              <p className="font-semibold">Open request {a.possibleDuplicateOf} already covers this place</p>
              <p className="mt-0.5 text-xs leading-relaxed">Raised within the last {a.duplicateWindowHours} h. Creating this request merges it there (the larger amount is kept) so the same need is not served twice.</p>
            </div>
          )}
          {a ? <AssessmentView a={a} /> : <p className="text-sm text-cc-muted">Preview the priority to see exactly which factors drive it, and whether the place already has an open request.</p>}
          <div className="flex flex-wrap gap-2"><Button disabled={!complete} onClick={preview}>Preview priority</Button>
            <Button variant="primary" disabled={!complete} loading={busy} onClick={() => submit(false)}>{a?.possibleDuplicateOf ? 'Merge into open request' : 'Create request'}</Button>
            {a?.possibleDuplicateOf && <Button disabled={!complete || busy} onClick={() => submit(true)}>It is a separate need</Button>}</div>
          <Chip tone="accent">Priority is computed on the server from current community records</Chip>
        </div>
      </div>
    </Dialog>
  );
};
