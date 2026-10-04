/**
 * Command centre: the map is the working surface. The situation and metrics float over it; a docked rail holds
 * the intelligence lists and turns into a detail view when anything is selected (on the map or in a list), while
 * the map flies to and highlights the same object. Nothing navigates away unless asked.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertOctagon, ArrowRight, Building2, CaretLeft, ChevronRight, ClipboardCheck, Droplets, MessageSquareWarning, Sparkles, Truck, X,
} from '../components/icons';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { MAP_COLORS, OpsMap, MapRoute } from '../components/map/OpsMap';
import { AlertDetail, VehicleDetail } from '../components/panels';
import { CrisisSignals } from '../components/CrisisSignals';
import { CommunityDetail, communitySubtitle } from '../components/CommunitySheet';
import { Button, Chip, cx, Empty, formatAge, Kpi, ProvMark, SeverityChip, Stagger, StatusChip, Tabs, TrackingBadge } from '../components/ui';
import { DUR, EASE_OUT, SPRING_SHEET } from '../motion';
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
const RAIL_W = 404;

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
  const [open, setOpen] = useState(false);
  const dot = (c: string) => <i className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
  const rows: [React.ReactNode, string][] = [
    [dot(MAP_COLORS.critical), 'Critical place'], [dot(MAP_COLORS.high), 'High demand'], [dot(MAP_COLORS.normal), 'Normal'],
    [<i className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#c2361f] text-[7px] font-bold">n</i>, 'Group of places (ring: worst status)'],
    [<i className="h-3.5 w-3.5 rounded-full opacity-60 blur-[2px]" style={{ background: '#d96a2b' }} />, 'Crisis signal strength'],
    [<i className="h-2.5 w-2.5 rounded-full ring-2 ring-cc-surface" style={{ background: 'rgb(var(--cc-ink))' }} />, 'Depot on a real water site'],
    [<ProvMark kind="live" className="!h-2.5 !w-2.5" />, 'Tanker, live GPS'],
    [<ProvMark kind="stale" className="!h-2.5 !w-2.5" />, 'Tanker, stale (hollow)'],
    [<ProvMark kind="offline" className="!h-2.5 !w-2.5" />, 'Tanker, offline (struck)'],
    [<i className="h-2 w-3 rounded-[2px] border border-[#c44e20] bg-[#c44e20]/30" />, 'Official alert area'],
  ];
  return (
    <div className="absolute bottom-10 left-3 z-overlay hidden sm:block">
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: DUR.quick, ease: EASE_OUT }}
            style={{ transformOrigin: 'bottom left' }} className="glass mb-2 space-y-1.5 rounded-card p-3 text-[12px] text-cc-muted">
            {rows.map(([icon, label]) => <li key={label} className="flex items-center gap-2.5"><span className="flex w-4 justify-center">{icon}</span>{label}</li>)}
          </motion.ul>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="glass h-8 rounded-full px-3 text-[12px] font-medium text-cc-text">
        {open ? 'Hide legend' : 'Legend'}
      </button>
    </div>
  );
};

type Sel = { kind: 'community'; id: string } | { kind: 'vehicle'; id: string } | { kind: 'alert'; id: number } | null;

export const CommandCenter: React.FC = () => {
  const { overview, vehicles, thresholds, serverOffsetMs, disasters, communities, depots, trips, anomalies, health, navigate, loaded, route, signals, proposals, can, refresh } = useApp();
  const now = useNow(serverOffsetMs, 2000);
  const reduce = useReducedMotion();
  const states = useStatesGeo();
  const alerts = useAlertsGeo();
  const situation = useSituation();
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [scope, setScope] = useState<{ state?: { id: number; name: string; bbox: number[] }; district?: { id: number; name: string; bbox: number[] } }>({});
  const [fit, setFit] = useState<{ bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [tab, setTab] = useState('crisis');
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1280px)');
    const h = () => setWide(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  const routeCommunity = route.startsWith('overview/') ? route.slice('overview/'.length) : null;

  useEffect(() => { if (!loaded.has('proposals')) refresh('proposals'); }, [loaded, refresh]);
  // Deep link /#overview/<id> (command palette, other pages) selects that place.
  useEffect(() => {
    if (!routeCommunity) { setSel(s => (s?.kind === 'community' ? null : s)); return; }
    const c = communities.find(x => x.id === routeCommunity);
    if (c) { setSel({ kind: 'community', id: c.id }); setFit({ center: [c.lat, c.lng], zoom: 11, key: `c${c.id}` }); }
  }, [routeCommunity, communities]);

  const mapVehicles = useMemo(() => vehicles.map(v => { const ls = liveState(v, thresholds, now); return { v, state: ls.state, age: ls.age }; }), [vehicles, thresholds, now]);
  const selVehicle = sel?.kind === 'vehicle' ? vehicles.find(v => v.vehicleId === sel.id) : null;
  const routes: MapRoute[] = useMemo(() => trips.filter(t => ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering'].includes(t.status))
    .map(t => ({ id: t.id, coords: t.routeGeometry, kind: 'planned' as const, highlight: selVehicle?.trip?.id === t.id })), [trips, selVehicle]);
  const sortedAlerts = useMemo(() => [...disasters].sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''))), [disasters]);
  const pendingProposals = proposals.filter(p => p.status === 'Proposed').length;
  const toReview = signals.filter(s => s.kind === 'news' && s.status === 'unverified').length;

  const scopeBox = () => scope.district?.bbox || scope.state?.bbox || HOME_BBOX;
  const select = (s: Sel) => {
    setSel(s);
    if (!s) { navigate('overview'); setFit({ bbox: scopeBox(), key: `back${Date.now()}` }); return; }
    if (s.kind === 'community') {
      navigate(`overview/${s.id}`);
    } else {
      if (routeCommunity) navigate('overview');
      if (s.kind === 'vehicle') {
        const v = vehicles.find(x => x.vehicleId === s.id);
        if (v?.position) setFit({ center: [v.position.lat, v.position.lng], zoom: 14, key: `v${s.id}${Date.now()}` });
      } else {
        const a = disasters.find(x => x.id === s.id);
        if (a?.bbox) setFit({ bbox: a.bbox, key: `a${s.id}${Date.now()}` });
      }
    }
  };
  const pickState = async (id: number, bbox: number[]) => {
    const f = states?.features.find((x: GeoJSON.Feature) => (x.properties as any).id === id);
    setScope({ state: { id, name: (f?.properties as any)?.name || 'State', bbox } });
    setFit({ bbox, key: `s${id}` });
    setDistricts(await api.districts(id).catch(() => null));
  };
  const pickDistrict = (id: number, name: string, bbox: number[]) => { setScope(s => ({ ...s, district: { id, name, bbox } })); setFit({ bbox, key: `d${id}` }); };
  const toIndia = () => { setScope({}); setDistricts(null); setSel(null); navigate('overview'); setFit({ bbox: [67.5, 6.0, 97.8, 37.4], key: `in${Date.now()}` }); };
  const toHome = () => { setScope({}); setDistricts(null); setSel(null); navigate('overview'); setFit({ bbox: HOME_BBOX, key: `home${Date.now()}` }); };
  const toState = () => { if (!scope.state) return; setScope(s => ({ state: s.state })); setFit({ bbox: scope.state.bbox, key: `s${Date.now()}` }); };

  const o = overview;
  const feed = health?.sources.find(s => s.key === 'ndma_sachet');
  const today = new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  const selCommunity = sel?.kind === 'community' ? communities.find(c => c.id === sel.id) : null;
  const selAlert = sel?.kind === 'alert' ? disasters.find(a => a.id === sel.id) : null;

  // ---------------------------------------------------------------- rail content
  const listView = (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'crisis', label: <span className="flex items-center gap-1.5">Signals{toReview > 0 && <span className="mono rounded-full bg-cc-warn/15 px-1.5 text-[10px] font-semibold text-amber-800">{toReview}</span>}</span> },
        { id: 'alerts', label: <span>Alerts <span className="mono text-cc-faint">{disasters.length}</span></span> },
        { id: 'fleet', label: <span>Fleet <span className="mono text-cc-faint">{vehicles.length}</span></span> },
        { id: 'anomalies', label: <span>Issues <span className="mono text-cc-faint">{anomalies.length}</span></span> },
        { id: 'feeds', label: 'Sources' },
      ]} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.quick, ease: EASE_OUT }}
          className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'crisis' && <CrisisSignals compact onPlace={id => select({ kind: 'community', id })} />}
          {tab === 'alerts' && (
            <>
              <div className="flex items-center justify-between border-b border-cc-border px-4 py-2 text-[11.5px] text-cc-muted">
                <span className="flex items-center gap-1.5"><ProvMark kind={feed?.status === 'connected' ? 'external' : 'stale'} />NDMA SACHET · {feed?.status ?? '…'}</span>
                <span>{feed?.lastSuccessAt ? `synced ${timeAgo(feed.lastSuccessAt, now)}` : 'never synced'}</span>
              </div>
              {!loaded.has('disasters') ? <Empty title="Loading alerts" /> : sortedAlerts.length === 0
                ? <Empty title="No active official alerts" hint={feed?.status === 'connected' ? 'The alert feed is connected and reports nothing active.' : 'Alert feed is not connected; absence of alerts is not confirmed.'} />
                : (
                  <ul className="divide-y divide-cc-border">
                    {sortedAlerts.slice(0, 80).map(a => (
                      <li key={a.id}>
                        <button onClick={() => select({ kind: 'alert', id: a.id })} className="w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60">
                          <div className="flex items-center justify-between gap-2"><SeverityChip severity={a.severity} /><span className="text-[11px] text-cc-faint">{timeAgo(a.publishedAt, now)}</span></div>
                          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug">{a.headline}</p>
                          <p className="mt-0.5 truncate text-[11.5px] text-cc-muted">{a.provider} · {a.areaDesc}</p>
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
                {[...mapVehicles].sort((a, b) => ['live', 'stale', 'offline', 'no_signal'].indexOf(a.state) - ['live', 'stale', 'offline', 'no_signal'].indexOf(b.state)).map(({ v, state, age }) => {
                  const moving = state === 'live' && (v.position?.speedKmh ?? 0) >= 3;
                  return (
                    <motion.li key={v.vehicleId} layout transition={SPRING_SHEET}>
                      <button onClick={() => select({ kind: 'vehicle', id: v.vehicleId })} className="w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="mono text-[13px] font-medium">{v.registration}</span>
                          <TrackingBadge state={state} ageSeconds={age} />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] text-cc-muted">
                          <span className="truncate">{v.trip ? `${v.trip.id} to ${v.trip.destination ?? '—'}` : v.status}</span>
                          <span className="flex-shrink-0">{state === 'live' ? (moving ? `${v.position?.speedKmh} km/h` : 'stationary') : state === 'no_signal' ? 'no position yet' : 'last known position'}</span>
                        </div>
                      </button>
                    </motion.li>
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
                    <p className="mt-1 text-[12px] text-cc-muted">{a.vehicleId} {a.tripId ? `· ${a.tripId}` : ''} {a.value != null ? `· ${Math.round(a.value)}${a.kind === 'route_deviation' ? ' m off route' : a.kind === 'gps_jump' ? ' km/h implied' : ''}` : ''}</p>
                    <div className="mt-1 flex gap-1">
                      {a.vehicleId && <Button size="sm" variant="ghost" className="-ml-2" onClick={() => select({ kind: 'vehicle', id: a.vehicleId! })}>Show vehicle</Button>}
                      <Button size="sm" variant="ghost" onClick={() => navigate('live')}>Live operations</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
          {tab === 'feeds' && (
            <ul className="divide-y divide-cc-border">
              {(health?.sources || []).map(s => (
                <li key={s.key} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[13px]">{s.name}</span><StatusChip status={s.status} /></div>
                  <p className="mt-0.5 text-[11.5px] text-cc-muted">{s.lastSuccessAt ? `last success ${timeAgo(s.lastSuccessAt, now)}` : 'no successful sync'}{s.lastError ? ` · ${s.lastError.slice(0, 120)}` : ''}</p>
                </li>
              ))}
              {health && <li className="px-4 py-3 text-[12px] text-cc-muted">GPS ingestion: {health.gpsIngestion.fixesLast10Min} fixes in 10 min · last {health.gpsIngestion.lastFixReceivedAt ? `${formatAge((now - Date.parse(health.gpsIngestion.lastFixReceivedAt)) / 1000)} ago` : 'never'}</li>}
            </ul>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );

  const detailTitle = selCommunity ? selCommunity.name : selVehicle ? selVehicle.registration : selAlert ? 'Official alert' : '';
  const detailSub = selCommunity ? communitySubtitle(selCommunity) : selVehicle ? `${selVehicle.vehicleId} · ${selVehicle.status}` : selAlert ? `${selAlert.provider}` : '';
  const detailView = sel && (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 border-b border-cc-border px-3 py-3">
        <Button variant="ghost" size="sm" className="!w-8 !px-0" aria-label="Back to lists" onClick={() => select(null)}><CaretLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{detailTitle}</p>
          <p className="truncate text-[12px] text-cc-muted">{detailSub}</p>
        </div>
        {selVehicle && (() => { const ls = liveState(selVehicle, thresholds, now); return <TrackingBadge state={ls.state} ageSeconds={ls.age} />; })()}
        <Button variant="ghost" size="sm" className="!w-8 !px-0" aria-label="Close" onClick={() => select(null)}><X className="h-4 w-4" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {sel.kind === 'community' && <CommunityDetail id={sel.id} onClose={() => select(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 13, key: `f${Date.now()}` })} />}
        {sel.kind === 'vehicle' && <VehicleDetail id={sel.id} onClose={() => select(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 16, key: `f${Date.now()}` })} onOpenTrip={ref => navigate(`trips/${ref}`)} />}
        {sel.kind === 'alert' && <AlertDetail id={sel.id} onZoom={bbox => setFit({ bbox, key: `a${Date.now()}` })} />}
      </div>
    </div>
  );

  const rail = (
    <div className="flex h-full min-h-0 flex-col">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={sel ? `d-${sel.kind}-${sel.id}` : 'lists'} className="flex min-h-0 flex-1 flex-col"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: sel ? 28 : -28 }} animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: sel ? -28 : 28 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
          {sel ? detailView : listView}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const crumbs = (
    <nav aria-label="Map scope" className="flex items-center gap-1 text-[12px]">
      <button className="text-cc-muted transition-colors hover:text-cc-text" onClick={toIndia}>India</button>
      <ChevronRight className="h-3 w-3 text-cc-faint" />
      <button className={cx('transition-colors hover:text-cc-text', scope.state || scope.district ? 'text-cc-muted' : 'font-medium text-cc-text')} onClick={scope.state ? toState : toHome}>Maharashtra</button>
      <AnimatePresence>
        {scope.district && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-cc-faint" /><span className="font-medium text-cc-text">{districtName(scope.district.name)}</span>
          </motion.span>
        )}
        {selCommunity && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-cc-faint" /><span className="font-medium text-cc-text">{selCommunity.name}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {!scope.state && !selCommunity && <span className="ml-1 hidden text-cc-faint xl:inline">· click the state for districts</span>}
    </nav>
  );

  const headline = (
    <div className="min-w-0">
      <p className="text-[12px] text-cc-muted">{today}</p>
      {loaded.has('communities') ? (
        <h1 className="display mt-1 text-[24px] leading-[1.1] text-cc-text xl:text-[28px]">
          <span className="mono font-semibold">{situation.high.toLocaleString('en-IN')}</span> places under water stress
          {situation.critical > 0 && <>, <span style={{ color: MAP_COLORS.critical }}><span className="mono">{situation.critical}</span> critical</span></>}
        </h1>
      ) : <div className="mt-1 h-8 w-[420px] max-w-full rounded-control bg-cc-hover" />}
      <p className="mt-1 text-[12.5px] text-cc-muted">
        {situation.top.length > 0 && <>Concentrated in {list(situation.top)}. </>}
        {situation.people > 0 && <>{(situation.people / 1e6).toFixed(1)} million people in affected places. </>}
        {toReview > 0 && <button className="font-medium text-cc-accent underline decoration-cc-accent/30 underline-offset-4 hover:decoration-cc-accent" onClick={() => { setSel(null); setTab('crisis'); }}>{toReview} news reports to review</button>}
      </p>
    </div>
  );

  const kpis = (
    <Stagger className={wide ? 'grid grid-cols-6 divide-x divide-cc-border max-[1535px]:[&_.kpi-icon]:hidden max-[1535px]:[&>*]:px-3.5' : 'grid grid-cols-2 sm:grid-cols-3'} step={0.04}>
      <Kpi label="Places in crisis" value={loaded.has('communities') ? situation.high : '—'} sub={`${situation.critical} critical`} tone={situation.critical ? 'danger' : 'warn'} icon={<Building2 className="h-4 w-4" />} onClick={() => { setSel(null); setTab('crisis'); }} />
      <Kpi label="Official alerts" value={o?.activeEmergencies ?? '—'} sub={`${o?.activeAlerts ?? 0} active`} tone={o?.activeEmergencies ? 'warn' : 'ok'} icon={<AlertOctagon className="h-4 w-4" />} onClick={() => { setSel(null); setTab('alerts'); }} />
      <Kpi label="Open requests" value={o?.activeRequests ?? '—'} sub={`${o?.criticalRequests ?? 0} critical`} tone={o?.criticalRequests ? 'danger' : 'accent'} icon={<Droplets className="h-4 w-4" />} onClick={() => navigate('requests')} />
      <Kpi label="Tankers free" value={o ? o.tankersAvailable : '—'} sub={o ? `of ${o.tankersTotal} · ${o.tankersOnRoad} on road` : ''} tone="accent" icon={<Truck className="h-4 w-4" />} onClick={() => { setSel(null); setTab('fleet'); }} />
      <Kpi label="Delivered" value={o?.deliveriesToday ?? '—'} sub={o ? `today · ${o.litresDeliveredToday.toLocaleString('en-IN')} L` : ''} tone="teal" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => navigate('verification')} />
      <Kpi label="Complaints" value={o?.openComplaints ?? '—'} sub={`${o?.openAnomalies ?? 0} ${o?.openAnomalies === 1 ? 'anomaly' : 'anomalies'}`} tone={o?.openComplaints ? 'violet' : 'ok'} icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => navigate('complaints')} />
    </Stagger>
  );

  const planButton = can('dispatch') && (
    <Button variant="primary" className="group" icon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('trips')}>
      {pendingProposals ? `Review ${pendingProposals} proposed trips` : 'Plan tanker trips'}
      <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
    </Button>
  );

  const map = (
    <OpsMap cinematic cluster vehicles={mapVehicles} communities={communities} depots={depots} alerts={alerts} states={states} districts={districts} routes={routes}
      selectedVehicleId={selVehicle?.vehicleId ?? null} selectedCommunityId={selCommunity?.id ?? null} selectedAlertId={selAlert?.id ?? null}
      onVehicle={id => select({ kind: 'vehicle', id })} onAlert={id => select({ kind: 'alert', id })} onCommunity={id => select({ kind: 'community', id })}
      onState={pickState} onDistrict={pickDistrict} fit={fit}
      padding={wide ? { left: 0, right: RAIL_W + 24, top: 210, bottom: 0 } : undefined}
      className={wide ? 'cc-map relative h-full w-full' : undefined}
      controlsClassName={wide ? 'lg:!top-auto lg:!bottom-4 lg:!right-[436px]' : undefined} />
  );

  if (!wide) {
    // Phones and tablets: situation on top, map, then the rail as an ordinary section.
    return (
      <div className="h-full overflow-y-auto">
        <div className="space-y-3 p-4">
          {crumbs}{headline}
          <div className="rounded-card border border-cc-border bg-cc-surface">{kpis}</div>
          {planButton}
        </div>
        <div className="relative h-[56vh] min-h-[360px] border-y border-cc-border">{map}</div>
        <div className="flex min-h-[70vh] flex-col bg-cc-surface">{rail}</div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="absolute inset-0">{map}</div>
      {/* Situation + metrics float over the map, clear of the rail */}
      <motion.section initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT, delay: 0.1 }}
        className="glass pointer-events-auto absolute left-4 top-4 z-overlay rounded-card" style={{ right: RAIL_W + 32 }} aria-label="Situation">
        <div className="flex items-start justify-between gap-4 px-4 pb-2 pt-3">
          <div className="min-w-0 space-y-1.5">{crumbs}{headline}</div>
          <div className="flex-shrink-0 pt-1">{planButton}</div>
        </div>
        <div className="border-t border-cc-border/80">{kpis}</div>
      </motion.section>
      <motion.aside initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT, delay: 0.2 }}
        aria-label="Intelligence" className="glass absolute bottom-4 right-4 top-4 z-overlay flex flex-col overflow-hidden rounded-card" style={{ width: RAIL_W }}>
        {rail}
      </motion.aside>
      <Legend />
    </div>
  );
};
