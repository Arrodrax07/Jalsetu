/**
 * Live operations: the trips on the road, on the map. Positions, ages, speeds and arrivals come only from real
 * device GPS; when a phone stops reporting, its marker stops and the freshness meter shows it ageing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, MapPin, Route } from '../components/icons';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { OpsMap, MapRoute } from '../components/map/OpsMap';
import { VehiclePanel } from '../components/panels';
import { FixValue, FreshnessMeter, LiveAge, TripProgress } from '../components/live';
import { Button, Chip, cx, Empty, KindLabel, ProvMark, StatusChip, TrackingBadge } from '../components/ui';
import type { Trip } from '../types';
import { dt, km, timeAgo } from '../utils/format';
import { DUR, EASE_OUT, SPRING_SHEET } from '../motion';

const OPEN = ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering', 'Delivered'];
const GROUPS: { id: string; label: string; states: string[] }[] = [
  { id: 'live', label: 'Reporting now', states: ['live'] },
  { id: 'stale', label: 'Going quiet', states: ['stale'] },
  { id: 'offline', label: 'Offline', states: ['offline'] },
  { id: 'none', label: 'Not started', states: ['no_signal'] },
];

const AckForm: React.FC<{ onAck: (note: string) => Promise<void> }> = ({ onAck }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button size="sm" className="mt-2" onClick={() => setOpen(true)}>Acknowledge</Button>;
  return (
    <form className="mt-2 flex gap-2" onSubmit={async e => { e.preventDefault(); setBusy(true); await onAck(note); setBusy(false); setOpen(false); }}>
      <input className="input h-8 py-1 text-[12.5px]" autoFocus placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} aria-label="Acknowledgement note" />
      <Button size="sm" variant="primary" type="submit" loading={busy}>Save</Button>
    </form>
  );
};

export const LiveOperations: React.FC = () => {
  const { trips, vehicles, thresholds, serverOffsetMs, communities, depots, anomalies, fail, refresh, can, navigate } = useApp();
  const now = useNow(serverOffsetMs, 1000);
  const open = useMemo(() => trips.filter(t => OPEN.includes(t.status)), [trips]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Trip | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [fit, setFit] = useState<{ bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null>(null);
  const lastFix = useRef<string | null>(null);

  const rows = useMemo(() => open.map(t => {
    const tv = vehicles.find(x => x.vehicleId === t.tankerId);
    const s = tv ? liveState(tv, thresholds, now) : { state: 'no_signal' as const, age: null };
    return { t, v: tv, ...s };
  }), [open, vehicles, thresholds, now]);
  useEffect(() => {
    if (sel || !rows.length) return;
    const best = rows.find(r => r.state === 'live') || rows.find(r => r.state === 'stale') || rows[0];
    setSel(best.t.id);
  }, [rows, sel]);
  const trip = open.find(t => t.id === sel) || trips.find(t => t.id === sel) || null;
  const v = vehicles.find(x => x.vehicleId === trip?.tankerId);

  // Actual route = accepted telemetry for this trip, refetched only when a NEW real fix has arrived.
  useEffect(() => {
    if (!trip) { setDetail(null); return; }
    const key = `${trip.id}|${trip.status}|${v?.position?.deviceTime ?? ''}`;
    if (lastFix.current === key) return;
    lastFix.current = key;
    api.trip(trip.id).then(setDetail).catch(() => undefined);
  }, [trip?.id, trip?.status, v?.position?.deviceTime]);

  // Frame the trip when it is selected; while following, ease to each new real fix (never ahead of it).
  useEffect(() => {
    if (!trip) return;
    if (v?.position) setFit({ center: [v.position.lat, v.position.lng], zoom: 15, key: `t${trip.id}` });
    else if (trip.stops[0]) setFit({ center: [trip.stops[0].lat, trip.stops[0].lng], zoom: 13, key: `t${trip.id}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);
  useEffect(() => {
    if (follow && v?.position) setFit({ center: [v.position.lat, v.position.lng], zoom: 15, key: `fx${v.position.deviceTime}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, v?.position?.deviceTime]);

  const mapVehicles = useMemo(() => vehicles.map(x => { const s = liveState(x, thresholds, now); return { v: x, state: s.state, age: s.age }; }), [vehicles, thresholds, now]);
  const routes: MapRoute[] = [];
  if (detail) {
    routes.push({ id: `${detail.id}-p`, coords: detail.routeGeometry, kind: 'planned', highlight: true });
    if (detail.actualRoute && detail.actualRoute.length > 1) routes.push({ id: `${detail.id}-a`, coords: detail.actualRoute, kind: 'actual' });
  }
  const stop = trip?.stops.find(s => s.status === 'Pending' || s.status === 'Arrived') || null;
  const ls = v ? liveState(v, thresholds, now) : null;
  const tripAnoms = anomalies.filter(a => a.tripId === trip?.id);
  const fixKey = v?.position?.deviceTime;

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-cc-border px-4 py-3">
        <div><p className="text-[14px] font-semibold">Open trips</p><p className="text-[12px] text-cc-muted">{open.length} on the board · {rows.filter(r => r.state === 'live').length} reporting GPS now</p></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {open.length === 0 ? <Empty title="No open trips" hint="Trips appear here once dispatched." action={can('dispatch') ? <Button size="sm" variant="primary" onClick={() => navigate('trips')}>Dispatch a trip</Button> : undefined} /> : (
          GROUPS.map(g => {
            const rs = rows.filter(r => g.states.includes(r.state));
            if (!rs.length) return null;
            return (
              <section key={g.id}>
                <p className="sticky top-0 z-[1] flex items-center gap-2 bg-cc-surface/95 px-4 pb-1 pt-3 text-[11.5px] font-medium text-cc-muted backdrop-blur">
                  <ProvMark kind={g.states[0] as any} />{g.label}<span className="mono text-cc-faint">{rs.length}</span>
                </p>
                <ul>
                  <AnimatePresence initial={false}>
                    {rs.map(({ t, state, age }) => (
                      <motion.li key={t.id} layout transition={SPRING_SHEET} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <button onClick={() => { setSel(t.id); setFollow(true); }} aria-current={sel === t.id}
                          className={cx('relative w-full px-4 py-3 text-left transition-colors hover:bg-cc-hover/60', sel === t.id && 'bg-cc-accent/[0.06]')}>
                          {sel === t.id && <motion.span layoutId="live-sel" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-cc-accent" transition={SPRING_SHEET} />}
                          <div className="flex items-center justify-between gap-2">
                            <span className="mono text-[13px] font-medium">{t.vehicleNumber}</span>
                            <LiveAge state={state} age={age} />
                          </div>
                          <p className="mt-0.5 truncate text-[12px] text-cc-muted">{t.id} · {t.driverName || 'no driver'} · to {t.stops.map(x => x.communityName).join(', ')}</p>
                          <TripProgress status={t.status} compact className="mt-2.5" />
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );

  const panel = !trip ? <Empty title="Select a trip" /> : (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={trip.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: DUR.base, ease: EASE_OUT }}
        className="space-y-5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="mono text-[17px] font-semibold">{trip.vehicleNumber}</p>
            <p className="text-[12px] text-cc-muted">{trip.id} · {trip.driverName || 'no driver assigned'}</p>
          </div>
          {ls ? <TrackingBadge state={ls.state} ageSeconds={ls.age} /> : <StatusChip status={trip.status} />}
        </div>
        <TripProgress status={trip.status} />

        <section aria-label="Telemetry" className="rounded-card border border-cc-border bg-cc-raised/60 p-3.5">
          {v?.position ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-[11px] text-cc-muted">Speed</p><p className="display mt-0.5 text-[22px] leading-none"><FixValue fixKey={fixKey}>{v.position.speedKmh != null ? Math.round(v.position.speedKmh) : '—'}</FixValue><span className="ml-0.5 text-[12px] font-normal text-cc-faint">km/h</span></p></div>
                <div><p className="text-[11px] text-cc-muted">Accuracy</p><p className="display mt-0.5 text-[22px] leading-none"><FixValue fixKey={fixKey}>{v.position.accuracyM != null ? `±${Math.round(v.position.accuracyM)}` : '—'}</FixValue><span className="ml-0.5 text-[12px] font-normal text-cc-faint">m</span></p></div>
                <div><p className="text-[11px] text-cc-muted">Heading</p><p className="display mt-0.5 text-[22px] leading-none"><FixValue fixKey={fixKey}>{v.position.headingLabel || '—'}</FixValue></p></div>
              </div>
              <FreshnessMeter className="mt-4" age={ls?.age ?? null} liveSeconds={thresholds.liveSeconds} offlineSeconds={thresholds.offlineSeconds} />
              <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-cc-muted">
                <ProvMark kind="live" />{v.position.sourceLabel} · fix at <span className="mono">{dt(v.position.deviceTime)}</span>
              </p>
              {ls?.state !== 'live' && <p className="mt-2 rounded-control bg-cc-warn/10 px-2.5 py-1.5 text-[12px] text-amber-800">No new fix. The marker stays at the last real position; nothing is estimated.</p>}
            </>
          ) : <p className="text-[12.5px] text-cc-muted">No GPS fix yet. The vehicle appears on the map when the driver presses START and the phone sends a real fix.</p>}
          <div className="mt-3 flex gap-2">
            {v?.position && <Button size="sm" variant={follow ? 'primary' : 'secondary'} icon={<Crosshair className="h-3.5 w-3.5" />} aria-pressed={follow}
              onClick={() => { setFollow(f => !f); if (!follow) setFit({ center: [v.position!.lat, v.position!.lng], zoom: 16, key: `f${Date.now()}` }); }}>{follow ? 'Following' : 'Follow'}</Button>}
            <Button size="sm" onClick={() => setVehicleId(trip.tankerId)}>Vehicle details</Button>
          </div>
        </section>

        {stop && (
          <section aria-label="Destination">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-cc-muted"><MapPin className="h-3.5 w-3.5" /> Stop {stop.seq} of {trip.stops.length}</p>
            <p className="mt-0.5 text-[15px] font-semibold">{stop.communityName}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-[12.5px]">
              <div><p className="text-cc-muted">Distance (last fix)</p><p className="mono font-medium"><FixValue fixKey={fixKey}>{v?.trip?.distanceToDestinationM != null ? km(v.trip.distanceToDestinationM / 1000) : '—'}</FixValue></p></div>
              <div><p className="text-cc-muted">To deliver</p><p className="mono font-medium">{stop.allocatedLitres.toLocaleString('en-IN')} L</p></div>
              <div className="col-span-2"><p className="text-cc-muted">Arrival</p>
                <p className="font-medium">{stop.arrivedAt ? <span className="flex items-center gap-2">{dt(stop.arrivedAt)} <KindLabel kind="live-gps" title={`${stop.arrivalDistanceM} m from destination`} /></span> : <span className="text-cc-muted">Not yet detected · geofence {detail?.geofenceRadiusM ?? '…'} m</span>}</p></div>
            </div>
          </section>
        )}

        <section aria-label="Lifecycle">
          <p className="mb-2 text-[11.5px] font-medium text-cc-muted">Lifecycle</p>
          <ol className="relative space-y-2 border-l border-cc-border pl-4">
            {([['Created', trip.createdAt], ['Driver assigned', trip.assignedAt], ['Accepted', trip.acceptedAt], ['Started (GPS)', trip.startedAt],
              ['Arrived (GPS)', trip.arrivedAt], ['Driver ended', trip.driverEndedAt], ['Verified', trip.verifiedAt], ['Completed', trip.completedAt]] as [string, string | null][]).map(([k, t]) => (
              <li key={k} className="relative flex justify-between text-[12px]">
                <span className={cx('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2', t ? 'border-cc-accent bg-cc-accent' : 'border-cc-border bg-cc-surface')} aria-hidden />
                <span className={t ? 'text-cc-text' : 'text-cc-faint'}>{k}</span><span className="mono text-cc-muted">{t ? dt(t) : '—'}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11.5px] text-cc-muted">Travelled (real GPS) <span className="mono">{detail ? km(detail.distanceTravelledKm) : '…'}</span> · planned <span className="mono">{km(trip.distanceKm)}</span></p>
        </section>

        {tripAnoms.length > 0 && (
          <section aria-label="Anomalies">
            <p className="mb-2 text-[11.5px] font-medium text-cc-muted">Anomalies</p>
            <ul className="space-y-2">
              {tripAnoms.map(a => (
                <li key={a.id} className="rounded-control border border-cc-warn/35 bg-cc-warn/[0.06] p-2.5 text-[12px]">
                  <div className="flex items-center justify-between"><Chip tone="warn">{a.kind.replace(/_/g, ' ')}</Chip><span className="text-cc-faint">{timeAgo(a.detectedAt, now)}</span></div>
                  {a.kind === 'route_deviation' && <p className="mt-1 text-cc-muted">{Math.round(a.value || 0)} m from the planned route. A deviation is not by itself wrongdoing.</p>}
                  {a.status === 'open' && can('acknowledge') && <AckForm onAck={async note => { try { await api.acknowledgeAnomaly(a.id, note); refresh('anomalies'); } catch (e) { fail(e); } }} />}
                  {a.status !== 'open' && <p className="mt-1 text-cc-faint">{a.status} {a.acknowledgedBy ? `by ${a.acknowledgedBy}` : ''}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Button className="w-full" icon={<Route className="h-4 w-4" />} onClick={() => navigate(`trips/${trip.id}`)}>Full trip record</Button>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="relative grid h-full min-h-0 grid-cols-1 lg:block">
      <div className="relative h-[52vh] min-h-[340px] lg:absolute lg:inset-0 lg:h-auto">
        <OpsMap vehicles={mapVehicles} communities={communities} depots={depots} routes={routes} selectedVehicleId={trip?.tankerId}
          geofence={stop && detail ? { lat: stop.lat, lng: stop.lng, radiusM: detail.geofenceRadiusM } : null}
          onVehicle={setVehicleId} fit={fit} padding={{ left: 340, right: 380, top: 40 }} className="live-map relative h-full w-full"
          controlsClassName="lg:!right-[392px]" />
        {trip && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base }}
            className="glass absolute bottom-4 left-1/2 z-overlay hidden -translate-x-1/2 items-center gap-3 rounded-full px-3 py-1.5 text-[12px] text-cc-muted xl:flex">
            <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-cc-accent" />Planned route</span>
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-5 rounded-full bg-cc-live" />Driven (<span className="mono">{detail?.actualPointCount ?? 0}</span> real fixes)</span>
            {stop && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-cc-live" />Arrival geofence</span>}
          </motion.div>
        )}
      </div>
      <motion.aside initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT }}
        aria-label="Open trips" className="flex min-h-[40vh] flex-col overflow-hidden bg-cc-surface lg:glass lg:absolute lg:bottom-3 lg:left-3 lg:top-3 lg:z-overlay lg:w-[320px] lg:rounded-card">
        {list}
      </motion.aside>
      <motion.aside initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT, delay: 0.08 }}
        aria-label="Selected trip" className="overflow-y-auto border-t border-cc-border bg-cc-surface lg:glass lg:absolute lg:bottom-3 lg:right-3 lg:top-3 lg:z-overlay lg:w-[360px] lg:rounded-card lg:border-t-0">
        {panel}
      </motion.aside>
      <VehiclePanel id={vehicleId} onClose={() => setVehicleId(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 16, key: `f${Date.now()}` })} onOpenTrip={(r) => navigate(`trips/${r}`)} />
    </div>
  );
};
