import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertOctagon, ArrowRight, Building2, ChevronRight, ClipboardCheck, Droplets, MessageSquareWarning, Sparkles, Truck } from 'lucide-react';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { MAP_COLORS, OpsMap, MapRoute } from '../components/map/OpsMap';
import { AlertPanel, VehiclePanel } from '../components/panels';
import { CrisisSignals } from '../components/CrisisSignals';
import { CommunitySheet } from '../components/CommunitySheet';
import { Button, Chip, cx, EASE, Empty, formatAge, Kpi, SeverityChip, Stagger, StatusChip, Tabs, TrackingBadge } from '../components/ui';
import { districtName, timeAgo } from '../utils/format';

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
const HOME_BBOX = [72.6, 15.6, 80.9, 22.1];

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** One plain-language sentence describing today's situation, computed from live data. */
function useSituation() {
  const { communities } = useApp();
  return useMemo(() => {
    const high = communities.filter(c => (c.crisisScore ?? 0) >= 30);
    const critical = communities.filter(c => (c.crisisScore ?? 0) >= 70);
    const byDistrict = new Map<string, number>();
    critical.forEach(c => c.districtName && byDistrict.set(c.districtName, (byDistrict.get(c.districtName) ?? 0) + 1));
    const top = [...byDistrict.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => districtName(d));
    const people = high.reduce((s, c) => s + c.population, 0);
    return { high: high.length, critical: critical.length, top, people, total: communities.length };
  }, [communities]);
}

const Legend: React.FC = () => {
  const [open, setOpen] = useState(true);
  const rows: [React.ReactNode, string][] = [
    [<i className="h-2.5 w-2.5 rounded-full" style={{ background: MAP_COLORS.critical }} />, 'Critical'],
    [<i className="h-2.5 w-2.5 rounded-full" style={{ background: MAP_COLORS.high }} />, 'High demand'],
    [<i className="h-2.5 w-2.5 rounded-full" style={{ background: MAP_COLORS.normal }} />, 'Normal'],
    [<i className="h-3.5 w-3.5 rounded-full opacity-60 blur-[2px]" style={{ background: '#d96a2b' }} />, 'Crisis signal strength'],
    [<i className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: MAP_COLORS.depot }} />, 'Depot (real water site)'],
    [<i className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: '#169648' }} />, 'Tanker, live GPS'],
    [<i className="h-2 w-3 rounded-sm border border-[#cc5422] bg-[#cc5422]/30" />, 'Official alert area'],
  ];
  return (
    <div className="absolute bottom-3 left-3 z-10 hidden sm:block">
      <button onClick={() => setOpen(o => !o)} className="mb-1.5 rounded-full border border-cc-border bg-cc-surface/90 px-3 py-1 text-[11px] font-medium shadow-panel backdrop-blur">
        {open ? 'Hide legend' : 'Legend'}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2 }}
            className="space-y-1 rounded-2xl border border-cc-border bg-cc-surface/90 p-3 text-[11.5px] text-cc-muted shadow-panel backdrop-blur">
            {rows.map(([icon, label]) => <li key={label} className="flex items-center gap-2"><span className="flex w-4 justify-center">{icon}</span>{label}</li>)}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};

export const CommandCenter: React.FC = () => {
  const { overview, vehicles, thresholds, serverOffsetMs, disasters, communities, depots, trips, anomalies, health, navigate, loaded, route, signals, proposals, can, refresh } = useApp();
  const now = useNow(serverOffsetMs, 2000);
  const states = useStatesGeo();
  const alerts = useAlertsGeo();
  const situation = useSituation();
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [scope, setScope] = useState<{ state?: { id: number; name: string }; bbox?: number[] }>({});
  const [fit, setFit] = useState<{ bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [alertId, setAlertId] = useState<number | null>(null);
  const [tab, setTab] = useState('crisis');
  const communityId = route.startsWith('overview/') ? route.slice('overview/'.length) : null;

  useEffect(() => { if (!loaded.has('proposals')) refresh('proposals'); }, [loaded, refresh]);
  useEffect(() => {
    const c = communityId ? communities.find(x => x.id === communityId) : null;
    if (c) setFit({ center: [c.lat, c.lng], zoom: 11, key: `c${c.id}` });
  }, [communityId, communities]);

  const openCommunity = (id: string) => navigate(`overview/${id}`);
  const mapVehicles = useMemo(() => vehicles.map(v => ({ v, state: liveState(v, thresholds, now).state })), [vehicles, thresholds, now]);
  const routes: MapRoute[] = useMemo(() => trips.filter(t => ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering'].includes(t.status))
    .map(t => ({ id: t.id, coords: t.routeGeometry, kind: 'planned' as const, highlight: vehicles.find(v => v.vehicleId === vehicleId)?.trip?.id === t.id })), [trips, vehicles, vehicleId]);
  const sortedAlerts = useMemo(() => [...disasters].sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''))), [disasters]);
  const pendingProposals = proposals.filter(p => p.status === 'Proposed').length;
  const toReview = signals.filter(s => s.kind === 'news' && s.status === 'unverified').length;

  const pickState = async (id: number, bbox: number[]) => {
    const f = states?.features.find((x: GeoJSON.Feature) => (x.properties as any).id === id);
    setScope({ state: { id, name: (f?.properties as any)?.name || 'State' }, bbox });
    setFit({ bbox, key: `s${id}` });
    setDistricts(await api.districts(id).catch(() => null));
  };
  const reset = () => { setScope({}); setDistricts(null); setFit({ bbox: HOME_BBOX, key: `home${Date.now()}` }); };

  const o = overview;
  const feed = health?.sources.find(s => s.key === 'ndma_sachet');
  const today = new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
      {/* Situation headline */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="min-w-0">
          <p className="eyebrow mb-1.5">Maharashtra · {today}</p>
          {loaded.has('communities') ? (
            <h1 className="display max-w-4xl text-[30px] leading-[1.08] text-cc-text md:text-[38px]">
              <span className="text-cc-text">{situation.high.toLocaleString('en-IN')} places</span> under water stress
              {situation.critical > 0 && <>, <em style={{ color: MAP_COLORS.critical }}>{situation.critical} critical</em></>}
              {situation.top.length > 0 && <span className="text-cc-muted">, concentrated in {list(situation.top)}.</span>}
            </h1>
          ) : <div className="h-10 w-[480px] max-w-full animate-pulse rounded-xl bg-cc-hover" />}
          <p className="mt-2 text-sm text-cc-muted">
            {situation.people > 0 && <>{(situation.people / 1e6).toFixed(1)} million people live in affected places · </>}
            evidence from rainfall records and {signals.filter(s => s.kind === 'news').length} news reports{toReview > 0 && <> · <button className="font-medium text-cc-accent underline decoration-cc-accent/30 underline-offset-4 hover:decoration-cc-accent" onClick={() => setTab('crisis')}>{toReview} to review</button></>}
          </p>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }} className="flex flex-shrink-0 items-center gap-2">
          {can('dispatch') && (
            <Button variant="primary" className="group" icon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('trips')}>
              {pendingProposals ? `Review ${pendingProposals} proposed trips` : 'Plan tanker trips'}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          )}
        </motion.div>
      </div>

      {/* KPI strip: every number is a count of real backend records */}
      <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" step={0.05}>
        <Kpi label="Places in crisis" value={loaded.has('communities') ? situation.high : '—'} sub={`${situation.critical} critical of ${situation.total.toLocaleString('en-IN')}`} tone={situation.critical ? 'danger' : 'warn'} icon={<Building2 className="h-4 w-4" />} onClick={() => setTab('crisis')} />
        <Kpi label="Official alerts" value={o?.activeEmergencies ?? '—'} sub={`${o?.activeAlerts ?? 0} active · NDMA SACHET`} tone={o?.activeEmergencies ? 'warn' : 'ok'} icon={<AlertOctagon className="h-4 w-4" />} onClick={() => navigate('disasters')} />
        <Kpi label="Water requests" value={o?.activeRequests ?? '—'} sub={`${o?.criticalRequests ?? 0} critical, unassigned`} tone={o?.criticalRequests ? 'danger' : 'accent'} icon={<Droplets className="h-4 w-4" />} onClick={() => navigate('requests')} />
        <Kpi label="Tankers" value={o ? o.tankersAvailable : '—'} sub={o ? `available of ${o.tankersTotal} · ${o.tankersOnRoad} on the road` : ''} tone="accent" icon={<Truck className="h-4 w-4" />} onClick={() => navigate('fleet')} />
        <Kpi label="Delivered today" value={o?.deliveriesToday ?? '—'} sub={o ? `${o.litresDeliveredToday.toLocaleString('en-IN')} L verified by GPS` : ''} tone="teal" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => navigate('verification')} />
        <Kpi label="Open complaints" value={o?.openComplaints ?? '—'} sub={`${o?.openAnomalies ?? 0} tracking anomalies`} tone={o?.openComplaints ? 'violet' : 'ok'} icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => navigate('complaints')} />
      </Stagger>

      <div className="grid flex-none grid-cols-1 gap-4 lg:h-[max(560px,calc(100vh-140px))] lg:grid-cols-[minmax(0,1fr)_400px]">
        <motion.section initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
          className="panel relative min-h-[520px] overflow-hidden">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full border border-cc-border bg-cc-surface/90 px-3 py-1.5 text-xs shadow-panel backdrop-blur">
            <button className="font-semibold text-cc-text hover:text-cc-accent" onClick={reset}>Maharashtra</button>
            {scope.state && <><ChevronRight className="h-3 w-3 text-cc-faint" /><span>{scope.state.name}</span></>}
            {!scope.state && <span className="ml-1 hidden text-cc-faint md:inline">· click the state for district borders</span>}
          </div>
          <Legend />
          <OpsMap cinematic vehicles={mapVehicles} communities={communities} depots={depots} alerts={alerts} states={states} districts={districts} routes={routes}
            selectedVehicleId={vehicleId} selectedCommunityId={communityId} onVehicle={setVehicleId} onAlert={setAlertId} onState={pickState}
            onCommunity={openCommunity} fit={fit} />
        </motion.section>

        <motion.aside initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.6, ease: EASE }}
          className="panel flex min-h-[520px] flex-col overflow-hidden">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'crisis', label: <span className="flex items-center gap-1.5">Crisis signals{toReview > 0 && <span className="num rounded-full bg-cc-warn/15 px-1.5 text-[10px] font-semibold text-amber-800">{toReview}</span>}</span> },
            { id: 'alerts', label: `Alerts ${disasters.length}` },
            { id: 'fleet', label: `Fleet ${vehicles.length}` },
            { id: 'anomalies', label: `Anomalies ${anomalies.length}` },
            { id: 'feeds', label: 'Sources' },
          ]} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'crisis' && <CrisisSignals compact onPlace={openCommunity} />}
            {tab === 'alerts' && (
              <>
                <div className="flex items-center justify-between border-b border-cc-border px-4 py-2 text-[11px] text-cc-muted">
                  <span>NDMA SACHET (CAP) · {feed?.status === 'connected' ? 'connected' : feed?.status ? <span className="text-amber-800">{feed.status}</span> : '…'}</span>
                  <span>{feed?.lastSuccessAt ? `synced ${timeAgo(feed.lastSuccessAt, now)}` : 'never synced'}</span>
                </div>
                {!loaded.has('disasters') ? <Empty title="Loading alerts…" /> : sortedAlerts.length === 0
                  ? <Empty title="No active official alerts" hint={feed?.status === 'connected' ? 'The alert feed is connected and reports nothing active.' : 'Alert feed is not connected; absence of alerts is not confirmed.'} />
                  : (
                    <ul className="divide-y divide-cc-border">
                      {sortedAlerts.slice(0, 80).map(a => (
                        <li key={a.id}>
                          <button onClick={() => setAlertId(a.id)} className="w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60">
                            <div className="flex items-center justify-between gap-2"><SeverityChip severity={a.severity} /><span className="text-[11px] text-cc-faint">{timeAgo(a.publishedAt, now)}</span></div>
                            <p className="mt-1.5 line-clamp-2 text-sm leading-snug">{a.headline}</p>
                            <p className="mt-0.5 truncate text-[11px] text-cc-muted">{a.provider} · {a.areaDesc}</p>
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
                          className={cx('w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60', vehicleId === v.vehicleId && 'bg-cc-hover/60')}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{v.registration}</span>
                            <TrackingBadge state={ls.state} ageSeconds={ls.age} />
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-cc-muted">
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
                    <li key={a.id} className="px-4 py-3">
                      <div className="flex items-center justify-between"><Chip tone={a.kind === 'route_deviation' || a.kind === 'gps_jump' ? 'warn' : 'danger'}>{a.kind.replace(/_/g, ' ')}</Chip><span className="text-[11px] text-cc-faint">{timeAgo(a.detectedAt, now)}</span></div>
                      <p className="mt-1 text-xs text-cc-muted">{a.vehicleId} {a.tripId ? `· ${a.tripId}` : ''} {a.value != null ? `· ${Math.round(a.value)}${a.kind === 'route_deviation' ? ' m off route' : a.kind === 'gps_jump' ? ' km/h implied' : ''}` : ''}</p>
                      <Button size="sm" variant="ghost" className="-ml-2 mt-1" onClick={() => navigate('live')}>Open in live operations</Button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'feeds' && (
              <ul className="divide-y divide-cc-border">
                {(health?.sources || []).map(s => (
                  <li key={s.key} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2"><span className="text-sm">{s.name}</span><StatusChip status={s.status} /></div>
                    <p className="mt-0.5 text-[11px] text-cc-muted">{s.lastSuccessAt ? `last success ${timeAgo(s.lastSuccessAt, now)}` : 'no successful sync'}{s.lastError ? ` · ${s.lastError.slice(0, 120)}` : ''}</p>
                  </li>
                ))}
                {health && <li className="px-4 py-3 text-xs text-cc-muted">GPS ingestion: {health.gpsIngestion.fixesLast10Min} fixes in 10 min · last {health.gpsIngestion.lastFixReceivedAt ? `${formatAge((now - Date.parse(health.gpsIngestion.lastFixReceivedAt)) / 1000)} ago` : 'never'}</li>}
              </ul>
            )}
          </div>
        </motion.aside>
      </div>

      <CommunitySheet id={communityId} onClose={() => navigate('overview')} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 13, key: `f${Date.now()}` })} />
      <VehiclePanel id={vehicleId} onClose={() => setVehicleId(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 16, key: `f${Date.now()}` })}
        onOpenTrip={(ref) => navigate(`trips/${ref}`)} />
      <AlertPanel id={alertId} onClose={() => setAlertId(null)} onZoom={(bbox) => { setAlertId(null); setFit({ bbox, key: `a${Date.now()}` }); }} />
    </div>
  );
};
