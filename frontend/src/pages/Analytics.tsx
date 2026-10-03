import React, { useEffect, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { AXIS_TICK, GRID, REFERENCE, SERIES, kLitres, tooltipStyle } from '../components/charts/theme';
import { Chip, Empty, KindLabel, Kpi, Loading, PageHeader, Panel, Segmented } from '../components/ui';
import { FlaskConical } from 'lucide-react';
import type { CityForecast, ImpactStats, OperationsMetrics } from '../types';
import { km, litres, num, pct } from '../utils/format';


export const Analytics: React.FC = () => {
  const { fail } = useApp();
  const [days, setDays] = useState(30);
  const [origin, setOrigin] = useState<'all' | 'real'>('all');
  const [ops, setOps] = useState<OperationsMetrics | null>(null);
  const [impact, setImpact] = useState<ImpactStats | null>(null);
  const [forecast, setForecast] = useState<CityForecast | null>(null);
  const [fcErr, setFcErr] = useState<string | null>(null);

  useEffect(() => {
    setOps(null);
    api.operations(days, origin).then(setOps).catch(fail);
  }, [days, origin, fail]);
  useEffect(() => { api.impact().then(setImpact).catch(fail); api.forecast(7).then(setForecast).catch(e => setFcErr(e.message)); }, [fail]);

  const fc = forecast?.days.map(d => ({ date: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), band: [d.p10, d.p90], Forecast: d.p50, Baseline: d.baseline })) || [];

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Analytics" subtitle="Computed from stored trips, telemetry, deliveries, requests and complaints. Metrics with no underlying records show “—”."
        actions={<>
          <Segmented value={String(days)} onChange={v => setDays(Number(v))} options={[7, 30, 90].map(d => ({ id: String(d), label: `${d} days` }))} />
          <Segmented value={origin} onChange={v => setOrigin(v as 'all' | 'real')} options={[{ id: 'all', label: 'All records' }, { id: 'real', label: 'Real only' }]} />
        </>} />
      {ops && origin === 'all' && (ops.synthetic.trips + ops.synthetic.deliveries + ops.synthetic.requests) > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-cc-muted">
          <Chip tone="predicted" icon={<FlaskConical className="h-3 w-3" aria-hidden />}>Includes synthetic demo history</Chip>
          {ops.synthetic.trips} trips, {ops.synthetic.deliveries} deliveries and {ops.synthetic.requests} requests in this window are labelled synthetic (no GPS). Switch to “Real only” to exclude them.
        </div>
      )}
      {!ops ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Trips completed" value={ops.tripsCompleted} sub={`${ops.tripsStarted} started · ${ops.tripsCancelled} cancelled`} tone="ok" />
            <Kpi label="Completion rate" value={pct(ops.completionRatePct, 1)} sub="of started trips" />
            <Kpi label="Start → arrival" value={ops.avgStartToArrivalMin != null ? `${ops.avgStartToArrivalMin} min` : '—'} sub={ops.synthetic.trips ? 'real: GPS-detected · synthetic: estimated' : 'GPS-detected, average'} />
            <Kpi label="Start → completion" value={ops.avgStartToCompletionMin != null ? `${ops.avgStartToCompletionMin} min` : '—'} sub="incl. verification" />
            <Kpi label="Water delivered" value={litres(ops.litresDelivered)} sub={`${ops.deliveriesVerified}/${ops.deliveries} deliveries verified`} tone="accent" />
            <Kpi label="GPS distance" value={km(ops.gpsKmTravelled)} sub="from real telemetry" />
            <Kpi label="Request → fulfilment" value={ops.avgRequestToFulfilmentHours != null ? `${ops.avgRequestToFulfilmentHours} h` : '—'} sub={`${ops.requestsFulfilled}/${ops.requestsCreated} fulfilled`} />
            <Kpi label="Fleet utilisation" value={pct(ops.fleetUtilisationPct, 1)} sub="time on started trips" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Daily completed trips and litres delivered (IST)">
              {ops.daily.length === 0 ? <Empty title="No completed trips or deliveries in this window" /> : (
                <div className="h-64"><ResponsiveContainer><BarChart data={ops.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#17213333' }} formatter={(v: any, n: any) => [n === 'litres' ? litres(v) : v, n === 'litres' ? 'Litres delivered' : 'Trips completed']} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3bd' }} formatter={(v) => v === 'litres' ? 'Litres delivered' : v} />
                  <Bar yAxisId="l" dataKey="litres" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart></ResponsiveContainer></div>
              )}
            </Panel>
            <Panel title="GPS anomalies recorded" actions={<span className="text-2xs text-cc-muted">route deviations: {ops.routeDeviations}</span>}>
              {Object.keys(ops.anomaliesByKind).length === 0 ? <Empty title="No anomalies in this window" /> : (
                <ul className="space-y-2">{Object.entries(ops.anomaliesByKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
                  const max = Math.max(...Object.values(ops.anomaliesByKind));
                  return <li key={k} className="text-sm"><div className="flex justify-between"><span className="capitalize">{k.replace(/_/g, ' ')}</span><span className="num">{v}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-cc-bg"><div className="h-full rounded-full" style={{ width: `${(100 * v) / max}%`, background: SERIES[1] }} /></div></li>;
                })}</ul>
              )}
            </Panel>
          </div>
        </>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2">Demand forecast, next 7 days <KindLabel kind="predicted" /></span>}
          actions={forecast && <span className="text-2xs text-cc-muted">weather: {forecast.weatherSource}</span>}>
          {fcErr ? <Empty title="Forecast unavailable" hint={fcErr} /> : !forecast ? <Loading /> : (
            <>
              <div className="h-60"><ResponsiveContainer><ComposedChart data={fc} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => Array.isArray(v) ? [`${litres(v[0])} – ${litres(v[1])}`, '80% interval'] : [litres(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3bd' }} />
                <Area dataKey="band" name="80% interval" stroke="none" fill={SERIES[0]} fillOpacity={0.15} isAnimationActive={false} />
                <Line dataKey="Forecast" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="Baseline" stroke={REFERENCE} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>
              <p className="mt-2 text-2xs text-cc-faint">Advisory. Trained on real Open-Meteo weather with a documented simulated demand response; recalibrate with real metered observations before relying on it.</p>
            </>
          )}
        </Panel>
        <Panel title="Complaints and deliveries (all time)">
          {!impact ? <Loading /> : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Kpi label="Complaints" value={impact.complaints.total} sub={`${impact.complaints.resolved} resolved`} />
              <Kpi label="Duplicates linked" value={impact.complaints.duplicatesDetected} sub={pct(impact.complaints.duplicateRatePct, 1)} />
              <Kpi label="Model agreement" value={pct(impact.complaints.modelAgreementPct, 1)} sub={`${impact.complaints.officerVerifiedLabels} officer-verified labels`} />
              <Kpi label="Avg resolution" value={impact.complaints.avgResolutionHours != null ? `${impact.complaints.avgResolutionHours} h` : '—'} />
              <Kpi label="Deliveries flagged" value={impact.deliveries.mismatches} sub={`of ${impact.deliveries.total}`} tone={impact.deliveries.mismatches ? 'warn' : 'default'} />
              <Kpi label="Geofence pass" value={pct(impact.deliveries.geofencePassPct, 1)} sub={`net variance ${num(impact.deliveries.netVarianceLitres)} L`} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

