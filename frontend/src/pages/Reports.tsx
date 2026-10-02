import React, { useState } from 'react';
import { FileSpreadsheet, Download, Printer, Loader2 } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { api } from '../services/api';
import { litres, pct } from '../utils/format';

const EXPORTS = [
  { kind: 'communities', title: 'Community coverage', desc: 'Demand, allocation, coverage, priority and status per community.' },
  { kind: 'allocation', title: 'Latest allocation plan', desc: 'Recommended quotas with floors, priority and written justification.' },
  { kind: 'requests', title: 'Water requests', desc: 'All requests with urgency, priority score and status history.' },
  { kind: 'complaints', title: 'Grievance audit', desc: 'Complaints with model category/confidence, severity, duplicates and status.' },
  { kind: 'deliveries', title: 'Proof-of-delivery audit', desc: 'Every delivery with variance, geofence distance and sign-off.' },
] as const;

export const Reports: React.FC = () => {
  const { communities, requests, complaints, deliveries, tankers, dashboard, handleError } = useWaterData();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (kind: (typeof EXPORTS)[number]['kind']) => {
    setBusy(kind);
    try { await api.downloadReport(kind); } catch (e) { handleError(e, 'Export failed'); }
    setBusy(null);
  };

  const today = new Date().toISOString().slice(0, 10);
  const deliveredToday = deliveries.filter(d => d.deliveryTime.slice(0, 10) === today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Reports</h2>
          <p className="text-xs text-slate-500 mt-1">CSV exports are generated server-side from the live database (UTF-8, opens in Excel).</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"><Printer className="w-4 h-4" />Print daily summary</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 print:hidden">
        {EXPORTS.map(e => (
          <div key={e.kind} className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-subtle flex flex-col">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 mb-2" />
            <h3 className="text-sm font-bold text-slate-900">{e.title}</h3>
            <p className="text-xs text-slate-500 mt-1 flex-1">{e.desc}</p>
            <button onClick={() => download(e.kind)} disabled={busy !== null} className="mt-3 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold">
              {busy === e.kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download CSV
            </button>
          </div>
        ))}
      </div>

      <div className="p-8 bg-white rounded-2xl border border-slate-200 shadow-subtle print:shadow-none print:border-0 space-y-5">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-lg font-black text-slate-900">Daily Water Operations Summary</h3>
          <p className="text-xs text-slate-500">{new Date().toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {([
            ['Communities', communities.length], ['Total allocated', litres(communities.reduce((a, c) => a + c.allocatedWater, 0))],
            ['Delivered today', litres(deliveredToday.reduce((a, d) => a + d.deliveredAmount, 0))], ['Deliveries today', deliveredToday.length],
            ['Open requests', requests.filter(r => ['Pending', 'Allocated', 'Dispatched'].includes(r.status)).length], ['Open complaints', complaints.filter(c => c.status !== 'Resolved').length],
            ['Tankers in service', `${tankers.filter(t => t.status !== 'Maintenance').length} / ${tankers.length}`], ['Need-weighted equity', pct(dashboard?.coverageBalance, 1)],
          ] as [string, string | number][]).map(([k, v]) => (
            <div key={k} className="p-3 rounded-lg bg-slate-50 border border-slate-100"><p className="text-[10px] uppercase font-bold text-slate-400">{k}</p><p className="font-bold text-slate-900 mt-0.5">{v}</p></div>
          ))}
        </div>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200">
            <tr><th className="py-2">Community</th><th>Ward</th><th className="text-right">Demand</th><th className="text-right">Allocated</th><th className="text-right">Coverage</th><th className="text-right">Priority</th><th>Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...communities].sort((a, b) => b.priorityScore - a.priorityScore).map(c => (
              <tr key={c.id}><td className="py-1.5 font-semibold">{c.name}</td><td>{c.ward}</td><td className="text-right">{litres(c.dailyDemand)}</td><td className="text-right">{litres(c.allocatedWater)}</td>
                <td className="text-right">{c.currentCoverage}%</td><td className="text-right">{c.priorityScore}</td><td>{c.status}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="pt-8 grid grid-cols-2 gap-8 text-[11px] text-slate-500">
          <div className="border-t border-slate-300 pt-1">Prepared by</div><div className="border-t border-slate-300 pt-1">Approved by (Ward Engineer)</div>
        </div>
      </div>
    </div>
  );
};
