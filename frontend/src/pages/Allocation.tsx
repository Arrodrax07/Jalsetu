import React, { useState } from 'react';
import { Cpu, ShieldCheck, CheckCircle2, AlertTriangle, RotateCcw, Sliders, Info, Download, CloudSun } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { Modal } from '../components/common/Modal';
import { FACTOR_LABELS } from '../components/requests/CreateRequestModal';
import { api } from '../services/api';
import { dateTime, litres, pct } from '../utils/format';

const COLORS: Record<string, string> = { demand: 'bg-sky-600', vulnerability: 'bg-amber-500', unmetNeed: 'bg-rose-500', previousCoverage: 'bg-teal-500', population: 'bg-indigo-500' };

export const Allocation: React.FC = () => {
  const { plan, fleetSupply, weights, operations, tankers, runAllocation, isAllocationRunning, approveAllocation, reportBreakdown, restoreTanker, currentUser, handleError } = useWaterData();
  const [supplyOverride, setSupplyOverride] = useState<string>('');
  const [useForecast, setUseForecast] = useState(true);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakTanker, setBreakTanker] = useState('');
  const [breakNote, setBreakNote] = useState('');

  const isAdmin = currentUser?.role === 'admin';
  const disrupted = tankers.filter(t => t.isDisrupted);
  const mb = plan?.metricsBefore;
  const ma = plan?.metricsAfter;

  const run = () => runAllocation({ useForecast, totalSupply: supplyOverride ? Number(supplyOverride) : undefined });

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Fair Allocation Engine</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Floors first (survival {operations?.survivalLitresPerPerson ?? '—'} L/person, {operations?.minCoveragePct ?? '—'}% minimum coverage), then the remaining supply is split by
            weighted proportional fairness: each community's coverage is proportional to its priority until fully served. Demand comes from the ML forecast with live weather.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setBreakdownOpen(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-600" /> Report tanker breakdown
          </button>
          <button onClick={() => api.downloadReport('allocation').catch(e => handleError(e))} disabled={!plan}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold disabled:opacity-40">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col md:flex-row md:items-end gap-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Daily supply (L)</label>
          <input type="number" min={0} step={1000} value={supplyOverride} onChange={e => setSupplyOverride(e.target.value)}
            placeholder={`${fleetSupply.toLocaleString('en-IN')} (fleet capacity)`}
            className="w-56 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20" />
          <p className="text-[10px] text-slate-400 mt-1">Default = operational tanker capacity × {operations?.tripsPerDay ?? '—'} trips/day</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 pb-5">
          <input type="checkbox" checked={useForecast} onChange={e => setUseForecast(e.target.checked)} />
          <CloudSun className="w-4 h-4 text-sky-600" /> Use weather-driven demand forecast
        </label>
        <div className="flex gap-2 md:ml-auto pb-1">
          <button onClick={run} disabled={isAllocationRunning} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold shadow-card">
            <Cpu className="w-4 h-4 text-sky-200" /> {isAllocationRunning ? 'Optimizing…' : 'Run allocation'}
          </button>
          {isAdmin && (
            <button onClick={approveAllocation} disabled={!plan || plan.status !== 'Proposed'}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold shadow-card">
              <CheckCircle2 className="w-4 h-4" /> Approve plan
            </button>
          )}
        </div>
      </div>

      {disrupted.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="text-xs text-amber-900">
            <h4 className="font-bold uppercase tracking-wider">Fleet disruption active</h4>
            {disrupted.map(t => <p key={t.id}>{t.vehicleNumber}: {t.breakdownNote}</p>)}
            {plan?.disruption && <p className="mt-1">Current plan absorbed a {litres(plan.disruption.lostLitres)} loss; communities with vulnerability ≥ {operations?.protectVulnerabilityAbove} were held at their approved allocation where supply allowed.</p>}
          </div>
          <div className="flex gap-2">
            {disrupted.map(t => (
              <button key={t.id} onClick={() => restoreTanker(t.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-bold text-amber-800">
                <RotateCcw className="w-3.5 h-3.5" /> Restore {t.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {!plan ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
          No allocation plan yet. Run the engine to generate one from current demand and supply.
        </div>
      ) : (
        <>
          {plan.notes.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex gap-2"><Info className="w-4 h-4 text-slate-500 flex-shrink-0" /><div>{plan.notes.map(n => <p key={n}>{n}</p>)}</div></div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><Sliders className="w-4 h-4 text-sky-600" /> Priority weights used</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Plan #{plan.id} · {dateTime(plan.createdAt)} · demand source: {plan.demandSource}</p>
                </div>
                <StatusBadge status={plan.status} size="md" />
              </div>
              <div className="space-y-3">
                {Object.entries(plan.weights || weights || {}).map(([k, v]) => (
                  <div key={k}>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1"><span>{FACTOR_LABELS[k] || k}</span><span>{Math.round((v as number) * 100)}%</span></div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden"><div className={`${COLORS[k] || 'bg-slate-500'} h-full rounded-full`} style={{ width: `${(v as number) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                <Stat label="Supply" value={litres(plan.totalSupply)} />
                <Stat label="Demand" value={litres(plan.totalDemand)} />
                <Stat label="Supply / demand" value={pct(100 * plan.totalSupply / Math.max(plan.totalDemand, 1))} />
              </div>
            </div>

            <div className="p-5 bg-gradient-to-br from-slate-900 to-sky-950 text-white rounded-2xl shadow-subtle space-y-4">
              <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h3 className="text-xs font-bold uppercase tracking-wider text-sky-300">Fairness: current vs plan</h3></div>
              <div className="p-4 rounded-xl bg-white/10 border border-white/10 flex items-center justify-around text-center">
                <div><p className="text-[10px] font-bold uppercase text-slate-400">Current</p><p className="text-3xl font-black text-rose-300 mt-1">{pct(plan.fairnessBefore, 1)}</p></div>
                <div className="h-10 w-px bg-white/20" />
                <div><p className="text-[10px] font-bold uppercase text-slate-400">Plan</p><p className="text-3xl font-black text-emerald-400 mt-1">{pct(plan.fairnessAfter, 1)}</p></div>
              </div>
              <table className="w-full text-[11px]">
                <tbody className="divide-y divide-white/10">
                  {mb && ma && ([
                    ['Coverage equality (Jain)', mb.coverageEquality, ma.coverageEquality],
                    ['Worst-off coverage', mb.minCoveragePct, ma.minCoveragePct],
                    ['Vulnerable-community coverage', mb.vulnerableCoveragePct, ma.vulnerableCoveragePct],
                    ['Average coverage', mb.avgCoveragePct, ma.avgCoveragePct],
                  ] as [string, number, number][]).map(([l, b, a]) => (
                    <tr key={l}><td className="py-1 text-slate-300">{l}</td><td className="py-1 text-right text-slate-400">{pct(b, 1)}</td><td className={`py-1 text-right font-bold ${a >= b ? 'text-emerald-300' : 'text-amber-300'}`}>{pct(a, 1)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400">Headline = Jain's index of allocation per unit of priority-weighted need (100% = perfectly proportional to need).</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle overflow-hidden">
            <div className="p-4 border-b border-slate-100"><h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">Recommended daily quotas</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr><th className="px-4 py-3">Community</th><th className="px-4 py-3">Demand</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">Floor</th>
                    <th className="px-4 py-3 text-center">Priority</th><th className="px-4 py-3">Recommended</th><th className="px-4 py-3">Coverage</th><th className="px-4 py-3">Justification</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.items.map(it => {
                    const delta = it.recommendedAllocation - it.previousAllocation;
                    return (
                      <tr key={it.communityId} className="hover:bg-slate-50/80 align-top">
                        <td className="px-4 py-3 font-bold text-slate-900">{it.communityName}</td>
                        <td className="px-4 py-3 text-slate-700">{litres(it.demand)}</td>
                        <td className="px-4 py-3 text-slate-500">{litres(it.previousAllocation)}</td>
                        <td className="px-4 py-3 text-slate-500">{litres(it.survivalFloor)}</td>
                        <td className="px-4 py-3 text-center"><span className={`inline-flex px-2 py-0.5 rounded-full font-bold ${it.priorityScore >= 75 ? 'bg-rose-100 text-rose-800' : it.priorityScore >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{it.priorityScore}</span></td>
                        <td className="px-4 py-3 font-bold text-sky-700 text-sm whitespace-nowrap">{litres(it.recommendedAllocation)}
                          <span className={`block text-[10px] font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{delta >= 0 ? '+' : ''}{delta.toLocaleString('en-IN')} L</span></td>
                        <td className="px-4 py-3 w-28"><div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-sky-500 h-full" style={{ width: `${it.coveragePct}%` }} /></div><span className="text-[10px] text-slate-500">{it.coveragePct}%</span></td>
                        <td className="px-4 py-3 text-slate-600 leading-relaxed max-w-md">{it.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal isOpen={breakdownOpen} onClose={() => setBreakdownOpen(false)} title="Report tanker breakdown" subtitle="The tanker is taken out of service and the allocation is re-optimised immediately." maxWidth="md">
        <form className="space-y-3" onSubmit={async e => { e.preventDefault(); await reportBreakdown(breakTanker, breakNote || 'Breakdown reported'); setBreakdownOpen(false); setBreakNote(''); }}>
          <select required value={breakTanker} onChange={e => setBreakTanker(e.target.value)} className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50">
            <option value="" disabled>Select tanker…</option>
            {tankers.filter(t => t.status !== 'Maintenance').map(t => <option key={t.id} value={t.id}>{t.vehicleNumber} · {t.capacity.toLocaleString('en-IN')} L · {t.status}</option>)}
          </select>
          <input value={breakNote} onChange={e => setBreakNote(e.target.value)} placeholder="What happened? (e.g. axle failure near Kanjurmarg)" className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBreakdownOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
            <button type="submit" className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl">Take out of service & re-plan</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100"><p className="text-[10px] uppercase font-bold text-slate-400">{label}</p><p className="font-bold text-slate-900 mt-0.5">{value}</p></div>
);
