import React, { useEffect, useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CloudSun, Droplets, AlertOctagon, Activity, Loader2 } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { api } from '../services/api';
import type { ActivityProfile, CityForecast } from '../types';
import { AXIS_TICK, GRID, REFERENCE, SERIES, kLitres, tooltipStyle } from '../components/charts/theme';
import { litres } from '../utils/format';

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }> = ({ title, subtitle, children, right }) => (
  <div className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle">
    <div className="flex items-start justify-between mb-3 gap-3">
      <div><h3 className="text-sm font-bold text-slate-900">{title}</h3>{subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}</div>
      {right}
    </div>
    {children}
  </div>
);

export const DemandAnalysis: React.FC = () => {
  const { communities, handleError } = useWaterData();
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [activity, setActivity] = useState<ActivityProfile | null>(null);
  const [forecast, setForecast] = useState<CityForecast | null>(null);
  const [fcError, setFcError] = useState<string | null>(null);

  useEffect(() => { api.activity(range).then(setActivity).catch(e => handleError(e, 'Activity unavailable')); }, [range, handleError]);
  useEffect(() => { api.forecast(7).then(setForecast).catch(e => setFcError(e.message)); }, []);

  const totals = useMemo(() => ({
    demand: communities.reduce((a, c) => a + c.dailyDemand, 0),
    allocated: communities.reduce((a, c) => a + c.allocatedWater, 0),
    shortfall: communities.reduce((a, c) => a + c.shortfall, 0),
  }), [communities]);

  const perCommunity = [...communities].sort((a, b) => b.dailyDemand - a.dailyDemand).map(c => ({ name: c.name, Demand: c.dailyDemand, Allocated: c.allocatedWater }));
  const shortfallRank = [...communities].filter(c => c.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  const maxShort = Math.max(1, ...shortfallRank.map(c => c.shortfall));
  const fcData = forecast?.days.map(d => ({
    date: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
    band: [d.p10, d.p90] as [number, number], Forecast: d.p50, Baseline: d.baseline, tempMax: d.tempMax, precip: d.precipMm,
  })) || [];
  const peakDay = forecast?.days.reduce((m, d) => (d.p50 > (m?.p50 ?? 0) ? d : m), forecast.days[0]);
  const vulnBuckets = (['Very High', 'High', 'Medium', 'Low'] as const).map(v => ({ v, n: communities.filter(c => c.vulnerability === v).length, pop: communities.filter(c => c.vulnerability === v).reduce((a, c) => a + c.population, 0) }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Demand, Forecast & Vulnerability</h2>
        <p className="text-xs text-slate-500 mt-1">Demand forecast = community baseline × ML demand index driven by live Open-Meteo weather (heat, rainfall, season).</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Baseline daily demand', value: litres(totals.demand), icon: <Droplets className="w-5 h-5 text-sky-600" /> },
          { label: 'Currently allocated', value: `${litres(totals.allocated)} (${Math.round(100 * totals.allocated / Math.max(totals.demand, 1))}%)`, icon: <Activity className="w-5 h-5 text-sky-600" /> },
          { label: 'Unmet daily need', value: litres(totals.shortfall), icon: <AlertOctagon className="w-5 h-5 text-rose-600" /> },
        ].map(k => (
          <div key={k.label} className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-subtle flex items-center justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{k.label}</p><p className="text-xl font-bold text-slate-900 mt-1">{k.value}</p></div>{k.icon}
          </div>
        ))}
      </div>

      <Card title="City-wide demand forecast, next 7 days" subtitle={forecast ? `Shaded band = 80% prediction interval · weather: ${forecast.weatherSource}` : undefined}
        right={<CloudSun className="w-5 h-5 text-sky-600" />}>
        {fcError ? <p className="text-xs text-rose-700">{fcError}</p> : !forecast ? <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Fetching weather and running model…</p> : (
          <>
            {peakDay && <p className="text-xs text-slate-700 mb-2">Peak expected <strong>{new Date(peakDay.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</strong>: {litres(peakDay.p50)} ({peakDay.p50 >= peakDay.baseline ? '+' : ''}{Math.round(100 * (peakDay.p50 / peakDay.baseline - 1))}% vs baseline, {peakDay.tempMax}°C).</p>}
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={fcData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, name: any) => Array.isArray(v) ? [`${litres(v[0])} – ${litres(v[1])}`, '80% interval'] : [litres(v), name]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="band" name="80% interval" stroke="none" fill={SERIES[0]} fillOpacity={0.12} isAnimationActive={false} />
                  <Line dataKey="Forecast" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
                  <Line dataKey="Baseline" stroke={REFERENCE} strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2 text-center text-[10px] text-slate-500">
              {fcData.map(d => <div key={d.date}><span className="font-semibold text-slate-700">{d.tempMax}°C</span><br />{d.precip} mm</div>)}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card title="Baseline demand vs allocated, by community" subtitle="Litres per day">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={perCommunity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [litres(v), n]} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Demand" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Allocated" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <Card title="Shortfall ranking" subtitle="Unmet litres per day">
          {shortfallRank.length === 0 ? <p className="text-xs text-slate-500">No community has a shortfall.</p> : (
            <ul className="space-y-2.5">
              {shortfallRank.map(c => (
                <li key={c.id} className="text-xs" title={`${c.currentCoverage}% covered`}>
                  <div className="flex justify-between mb-1"><span className="font-semibold text-slate-800">{c.name}</span><span className="text-slate-600">{litres(c.shortfall)}</span></div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(100 * c.shortfall) / maxShort}%`, background: SERIES[0] }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Vulnerability distribution" subtitle="Communities and residents per band">
          <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">
            {vulnBuckets.map(b => (
              <tr key={b.v}><td className="py-2 font-semibold text-slate-800">{b.v}</td><td className="py-2 text-right text-slate-600">{b.n} communities</td><td className="py-2 text-right text-slate-600">{b.pop.toLocaleString('en-IN')} people</td></tr>
            ))}
          </tbody></table>
        </Card>
        <div className="lg:col-span-2">
          <Card title="Requests & complaints by hour of day (IST)"
            right={<div className="flex gap-1">{(['today', '7d', '30d'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${range === r ? 'bg-sky-600 text-white' : 'bg-slate-50 text-slate-600'}`}>{r === 'today' ? '24 h' : r}</button>))}</div>}>
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={activity?.hourly || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={2} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="requests" name="Requests" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={12} />
                  <Bar dataKey="complaints" name="Complaints" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
