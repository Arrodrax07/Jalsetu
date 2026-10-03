/** Auto-dispatch proposals: the system suggests tanker -> community trips; a dispatcher approves or rejects each. */
import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, MapPin, Sparkles, Truck, X } from './icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import type { DispatchProposal } from '../types';
import { litres, timeAgo } from '../utils/format';
import { Button, Chip, cx, Empty, Panel } from './ui';

export const AutoDispatch: React.FC = () => {
  const { proposals, loaded, refresh, can, toast, fail, navigate } = useApp();
  const [busy, setBusy] = useState<number | 'run' | 'all' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { if (!loaded.has('proposals')) refresh('proposals'); }, [loaded, refresh]);

  const pending = useMemo(() => proposals.filter(p => p.status === 'Proposed').sort((a, b) => b.score - a.score), [proposals]);
  const history = useMemo(() => proposals.filter(p => p.status === 'Approved' || p.status === 'Rejected').slice(0, 15), [proposals]);
  const allowed = can('dispatch');

  const run = async () => {
    setBusy('run');
    try {
      const r = await api.propose();
      toast('Proposals ready', `${r.proposed} trip(s) proposed from ${r.candidates} places in need and ${r.tankersAvailable} available tanker(s)`, 'success');
      await refresh('proposals');
    } catch (e) { fail(e, 'Could not generate proposals'); }
    finally { setBusy(null); }
  };
  const approve = async (p: DispatchProposal) => {
    setBusy(p.id);
    try {
      const r = await api.approveProposal(p.id);
      toast('Trip dispatched', `${r.proposal.tripCode}: ${p.vehicleNumber} → ${p.stops.map(s => s.name).join(', ')}`, 'success');
      await refresh('proposals', 'trips', 'vehicles', 'overview');
    } catch (e) { fail(e, 'Could not approve'); await refresh('proposals'); }
    finally { setBusy(null); }
  };
  const approveAll = async () => {
    setBusy('all');
    let ok = 0;
    for (const p of pending) {
      try { await api.approveProposal(p.id); ok++; } catch { /* reported in the list after refresh */ }
    }
    toast('Trips dispatched', `${ok} of ${pending.length} proposal(s) approved`, ok === pending.length ? 'success' : 'warning');
    await refresh('proposals', 'trips', 'vehicles', 'overview');
    setBusy(null);
  };
  const reject = async (p: DispatchProposal) => {
    setBusy(p.id);
    try { await api.rejectProposal(p.id); await refresh('proposals'); }
    catch (e) { fail(e, 'Could not reject'); }
    finally { setBusy(null); }
  };

  return (
    <Panel className="mb-4" eyebrow="Auto-dispatch" title={pending.length ? `${pending.length} trip(s) proposed: approve to send` : 'Proposed trips'}
      actions={allowed && <>
        {pending.length > 1 && <Button size="sm" variant="success" loading={busy === 'all'} icon={<Check className="h-3.5 w-3.5" />} onClick={approveAll}>Approve all</Button>}
        <Button size="sm" variant="primary" loading={busy === 'run'} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={run}>{pending.length ? 'Re-plan' : 'Plan trips now'}</Button>
      </>}
      bodyClassName="p-0">
      <p className="border-b border-cc-border px-4 py-2 text-xs text-cc-muted">
        Matches available tankers to the places in greatest need, weighing priority, live crisis signals, distance from the depot and how much one load helps.
        Nothing moves until a dispatcher approves; approved proposals become normal trips with real road routes.
      </p>
      {!loaded.has('proposals') ? <Empty title="Loading…" /> : pending.length === 0
        ? <Empty title="No pending proposals" hint={allowed ? 'Press “Plan trips now”. The planner also re-runs automatically every 30 minutes.' : 'A dispatcher can generate proposals.'} />
        : (
          <ul className="grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
            {pending.map((p, i) => (
              <li key={p.id} className="relative overflow-hidden rounded-lg border border-cc-border bg-gradient-to-br from-cc-raised/80 to-cc-surface p-3">
                <span className={cx('absolute inset-x-0 top-0 h-0.5', i < 3 ? 'bg-gradient-to-r from-red-500 to-orange-400' : 'bg-gradient-to-r from-sky-500 to-violet-500')} aria-hidden />
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cc-accent/15 text-cc-accent ring-1 ring-cc-accent/30"><Truck className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.vehicleNumber}</p>
                    <p className="truncate text-2xs text-cc-muted">from {p.depot ?? 'depot'} · ~{p.estDistanceKm} km</p>
                  </div>
                  <Chip tone="accent" title="Planner score">#{i + 1} · {p.score.toFixed(0)}</Chip>
                </div>
                <ol className="mt-2 space-y-1">
                  {p.stops.map(s => (
                    <li key={s.communityId} className="flex items-center gap-1.5 text-sm">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-red-700" aria-hidden />
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="num ml-auto text-xs text-cc-muted">{litres(s.litres)}</span>
                    </li>
                  ))}
                </ol>
                <ul className="mt-2 space-y-0.5 border-t border-cc-border pt-2 text-2xs text-cc-muted">
                  {p.reasons.map((r, j) => <li key={j}>• {r}</li>)}
                </ul>
                {allowed && (
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" variant="success" className="flex-1" loading={busy === p.id} icon={<Check className="h-3.5 w-3.5" />} onClick={() => approve(p)}>Approve & dispatch</Button>
                    <Button size="sm" variant="ghost" disabled={busy === p.id} icon={<X className="h-3.5 w-3.5" />} onClick={() => reject(p)}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {history.length > 0 && (
        <div className="border-t border-cc-border">
          <button onClick={() => setShowHistory(h => !h)} className="flex w-full items-center gap-1 px-4 py-2 text-xs text-cc-muted hover:text-cc-text">
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Recent decisions ({history.length})
          </button>
          {showHistory && (
            <ul className="divide-y divide-cc-border px-4 pb-2 text-xs">
              {history.map(p => (
                <li key={p.id} className="flex items-center gap-2 py-1.5">
                  <Chip tone={p.status === 'Approved' ? 'ok' : 'neutral'}>{p.status}{p.auto ? ' · auto' : ''}</Chip>
                  <span className="truncate">{p.vehicleNumber} → {p.stops.map(s => s.name).join(', ')}</span>
                  {p.tripCode && <button className="text-cc-accent hover:underline" onClick={() => navigate(`trips/${p.tripCode}`)}>{p.tripCode}</button>}
                  <span className="ml-auto whitespace-nowrap text-cc-faint">{p.decidedBy} · {timeAgo(p.decidedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
};
