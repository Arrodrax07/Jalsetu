import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Route, Link2, ShieldCheck, Droplets, Loader2, Brain } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { api } from '../services/api';
import type { ImpactStats } from '../types';
import { FairnessLoopDiagram } from '../components/feedback/FairnessLoopDiagram';
import { AXIS_TICK, GRID, SERIES, tooltipStyle } from '../components/charts/theme';
import { litres, num, pct } from '../utils/format';

const Tile: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string }> = ({ icon, label, value, sub }) => (
  <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-subtle">
    <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>{icon}</div>
    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    <p className="text-[11px] text-slate-500 mt-1">{sub}</p>
  </div>
);

export const ImpactAnalytics: React.FC = () => {
  const { handleError, deliveries, complaints, plan } = useWaterData();
  const [s, setS] = useState<ImpactStats | null>(null);
  useEffect(() => { api.impact().then(setS).catch(e => handleError(e, 'Impact data unavailable')); }, [handleError, deliveries.length, complaints.length, plan?.id, plan?.status]);

  if (!s) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />Computing impact…</div>;

  const series = s.fairnessSeries.map((p, i) => ({ label: `#${i + 1} ${new Date(p.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, Before: p.before, After: p.after }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Impact Analytics</h2>
        <p className="text-xs text-slate-500 mt-1">Measured from recorded plans, trips, deliveries and complaints. Empty values mean the system has not collected that data yet.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile icon={<Route className="w-5 h-5 text-sky-600" />} label="Distance saved" value={`${num(s.routing.kmSaved, 1)} km`}
          sub={s.routing.trips ? `${pct(s.routing.kmSavedPct, 1)} vs entered order · ${s.routing.trips} trips · ₹${num(s.routing.fuelSavedInr)} · ${num(s.routing.co2SavedKg, 1)} kg CO₂` : 'No trips dispatched yet'} />
        <Tile icon={<Link2 className="w-5 h-5 text-amber-600" />} label="Duplicates caught" value={`${s.complaints.duplicatesDetected}`}
          sub={s.complaints.total ? `${pct(s.complaints.duplicateRatePct, 1)} of ${s.complaints.total} complaints` : 'No complaints yet'} />
        <Tile icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />} label="Deliveries verified" value={`${s.deliveries.verified} / ${s.deliveries.total}`}
          sub={s.deliveries.total ? `${pct(s.deliveries.geofencePassPct, 1)} inside geofence · ${s.deliveries.mismatches} flagged` : 'No deliveries yet'} />
        <Tile icon={<Droplets className="w-5 h-5 text-sky-600" />} label="Water delivered" value={litres(s.deliveries.litresDelivered)}
          sub={`${s.requests.delivered} of ${s.requests.total} requests fulfilled · ${s.requests.open} open`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900">Coverage by community: before vs latest approved plan</h3>
          <p className="text-[11px] text-slate-500 mb-3">% of demand allocated</p>
          {s.coverageComparison.length === 0 ? <p className="text-xs text-slate-500">Approve an allocation plan to see this comparison.</p> : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={s.coverageComparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="community" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [`${v}%`, n]} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="before" name="Before" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="after" name="Approved plan" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
          <h3 className="text-sm font-bold text-slate-900">Need-weighted equity across approved plans</h3>
          <p className="text-[11px] text-slate-500 mb-3">Allocation before each plan vs the plan itself (100% = proportional to need)</p>
          {series.length === 0 ? <p className="text-xs text-slate-500">No approved plans yet.</p> : (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [`${v}%`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="Before" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} />
                  <Line dataKey="After" name="Plan" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-2 text-xs">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Brain className="w-4 h-4 text-violet-600" /> Complaint model in production</h3>
          <Row k="Officer-verified labels" v={String(s.complaints.officerVerifiedLabels)} />
          <Row k="Model agreement with officers" v={s.complaints.modelAgreementPct != null ? pct(s.complaints.modelAgreementPct, 1) : 'needs verified labels'} />
          <Row k="Avg time to resolve" v={s.complaints.avgResolutionHours != null ? `${s.complaints.avgResolutionHours} h` : '—'} />
          <p className="text-[11px] text-slate-500 pt-1">Corrections feed the next retrain (Settings → Machine learning).</p>
        </div>
        <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle text-xs lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Complaints by category</h3>
          {Object.keys(s.complaints.byCategory).length === 0 ? <p className="text-slate-500">No complaints yet.</p> : (
            <ul className="space-y-2">
              {Object.entries(s.complaints.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k}><div className="flex justify-between mb-1"><span className="font-semibold text-slate-800">{k}</span><span className="text-slate-600">{v}</span></div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(100 * v) / s.complaints.total}%`, background: SERIES[0] }} /></div></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FairnessLoopDiagram />
    </div>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">{k}</span><span className="font-semibold text-slate-900">{v}</span></div>
);
