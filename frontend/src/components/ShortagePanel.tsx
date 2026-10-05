/**
 * Demand and shortage analysis (Analytics page): the places the fleet plans for, how much water they need against
 * what the fleet can carry over the next 7 days, how requests are trending, and which places are most underserved.
 * Every figure comes from GET /api/analytics/shortage; forecast numbers are labelled as predictions.
 */
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api';
import { AXIS_TICK, GRID, SERIES, shortDate, tooltipStyle } from './charts/theme';
import { Empty, KindLabel, Kpi, Loading, Panel } from './ui';
import { districtName, litres, num, pct, timeAgo } from '../utils/format';
import type { ShortageAnalysis } from '../types';

const Compare: React.FC<{ rows: { label: string; value: number; hint: string; strong?: boolean }[] }> = ({ rows }) => {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-3" aria-label="Litres per day compared">
      {rows.map(r => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="font-medium">{r.label}</span>
            <span className="num whitespace-nowrap text-cc-muted">{litres(r.value)}/day</span></div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-cc-hover" title={r.hint}>
            <div className={r.strong ? 'h-full rounded-full bg-cc-accent' : 'h-full rounded-full bg-cc-muted/60'} style={{ width: `${Math.max(0.6, (100 * r.value) / max)}%` }} />
          </div>
          <p className="mt-0.5 text-[11.5px] text-cc-faint">{r.hint}</p>
        </li>
      ))}
    </ul>
  );
};

export const ShortagePanel: React.FC<{ days: number; origin: 'all' | 'real'; onError: (e: unknown) => void }> = ({ days, origin, onError }) => {
  const [s, setS] = useState<ShortageAnalysis | null>(null);
  useEffect(() => { setS(null); api.shortage(days, origin).then(setS).catch(onError); }, [days, origin, onError]);
  if (!s) return <Panel title="Demand and shortage"><Loading /></Panel>;

  const today = s.outlook.days[0];
  const survivalCover = today && today.survival ? (100 * s.fleetCapacity) / today.survival : null;
  const ts = s.trendSummary;
  const trend = s.trend.map(d => ({ date: shortDate(d.date), 'New requests': d.requests, 'Repeats merged': d.repeats, litres: d.litresRequested, delivered: d.litresDelivered }));
  const anyRequests = s.trend.some(d => d.requests || d.repeats);

  return (
    <section className="mt-4 space-y-4" aria-labelledby="shortage-h">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 id="shortage-h" className="text-[15px] font-semibold">Demand and shortage</h2>
          <p className="text-[12.5px] text-cc-muted">{s.scope.label}: <span className="num">{num(s.scope.places)}</span> places, <span className="num">{num(s.scope.people)}</span> people.</p></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Panel title={<span className="flex items-center gap-2">Shortage outlook, next 7 days <KindLabel kind="predicted" /></span>}
          actions={<span className="text-2xs text-cc-muted">{s.outlook.source}</span>}>
          {!today ? <Empty title="No places in scope" hint="No town or village in crisis is within tanker reach and no request is open." /> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-cc-border bg-cc-border [&>button]:rounded-none [&>button]:bg-cc-surface">
                <Kpi label="Shortage days" value={`${s.shortageDays} / ${s.outlook.days.length}`} sub="below survival floor" tone={s.shortageDays ? 'warn' : 'ok'} />
                <Kpi label="Survival floor covered" value={pct(survivalCover, 1)} sub="drinking + cooking" tone={survivalCover != null && survivalCover < 100 ? 'warn' : 'ok'} />
                <Kpi label="Full need covered" value={pct(s.coverOfNeedPct, 1)} sub="of forecast need" />
                <Kpi label="Underserved places" value={s.scope.underserved} sub="coverage under 75%" />
              </div>
              <Compare rows={[
                { label: 'Fleet can carry', value: s.fleetCapacity, hint: 'Every working tanker × refills per day', strong: true },
                { label: 'Survival floor', value: today.survival, hint: 'Drinking + cooking minimum (Sphere/WHO) for every resident in scope, minus piped supply' },
                { label: 'Forecast tanker need', value: today.needP50, hint: `Demand forecast minus estimated piped supply; 90% case ${litres(today.needP90)}/day` },
              ]} />
              {s.outlook.note && <p className="text-[12px] text-amber-800">{s.outlook.note}</p>}
              <p className="text-2xs text-cc-faint">Advisory. Piped supply and demand are estimates at planning norms; the gap is what tankers alone cannot close.</p>
            </div>
          )}
        </Panel>

        <Panel title="Requests per day" eyebrow={origin === 'all' && ts.syntheticIncluded ? 'Includes labelled synthetic history' : 'Real records'}>
          {!anyRequests ? <Empty title="No requests in this window" /> : (
            <>
              <p className="mb-2 text-[13px] text-cc-muted">
                Last 7 days <span className="num font-semibold text-cc-text">{ts.last7}</span> new requests
                {ts.changePct != null && <> ({ts.changePct > 0 ? '+' : ''}{ts.changePct}% on the 7 days before)</>}
                {' · '}<span className="num font-semibold text-cc-text">{ts.repeatsMerged}</span> repeat calls merged
                {' · '}<span className="num font-semibold text-cc-text">{ts.citizenRequests}</span> from the citizen portal
              </p>
              <div className="h-60"><ResponsiveContainer><BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'rgb(128 140 150 / .12)' }}
                  formatter={(v: any, n: any) => [num(v), n]}
                  labelFormatter={(l: any, p: any) => { const d = p?.[0]?.payload; return d ? `${l} · ${litres(d.litres)} asked · ${litres(d.delivered)} delivered` : l; }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="New requests" stackId="r" fill={SERIES[0]} stroke="rgb(var(--cc-surface))" strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="Repeats merged" stackId="r" fill={SERIES[1]} stroke="rgb(var(--cc-surface))" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Most underserved places" eyebrow="Ranked by the planner's priority score; open a place for its evidence">
        {s.underserved.length === 0 ? <Empty title="No places in scope" /> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead><tr className="text-left text-2xs uppercase tracking-wide text-cc-muted">
                <th className="px-2 py-2 font-medium">Place</th><th className="px-2 py-2 text-right font-medium">Priority</th>
                <th className="px-2 py-2 text-right font-medium">Coverage</th><th className="px-2 py-2 text-right font-medium">Shortfall / day</th>
                <th className="px-2 py-2 text-right font-medium">Delivered, 7 days</th><th className="px-2 py-2 font-medium">Last delivery</th>
                <th className="px-2 py-2 text-right font-medium">Open requests</th><th className="px-2 py-2 font-medium">Main reason</th>
              </tr></thead>
              <tbody className="divide-y divide-cc-border">
                {s.underserved.map(p => (
                  <tr key={p.id} className="hover:bg-cc-hover/60">
                    <td className="px-2 py-2"><a href={`#overview/${p.id}`} className="font-medium hover:underline">{p.name}</a>
                      <span className="block text-[11.5px] text-cc-faint">{districtName(p.district)}{p.settlementType && <> · <span className="capitalize">{p.settlementType}</span></>} · {num(p.population)} people</span></td>
                    <td className="num px-2 py-2 text-right font-semibold">{p.priority}</td>
                    <td className={`num px-2 py-2 text-right ${p.underserved ? 'font-semibold text-amber-800' : ''}`}>{p.coveragePct}%</td>
                    <td className="num px-2 py-2 text-right">{litres(p.shortfall)}</td>
                    <td className="num px-2 py-2 text-right">{litres(p.delivered7d)}</td>
                    <td className="px-2 py-2 text-cc-muted">{p.lastDeliveryAt ? timeAgo(p.lastDeliveryAt) : 'None recorded'}</td>
                    <td className="num px-2 py-2 text-right">{p.openRequests || '—'}</td>
                    <td className="px-2 py-2 text-cc-muted">{p.topReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 px-2 text-2xs text-cc-faint">Coverage and shortfall are estimates (piped supply at planning norms + approved tanker allocation). Deliveries count real records only.</p>
          </div>
        )}
      </Panel>
    </section>
  );
};

export default ShortagePanel;
