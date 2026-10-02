import React, { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Building2, ChevronRight, ClipboardCheck, Droplets, MessageSquareWarning, RadioTower, Truck, Warehouse } from 'lucide-react';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { OpsMap, MapRoute } from '../components/map/OpsMap';
import { AlertPanel, VehiclePanel } from '../components/panels';
import { Button, Chip, cx, Empty, formatAge, Kpi, SeverityChip, StatusChip, Tabs, TrackingBadge } from '../components/ui';
import { timeAgo } from '../utils/format';

let statesCache: GeoJSON.FeatureCollection | null = null;
export function useStatesGeo() {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(statesCache);
  useEffect(() => { if (!statesCache) api.states().then(r => { statesCache = r; setFc(r); }).catch(() => undefined); }, []);
  return fc;
}

export function useAlertsGeo() {
  const { disasters } = useApp();
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => { api.disastersGeoJson().then(setFc).catch(() => undefined); }, [disasters]);
  return fc;
}

const SEV_RANK: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

export const CommandCenter: React.FC = () => {
  const { overview, vehicles, thresholds, serverOffsetMs, disasters, communities, depots, trips, anomalies, health, navigate, loaded } = useApp();
  const now = useNow(serverOffsetMs, 2000);
  const states = useStatesGeo();
  const alerts = useAlertsGeo();
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [scope, setScope] = useState<{ state?: { id: number; name: string }; bbox?: number[] }>({});
  const [fit, setFit] = useState<{ bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [alertId, setAlertId] = useState<number | null>(null);
  const [tab, setTab] = useState('alerts');

  const mapVehicles = useMemo(() => vehicles.map(v => ({ v, state: liveState(v, thresholds, now).state })), [vehicles, thresholds, now]);
  const routes: MapRoute[] = useMemo(() => trips.filter(t => ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering'].includes(t.status))
    .map(t => ({ id: t.id, coords: t.routeGeometry, kind: 'planned' as const, highlight: vehicles.find(v => v.vehicleId === vehicleId)?.trip?.id === t.id })), [trips, vehicles, vehicleId]);
  const sortedAlerts = useMemo(() => [...disasters].sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''))), [disasters]);

  const pickState = async (id: number, bbox: number[]) => {
    const f = states?.features.find((x: GeoJSON.Feature) => (x.properties as any).id === id);
    setScope({ state: { id, name: (f?.properties as any)?.name || 'State' }, bbox });
    setFit({ bbox, key: `s${id}` });
    setDistricts(await api.districts(id).catch(() => null));
  };
  const reset = () => { setScope({}); setDistricts(null); setFit({ bbox: [67.5, 6, 97.8, 37.4], key: `india${Date.now()}` }); };

  const o = overview;
  const feed = health?.sources.find(s => s.key === 'ndma_sachet');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {/* KPI strip — every number is a count of real backend records */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Active emergencies" value={o?.activeEmergencies ?? '—'} sub={`${o?.activeAlerts ?? 0} official alerts active`} tone={o?.activeEmergencies ? 'danger' : 'default'} icon={<AlertOctagon className="h-4 w-4" />} onClick={() => navigate('disasters')} />
        <Kpi label="Water requests" value={o?.activeRequests ?? '—'} sub={`${o?.criticalRequests ?? 0} critical, unassigned`} tone={o?.criticalRequests ? 'warn' : 'default'} icon={<Droplets className="h-4 w-4" />} onClick={() => navigate('requests')} />
        <Kpi label="Tankers on road" value={o?.tankersOnRoad ?? '—'} sub={`${o?.vehiclesLive ?? 0} live · ${o?.vehiclesStale ?? 0} stale · ${o?.vehiclesOffline ?? 0} offline`} tone="accent" icon={<Truck className="h-4 w-4" />} onClick={() => navigate('live')} />
        <Kpi label="Tankers available" value={o ? `${o.tankersAvailable}/${o.tankersTotal}` : '—'} sub="ready for assignment" tone="ok" icon={<Warehouse className="h-4 w-4" />} onClick={() => navigate('fleet')} />
        <Kpi label="Deliveries today" value={o?.deliveriesToday ?? '—'} sub={o ? `${o.litresDeliveredToday.toLocaleString('en-IN')} L · IST day` : ''} icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => navigate('verification')} />
        <Kpi label="Communities affected" value={o?.communitiesAffected ?? '—'} sub={`of ${o?.communitiesTotal ?? 0} registered, inside active alerts`} tone={o?.communitiesAffected ? 'warn' : 'default'} icon={<Building2 className="h-4 w-4" />} onClick={() => navigate('disasters')} />
        <Kpi label="Open complaints" value={o?.openComplaints ?? '—'} icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => navigate('complaints')} />
        <Kpi label="Open anomalies" value={o?.openAnomalies ?? '—'} sub={`${o?.pendingVerifications ?? 0} deliveries to verify`} tone={o?.openAnomalies ? 'warn' : 'default'} icon={<RadioTower className="h-4 w-4" />} onClick={() => navigate('live')} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel relative min-h-[420px] overflow-hidden">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-cc-border bg-cc-bg/85 px-2 py-1 text-xs backdrop-blur">
            <button className="font-medium text-cc-accent hover:underline" onClick={reset}>India</button>
            {scope.state && <><ChevronRight className="h-3 w-3 text-cc-faint" /><span>{scope.state.name}</span></>}
            {!scope.state && <span className="ml-1 text-cc-faint">· click a state to drill down</span>}
          </div>
          <div className="absolute bottom-8 left-3 z-10 hidden flex-col gap-1 rounded-lg border border-cc-border bg-cc-bg/85 p-2 text-2xs text-cc-muted backdrop-blur sm:flex">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />Vehicle LIVE</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />Vehicle STALE</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />Vehicle OFFLINE</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-[#a78bfa]" />Seeded reference community</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-3 bg-[#f97316]/40 border border-[#f97316]" />Official alert area</span>
            <span className="flex items-center gap-1.5"><i className="h-0 w-3 border-t-2 border-dashed border-[#38bdf8]" />Planned route</span>
          </div>
          <OpsMap vehicles={mapVehicles} communities={communities} depots={depots} alerts={alerts} states={states} districts={districts} routes={routes}
            selectedVehicleId={vehicleId} onVehicle={setVehicleId} onAlert={setAlertId} onState={pickState}
            onCommunity={(id) => { const c = communities.find(x => x.id === id); if (c) setFit({ center: [c.lat, c.lng], zoom: 14, key: `c${id}${Date.now()}` }); }}
            fit={fit} />
        </section>

        <aside className="panel flex min-h-[420px] flex-col overflow-hidden">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'alerts', label: `Alerts (${disasters.length})` },
            { id: 'fleet', label: `Fleet (${vehicles.length})` },
            { id: 'anomalies', label: `Anomalies (${anomalies.length})` },
            { id: 'feeds', label: 'Feeds' },
          ]} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'alerts' && (
              <>
                <div className="flex items-center justify-between border-b border-cc-border px-3 py-2 text-2xs text-cc-muted">
                  <span>Source: NDMA SACHET (CAP) · {feed?.status === 'connected' ? 'connected' : feed?.status ? <span className="text-amber-300">{feed.status}</span> : '…'}</span>
                  <span>{feed?.lastSuccessAt ? `synced ${timeAgo(feed.lastSuccessAt, now)}` : 'never synced'}</span>
                </div>
                {!loaded.has('disasters') ? <Empty title="Loading alerts…" /> : sortedAlerts.length === 0
                  ? <Empty title="No active official alerts" hint={feed?.status === 'connected' ? 'The alert feed is connected and reports nothing active.' : 'Alert feed is not connected; absence of alerts is not confirmed.'} />
                  : (
                    <ul className="divide-y divide-cc-border">
                      {sortedAlerts.slice(0, 80).map(a => (
                        <li key={a.id}>
                          <button onClick={() => setAlertId(a.id)} className="w-full px-3 py-2.5 text-left hover:bg-cc-hover">
                            <div className="flex items-center justify-between gap-2"><SeverityChip severity={a.severity} /><span className="text-2xs text-cc-faint">{timeAgo(a.publishedAt, now)}</span></div>
                            <p className="mt-1 line-clamp-2 text-sm">{a.headline}</p>
                            <p className="mt-0.5 truncate text-2xs text-cc-muted">{a.provider} · {a.areaDesc}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )}
            {tab === 'fleet' && (
              vehicles.length === 0 ? <Empty title="No vehicles registered" /> : (
                <ul className="divide-y divide-cc-border">
                  {[...mapVehicles].sort((a, b) => ['live', 'stale', 'offline', 'no_signal'].indexOf(a.state) - ['live', 'stale', 'offline', 'no_signal'].indexOf(b.state)).map(({ v }) => {
                    const ls = liveState(v, thresholds, now);
                    const moving = ls.state === 'live' && (v.position?.speedKmh ?? 0) >= 3;
                    return (
                      <li key={v.vehicleId}>
                        <button onClick={() => { setVehicleId(v.vehicleId); if (v.position) setFit({ center: [v.position.lat, v.position.lng], zoom: 15, key: `v${v.vehicleId}${Date.now()}` }); }}
                          className={cx('w-full px-3 py-2.5 text-left hover:bg-cc-hover', vehicleId === v.vehicleId && 'bg-cc-hover')}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{v.registration}</span>
                            <TrackingBadge state={ls.state} ageSeconds={ls.age} />
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-2xs text-cc-muted">
                            <span>{v.status}{v.trip ? ` · ${v.trip.id} → ${v.trip.destination ?? '—'}` : ''}</span>
                            <span>{ls.state === 'live' ? (moving ? `moving ${v.position?.speedKmh} km/h` : 'stationary') : ls.state === 'no_signal' ? 'no position yet' : 'marker frozen'}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
            {tab === 'anomalies' && (
              anomalies.length === 0 ? <Empty title="No open anomalies" hint="GPS jumps, stale telemetry, route deviations and prolonged stops appear here." /> : (
                <ul className="divide-y divide-cc-border">
                  {anomalies.map(a => (
                    <li key={a.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between"><Chip tone={a.kind === 'route_deviation' || a.kind === 'gps_jump' ? 'warn' : 'danger'}>{a.kind.replace(/_/g, ' ')}</Chip><span className="text-2xs text-cc-faint">{timeAgo(a.detectedAt, now)}</span></div>
                      <p className="mt-1 text-xs text-cc-muted">{a.vehicleId} {a.tripId ? `· ${a.tripId}` : ''} {a.value != null ? `· ${Math.round(a.value)}${a.kind === 'route_deviation' ? ' m off route' : a.kind === 'gps_jump' ? ' km/h implied' : ''}` : ''}</p>
                      <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => navigate('live')}>Open in live operations</Button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'feeds' && (
              <ul className="divide-y divide-cc-border">
                {(health?.sources || []).map(s => (
                  <li key={s.key} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="text-sm">{s.name}</span><StatusChip status={s.status} /></div>
                    <p className="mt-0.5 text-2xs text-cc-muted">{s.lastSuccessAt ? `last success ${timeAgo(s.lastSuccessAt, now)}` : 'no successful sync'}{s.lastError ? ` · ${s.lastError.slice(0, 120)}` : ''}</p>
                  </li>
                ))}
                {health && <li className="px-3 py-2.5 text-xs text-cc-muted">GPS ingestion: {health.gpsIngestion.fixesLast10Min} fixes in 10 min · last {health.gpsIngestion.lastFixReceivedAt ? `${formatAge((now - Date.parse(health.gpsIngestion.lastFixReceivedAt)) / 1000)} ago` : 'never'}</li>}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <VehiclePanel id={vehicleId} onClose={() => setVehicleId(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 16, key: `f${Date.now()}` })}
        onOpenTrip={(ref) => navigate(`trips/${ref}`)} />
      <AlertPanel id={alertId} onClose={() => setAlertId(null)} onZoom={(bbox) => { setAlertId(null); setFit({ bbox, key: `a${Date.now()}` }); }} />
    </div>
  );
};

