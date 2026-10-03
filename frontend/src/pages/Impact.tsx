/** First come first served vs JalSetu, replayed on the same requests, fleet and depots (GET /analytics/impact-replay). */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, FlaskConical, Info, Minus } from '../components/icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { AXIS_TICK, GRID, tooltipStyle, kLitres } from '../components/charts/theme';
import { Chip, cx, EASE, Empty, ErrorBox, Loading, PageHeader, Panel, Segmented } from '../components/ui';
import type { ImpactReplay, StrategyResult } from '../types';
import { litres, num } from '../utils/format';

const FCFS = '#9a6b2f';   // ochre: the baseline
const JALSETU = '#0c6e96'; // water blue

type Metric = { key: keyof StrategyResult; label: string; better: 'higher' | 'lower'; fmt: (v: number) => string; hint?: string };
const hours = (v: number) => `${num(v, v < 10 ? 1 : 0)} h`;
const METRICS: { group: string; rows: Metric[] }[] = [
  { group: 'Water reaching people', rows: [
    { key: 'litresTowardNeed', label: 'Water delivered toward real need', better: 'higher', fmt: litres, hint: 'Litres that met a request; water sent again for a repeat call does not count twice.' },
    { key: 'unmetPct', label: 'Need left unmet', better: 'lower', fmt: v => `${num(v, 1)}%` },
    { key: 'medianWaitHours', label: 'Median wait, request to water', better: 'lower', fmt: hours },
    { key: 'requestsStillWaiting', label: 'Requests still waiting at the end', better: 'lower', fmt: v => num(v) },
  ] },
  { group: 'Fairness', rows: [
    { key: 'fairnessJain', label: 'Coverage fairness (Jain index)', better: 'higher', fmt: v => `${num(v, 1)} / 100`, hint: '100 = every place got the same share of what it asked for.' },
    { key: 'vulnerableCoveragePct', label: 'Vulnerable places: share of need met', better: 'higher', fmt: v => `${num(v, 1)}%`, hint: 'Places with vulnerability score 65+ (High or Very High).' },
    { key: 'vulnerablePlacesReached', label: 'Vulnerable places reached', better: 'higher', fmt: v => num(v) },
    { key: 'placesReached', label: 'Places reached at all', better: 'higher', fmt: v => num(v) },
  ] },
  { group: 'Fleet efficiency', rows: [
    { key: 'kmDriven', label: 'Kilometres driven (estimate)', better: 'lower', fmt: v => `${num(v)} km` },
    { key: 'litresPerKm', label: 'Water delivered per km', better: 'higher', fmt: v => `${num(v, 1)} L/km` },
    { key: 'loadUtilisationPct', label: 'Tank filled per trip', better: 'higher', fmt: v => `${num(v, 1)}%` },
    { key: 'fuelInr', label: 'Diesel cost (estimate)', better: 'lower', fmt: v => `₹${num(v)}` },
  ] },
  { group: 'Repeat requests', rows: [
    { key: 'duplicateRequestsServed', label: 'Repeat calls served again', better: 'lower', fmt: v => num(v) },
    { key: 'litresOnDuplicates', label: 'Water sent for repeat calls', better: 'lower', fmt: litres },
  ] },
];

function verdict(m: Metric, a: number | null, b: number | null) {
  if (a == null || b == null) return { dir: 'none' as const, text: '—' };
  const diff = b - a;
  if (Math.abs(diff) < 1e-9) return { dir: 'same' as const, text: 'Same' };
  const good = m.better === 'higher' ? diff > 0 : diff < 0;
  const rel = a !== 0 ? `${Math.abs((100 * diff) / a).toFixed(0)}%` : '';
  return { dir: good ? 'better' as const : 'worse' as const, text: `${good ? 'Better' : 'Worse'}${rel ? ` by ${rel}` : ''}` };
}

const Row: React.FC<{ m: Metric; a: StrategyResult; b: StrategyResult; i: number }> = ({ m, a, b, i }) => {
  const va = a[m.key] as number | null, vb = b[m.key] as number | null;
  const v = verdict(m, va, vb);
  const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)) || 1;
  return (
    <motion.tr initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.35, ease: EASE }}>
      <td className="py-2.5 pr-3 align-top">
        <p className="text-[13px] font-medium text-cc-text">{m.label}</p>
        {m.hint && <p className="text-[11.5px] leading-snug text-cc-faint">{m.hint}</p>}
      </td>
      {[va, vb].map((val, k) => (
        <td key={k} className="w-[24%] py-2.5 pr-3 align-top">
          <p className="num text-[13px] font-semibold" style={{ color: k ? JALSETU : FCFS }}>{val == null ? '—' : m.fmt(val)}</p>
          <div className="mt-1 h-1 rounded-full bg-cc-hover"><motion.div className="h-full rounded-full" style={{ background: k ? JALSETU : FCFS }}
            initial={{ width: 0 }} animate={{ width: `${(100 * Math.abs(val ?? 0)) / max}%` }} transition={{ duration: 0.8, ease: EASE, delay: 0.05 * i }} /></div>
        </td>
      ))}
      <td className="w-[16%] py-2.5 align-top">
        <span className={cx('inline-flex items-center gap-1 text-[12px] font-medium',
          v.dir === 'better' ? 'text-green-800' : v.dir === 'worse' ? 'text-red-700' : 'text-cc-muted')}>
          {v.dir === 'better' ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : v.dir === 'worse' ? <ArrowDownRight className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
          {v.text}
        </span>
      </td>
    </motion.tr>
  );
};

export const Impact: React.FC = () => {
  const { fail } = useApp();
  const [days, setDays] = useState('30');
  const [origin, setOrigin] = useState<'all' | 'real'>('all');
  const [data, setData] = useState<ImpactReplay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    api.impactReplay(Number(days), origin).then(setData).catch(e => { setErr(e.message); fail(e); });
  }, [days, origin, fail]);

  const daily = useMemo(() => (data?.daily || []).map(d => ({ ...d, label: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })), [data]);
  const a = data?.fcfs, b = data?.jalsetu;

  return (
    <div className="p-4 lg:p-6">
      <PageHeader eyebrow="Impact" title="First come first served vs JalSetu"
        subtitle="The same water requests, the same tankers and depots, the same daily driving limits, replayed day by day under both policies. Only the policy differs."
        actions={<>
          <Segmented value={days} onChange={setDays} options={[{ id: '14', label: '14 days' }, { id: '30', label: '30 days' }, { id: '60', label: '60 days' }]} />
          <Segmented value={origin} onChange={v => setOrigin(v as 'all' | 'real')} options={[{ id: 'all', label: 'All records' }, { id: 'real', label: 'Real only' }]} />
        </>} />

      {err && <ErrorBox message={err} />}
      {!data && !err && <Loading label="Replaying requests under both policies…" />}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-cc-border bg-cc-surface px-4 py-3 text-[13px]">
            <span className="font-medium">{num(data.requests.total)} requests</span>
            <span className="text-cc-muted">· {num(data.requests.real)} real</span>
            {data.requests.synthetic > 0 && <Chip tone="predicted" icon={<FlaskConical className="h-3 w-3" aria-hidden />} title="Generated by scripts/demo_history.py from real places and the real fleet; never used operationally">
              {num(data.requests.synthetic)} synthetic demo history</Chip>}
            <span className="text-cc-muted">· {data.fleet.tankers} tankers at {data.fleet.depots} depots · up to {data.fleet.tripsPerDay} trips and {data.fleet.shiftHours} h a day each</span>
          </div>

          {!data.available ? <Panel><Empty title="Nothing to replay" hint={data.reason} /></Panel> : a && b && (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
                <Panel title="Outcome, metric by metric" eyebrow={`${num(data.places)} places · ${litres(data.needLitres)} asked for`}
                  actions={<div className="flex items-center gap-3 text-[12px]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: FCFS }} />First come first served</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: JALSETU }} />JalSetu</span></div>}>
                  <table className="w-full">
                    <thead className="sr-only"><tr><th>Metric</th><th>First come first served</th><th>JalSetu</th><th>JalSetu vs FCFS</th></tr></thead>
                    {METRICS.map((g, gi) => (
                      <tbody key={g.group}>
                        <tr><td colSpan={4} className={cx('pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-cc-faint', gi ? 'pt-5' : '')}>{g.group}</td></tr>
                        {g.rows.map((m, i) => <Row key={m.key} m={m} a={a} b={b} i={gi * 4 + i} />)}
                      </tbody>
                    ))}
                  </table>
                </Panel>
                <div className="space-y-4">
                  <Panel title="Water delivered toward need, cumulative">
                    <div className="h-56"><ResponsiveContainer><LineChart data={daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                      <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [litres(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="fcfsCumulative" name="First come first served" stroke={FCFS} strokeWidth={2} dot={false} animationDuration={900} />
                      <Line type="monotone" dataKey="jalsetuCumulative" name="JalSetu" stroke={JALSETU} strokeWidth={2.5} dot={false} animationDuration={900} />
                    </LineChart></ResponsiveContainer></div>
                    <p className="mt-1 text-[11.5px] text-cc-faint">Includes water sent for repeat calls under first come first served; the table counts only water toward real need.</p>
                  </Panel>
                  <Panel title="Litres still owed at the end of each day">
                    <div className="h-48"><ResponsiveContainer><LineChart data={daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                      <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [litres(v), n]} />
                      <Line type="monotone" dataKey="fcfsBacklog" name="First come first served" stroke={FCFS} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="jalsetuBacklog" name="JalSetu" stroke={JALSETU} strokeWidth={2.5} dot={false} />
                    </LineChart></ResponsiveContainer></div>
                    <p className="mt-1 text-[11.5px] text-cc-faint">First come first served counts repeat calls as separate debts; JalSetu counts each place's need once.</p>
                  </Panel>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="How much of its request each place received">
                  <div className="h-56"><ResponsiveContainer><BarChart data={data.coverageBands} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="band" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [`${v} places`, n]} cursor={{ fill: '#0c6e9610' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="fcfs" name="First come first served" fill={FCFS} radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="jalsetu" name="JalSetu" fill={JALSETU} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  </BarChart></ResponsiveContainer></div>
                </Panel>
                <Panel title="Repeat requests" eyebrow="Same place, still waiting">
                  {data.duplicates && (
                    <div className="grid grid-cols-2 gap-4">
                      <div><p className="display num text-[44px] leading-none">{num(data.duplicates.requests)}</p><p className="mt-1 text-[13px] text-cc-muted">repeat calls in the stream ({litres(data.duplicates.litresAsked)} asked)</p></div>
                      <div><p className="display num text-[44px] leading-none" style={{ color: FCFS }}>{num(data.duplicates.fcfsServedAgain)}</p><p className="mt-1 text-[13px] text-cc-muted">served again under first come first served, {litres(data.duplicates.fcfsLitresOnRepeats)}</p></div>
                      <p className="col-span-2 rounded-xl bg-cc-raised p-3 text-[13px] leading-relaxed text-cc-muted">
                        JalSetu merges a request for a place that already has an open request within the duplicate window, keeping the larger amount, so the need is counted and served once.
                        The merge is visible on the Water requests page and an operator can split a merged request back out.</p>
                    </div>
                  )}
                </Panel>
              </div>

              <Panel title="Place by place" eyebrow="Highest priority first" bodyClassName="overflow-x-auto">
                <table className="table-cc">
                  <thead><tr><th>Place</th><th className="text-right">Priority</th><th className="text-right">Vulnerability</th><th className="text-right">Asked</th><th className="text-right">Requests</th>
                    <th className="text-right">FCFS coverage</th><th className="text-right">JalSetu coverage</th><th className="text-right">First water (day)</th></tr></thead>
                  <tbody>{(data.perPlace || []).slice(0, 60).map(p => (
                    <tr key={p.communityId}>
                      <td className="font-medium">{p.name}{p.vulnerable && <span className="ml-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-violet-700">vulnerable</span>}</td>
                      <td className="num text-right">{p.priority}</td><td className="num text-right">{p.vulnerability}</td>
                      <td className="num text-right">{litres(p.needLitres)}</td><td className="num text-right">{p.requests}{p.repeats ? <span className="text-cc-faint"> ({p.repeats} repeat)</span> : ''}</td>
                      <td className="num text-right" style={{ color: FCFS }}>{num(p.fcfsCoveragePct)}%</td>
                      <td className="num text-right font-semibold" style={{ color: JALSETU }}>{num(p.jalsetuCoveragePct)}%</td>
                      <td className="num text-right text-cc-muted">{p.fcfsFirstServedDay ?? '—'} → {p.jalsetuFirstServedDay ?? '—'}</td>
                    </tr>))}</tbody>
                </table>
              </Panel>

              <Panel title={<span className="flex items-center gap-2"><Info className="h-4 w-4 text-cc-faint" aria-hidden />How this is computed</span>}>
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-cc-muted">{data.assumptions?.map(x => <li key={x}>{x}</li>)}</ul>
                <p className="mt-2 text-[11.5px] text-cc-faint">{data.method} · generated {new Date(data.generatedAt!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
              </Panel>
            </>
          )}
        </div>
      )}
    </div>
  );
};
