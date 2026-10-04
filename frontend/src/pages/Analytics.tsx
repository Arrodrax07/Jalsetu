import React, { useEffect, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { AXIS_TICK, GRID, REFERENCE, SERIES, kLitres, shortDate, tooltipStyle } from '../components/charts/theme';
import { Chip, Empty, KindLabel, Kpi, Loading, PageHeader, Panel, Segmented } from '../components/ui';
import { FlaskConical } from '../components/icons';
import type { CityForecast, ImpactStats, OperationsMetrics } from '../types';
import { km, litres, num, pct } from '../utils/format';


// Every check in domain.ANOMALY_KINDS, so a zero reads as "checked, none found" rather than missing.
const ANOMALIES: [string, string, string][] = [
  ['telemetry_stale', 'Telemetry stale', 'Active trip with no fix for longer than the offline threshold'],
  ['route_deviation', 'Route deviation', 'Sustained distance from the planned route'],
  ['prolonged_stop', 'Prolonged stop', 'Stationary on an active trip, away from any stop'],
  ['gps_jump', 'GPS jump', 'Implied speed between two fixes is physically implausible'],
  ['low_accuracy', 'Low accuracy', 'Reported accuracy worse than the threshold for consecutive fixes'],
  ['invalid_fix', 'Invalid fix', 'Out-of-range or null-island coordinates, rejected'],
];

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
          <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-cc-border bg-cc-border md:grid-cols-4 [&>button]:rounded-none [&>button]:bg-cc-surface">
            <Kpi label="Trips completed" value={ops.tripsCompleted} sub={`${ops.tripsStarted} started · ${ops.tripsCancelled} cancelled`} tone="ok" />
            <Kpi label="Completion rate" value={pct(ops.completionRatePct, 1)} sub="of started trips" />
            <Kpi label="Start → arrival" value={ops.avgStartToArrivalMin != null ? `${ops.avgStartToArrivalMin} min` : '—'} sub={ops.synthetic.trips ? 'real: GPS-detected · synthetic: estimated' : 'GPS-detected, average'} />
            <Kpi label="Start → completion" value={ops.avgStartToCompletionMin != null ? `${ops.avgStartToCompletionMin} min` : '—'} sub="incl. verification" />
            <Kpi label="Water delivered" value={litres(ops.litresDelivered)} sub={`${ops.deliveriesVerified}/${ops.deliveries} deliveries verified`} tone="accent" />
            <Kpi label="GPS distance" value={km(ops.gpsKmTravelled)} sub="from real telemetry" />
            <Kpi label="Request → fulfilment" value={ops.avgRequestToFulfilmentHours != null ? `${ops.avgRequestToFulfilmentHours} h` : '—'} sub={`${ops.requestsFulfilled}/${ops.requestsCreated} fulfilled`} />
            <Kpi label="Fleet utilisation" value={pct(ops.fleetUtilisationPct, 1)} sub="time on started trips" />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Panel title="Litres delivered and trips completed, per day (IST)">
              {ops.daily.length === 0 ? <Empty title="No completed trips or deliveries in this window" /> : (
                <div className="h-64 xl:h-[22rem]"><ResponsiveContainer><ComposedChart data={ops.daily} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                  <YAxis yAxisId="t" orientation="right" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => n === 'Litres delivered' ? [litres(v), n] : [v, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="litres" name="Litres delivered" fill={SERIES[0]} fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={22} />
                  <Line yAxisId="t" dataKey="trips" name="Trips completed" stroke={SERIES[2]} strokeWidth={2} dot={false} type="monotone" />
                </ComposedChart></ResponsiveContainer></div>
              )}
            </Panel>
            <Panel title="Telemetry checks" eyebrow="Anomalies raised by the tracker in this window">
              <ul className="divide-y divide-cc-border/70">
                {ANOMALIES.map(([k, label, hint]) => {
                  const v = ops.anomaliesByKind[k] ?? 0;
                  const max = Math.max(1, ...Object.values(ops.anomaliesByKind));
                  return (
                    <li key={k} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 py-2">
                      <div className="min-w-0">
                        <p className={v ? 'text-[13px] font-medium text-cc-text' : 'text-[13px] text-cc-muted'}>{label}</p>
                        <p className="truncate text-[11.5px] text-cc-faint" title={hint}>{hint}</p>
                        {v > 0 && <div className="mt-1 h-1 rounded-full bg-cc-hover"><div className="h-full rounded-full bg-cc-warn" style={{ width: `${(100 * v) / max}%` }} /></div>}
                      </div>
                      <span className={v ? 'num text-right text-[15px] font-semibold text-cc-text' : 'num text-right text-[13px] text-cc-faint'}>{v}</span>
                    </li>
                  );
                })}
              </ul>
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
                <YAxis tickFormatter={kLitres} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} domain={['auto', 'auto']} />
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

