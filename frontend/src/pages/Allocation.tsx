import React, { useState } from 'react';
import { CheckCircle2, Cpu, Download, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, Empty, Field, KindLabel, PageHeader, Panel, StatusChip } from '../components/ui';
import { dt, litres, pct } from '../utils/format';

export const Allocation: React.FC = () => {
  const { plan, fleetSupply, operations, can, fail, toast, refresh } = useApp();
  const [supply, setSupply] = useState('');
  const [useForecast, setUseForecast] = useState(false);
  const [scope, setScope] = useState<'crisis_reach' | 'requests' | 'all'>('crisis_reach');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    setBusy('run');
    try { const p = await api.runAllocation({ totalSupply: supply ? Number(supply) : undefined, useForecast, scope }); toast('Plan computed', `Need-weighted equity ${p.fairnessBefore}% → ${p.fairnessAfter}%`, 'success'); await refresh('plan'); }
    catch (e) { fail(e); }
    setBusy(null);
  };
  const approve = async () => {
    if (!plan) return;
    setBusy('approve');
    try { const r = await api.approvePlan(plan.id); toast('Plan approved', `${r.requestsAllocated} pending request(s) marked Allocated.`, 'success'); await refresh('plan', 'communities', 'requests', 'overview'); }
    catch (e) { fail(e); }
    setBusy(null);
  };
  const mb = plan?.metricsBefore, ma = plan?.metricsAfter;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Allocation"
        subtitle={<>Deterministic optimisation: floors first (survival {operations?.survivalLitresPerPerson ?? '…'} L/person, protected vulnerable communities, {operations?.minCoveragePct ?? '…'}% minimum coverage), then remaining supply split so each community's coverage is proportional to its priority.</>}
        actions={plan && <Button icon={<Download className="h-4 w-4" />} onClick={() => api.downloadReport('allocation').catch(fail)}>CSV</Button>} />
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Daily supply (litres)" hint={`Default: operational tanker capacity × ${operations?.tripsPerDay ?? '…'} trips/day`}>
            <input className="input w-56" type="number" min={0} step={1000} placeholder={fleetSupply.toLocaleString('en-IN')} value={supply} onChange={e => setSupply(e.target.value)} />
          </Field>
          <Field label="Which places">
            <select className="input w-72" value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
              <option value="crisis_reach">In crisis and within tanker reach (+ open requests)</option>
              <option value="requests">Only places with an open request</option>
              <option value="all">Every place with a tanker need (statewide)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 pb-5 text-sm">
            <input type="checkbox" checked={useForecast} onChange={e => setUseForecast(e.target.checked)} />
            Use demand forecast instead of recorded baseline <KindLabel kind="predicted" title="Advisory model; requires real historical observations for production calibration" />
          </label>
          <div className="ml-auto flex gap-2 pb-1">
            {can('run_allocation') && <Button variant="primary" icon={<Cpu className="h-4 w-4" />} loading={busy === 'run'} onClick={run}>Compute plan</Button>}
            {can('approve_allocation') && <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} disabled={plan?.status !== 'Proposed'} loading={busy === 'approve'} onClick={approve}>Approve plan</Button>}
          </div>
        </div>
        {useForecast && <p className="mt-2 text-xs text-pink-700">The forecast is an ML prediction trained on real weather with a simulated demand response. Use only as a planning aid until real metered observations are recorded.</p>}
      </Panel>
      {!plan ? <Panel><Empty title="No allocation plan yet" hint="Compute a plan from recorded demand and available supply." /></Panel> : (
        <>
          {plan.scopeLabel && <p className="mb-2 text-xs text-cc-muted">Scope: {plan.scopeLabel} · {plan.items.length} places</p>}
          {plan.notes.length > 0 && <p className="mb-3 flex gap-2 rounded-lg border border-cc-border bg-cc-raised p-3 text-sm text-cc-muted"><Info className="h-4 w-4 flex-shrink-0" />{plan.notes.join(' ')}</p>}
          <div className="mb-4 grid gap-3 md:grid-cols-5">
            {mb && ma && ([['Need-weighted equity', mb.needWeightedEquity, ma.needWeightedEquity], ['Coverage equality', mb.coverageEquality, ma.coverageEquality],
              ['Worst-off coverage', mb.minCoveragePct, ma.minCoveragePct], ['Vulnerable coverage', mb.vulnerableCoveragePct, ma.vulnerableCoveragePct], ['Average coverage', mb.avgCoveragePct, ma.avgCoveragePct]] as [string, number, number][])
              .map(([k, b, a]) => (
                <div key={k} className="panel p-3"><p className="eyebrow">{k}</p><p className="num mt-1 text-lg font-semibold">{pct(b, 1)} → <span className={a >= b ? 'text-green-700' : 'text-amber-800'}>{pct(a, 1)}</span></p><p className="text-2xs text-cc-muted">current → plan</p></div>
              ))}
          </div>
          <Panel title={<span className="flex items-center gap-2">Plan #{plan.id} <StatusChip status={plan.status} /></span>}
            actions={<span className="text-xs text-cc-muted">{dt(plan.createdAt)} · demand: {plan.demandSource.startsWith('PREDICTED') ? 'forecast (PREDICTED)' : 'recorded baseline'} · supply {litres(plan.totalSupply)} / demand {litres(plan.totalDemand)}</span>}
            bodyClassName="overflow-x-auto">
            <table className="table-cc">
              <thead><tr><th>Community</th><th className="text-right">Demand</th><th className="text-right">Current</th><th className="text-right">Floor</th><th>Priority</th><th className="text-right">Recommended</th><th>Coverage</th><th>Justification</th></tr></thead>
              <tbody>{plan.items.map(it => {
                const delta = it.recommendedAllocation - it.previousAllocation;
                return (
                  <tr key={it.communityId}>
                    <td className="font-medium">{it.communityName}</td><td className="num text-right">{litres(it.demand)}</td><td className="num text-right text-cc-muted">{litres(it.previousAllocation)}</td>
                    <td className="num text-right text-cc-muted">{litres(it.survivalFloor)}</td><td className="num">{it.priorityScore}</td>
                    <td className="num text-right font-semibold">{litres(it.recommendedAllocation)}<div className={`text-2xs ${delta >= 0 ? 'text-green-700' : 'text-amber-800'}`}>{delta >= 0 ? '+' : ''}{delta.toLocaleString('en-IN')}</div></td>
                    <td><div className="flex items-center gap-2"><div className="h-1.5 w-16 rounded-full bg-cc-bg"><div className="h-full rounded-full bg-cc-accent" style={{ width: `${Math.min(100, it.coveragePct)}%` }} /></div><span className="num text-xs">{it.coveragePct}%</span></div></td>
                    <td className="max-w-md text-xs text-cc-muted">{it.reason}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
};
