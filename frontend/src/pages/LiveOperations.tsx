import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPin } from '../components/icons';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { OpsMap, MapRoute } from '../components/map/OpsMap';
import { VehiclePanel } from '../components/panels';
import { Button, Chip, cx, Empty, formatAge, KindLabel, KV, StatusChip, TrackingBadge } from '../components/ui';
import type { Trip } from '../types';
import { dt, km, timeAgo } from '../utils/format';

const OPEN = ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering', 'Delivered'];

export const LiveOperations: React.FC = () => {
  const { trips, vehicles, thresholds, serverOffsetMs, communities, depots, anomalies, fail, refresh, can, navigate } = useApp();
  const now = useNow(serverOffsetMs, 1000);
  const open = useMemo(() => trips.filter(t => OPEN.includes(t.status)), [trips]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Trip | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [fit, setFit] = useState<{ bbox?: number[]; center?: [number, number]; zoom?: number; key: string } | null>(null);
  const lastFix = useRef<string | null>(null);

  useEffect(() => { if (!sel && open[0]) setSel(open[0].id); }, [open, sel]);
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

  useEffect(() => {
    if (!trip) return;
    if (v?.position) setFit({ center: [v.position.lat, v.position.lng], zoom: 15, key: `t${trip.id}` });
    else if (trip.stops[0]) setFit({ center: [trip.stops[0].lat, trip.stops[0].lng], zoom: 14, key: `t${trip.id}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  const mapVehicles = useMemo(() => vehicles.map(x => ({ v: x, state: liveState(x, thresholds, now).state })), [vehicles, thresholds, now]);
  const routes: MapRoute[] = [];
  if (detail) {
    routes.push({ id: `${detail.id}-p`, coords: detail.routeGeometry, kind: 'planned', highlight: true });
    if (detail.actualRoute && detail.actualRoute.length > 1) routes.push({ id: `${detail.id}-a`, coords: detail.actualRoute, kind: 'actual' });
  }
  const stop = trip?.stops.find(s => s.status === 'Pending' || s.status === 'Arrived') || null;
  const ls = v ? liveState(v, thresholds, now) : null;
  const tripAnoms = anomalies.filter(a => a.tripId === trip?.id);

  const ack = async (id: number) => {
    const note = window.prompt('Acknowledgement note (optional)') ?? '';
    try { await api.acknowledgeAnomaly(id, note); refresh('anomalies'); } catch (e) { fail(e); }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
      <aside className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="panel-header"><div><p className="eyebrow">Live operations</p><h2 className="text-sm font-semibold">Open trips ({open.length})</h2></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open.length === 0 ? <Empty title="No open trips" hint={can('dispatch') ? <Button size="sm" variant="primary" onClick={() => navigate('trips')}>Dispatch a trip</Button> : undefined} /> : (
            <ul className="divide-y divide-cc-border">
              {open.map(t => {
                const tv = vehicles.find(x => x.vehicleId === t.tankerId);
                const s = tv ? liveState(tv, thresholds, now) : null;
                return (
                  <li key={t.id}>
                    <button onClick={() => setSel(t.id)} className={cx('w-full px-3 py-2.5 text-left hover:bg-cc-hover', sel === t.id && 'bg-cc-hover border-l-2 border-cc-accent')}>
                      <div className="flex items-center justify-between"><span className="text-sm font-medium">{t.id}</span><StatusChip status={t.status} /></div>
                      <p className="mt-0.5 text-xs text-cc-muted">{t.vehicleNumber} · {t.driverName || 'no driver'}</p>
                      <div className="mt-1 flex items-center justify-between text-2xs text-cc-muted">
                        <span className="truncate">→ {t.stops.map(x => x.communityName).join(' → ')}</span>
                        {s && <TrackingBadge state={s.state} ageSeconds={s.age} compact />}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="panel relative min-h-[460px] overflow-hidden">
        <OpsMap vehicles={mapVehicles} communities={communities} depots={depots} routes={routes} selectedVehicleId={trip?.tankerId}
          geofence={stop && detail ? { lat: stop.lat, lng: stop.lng, radiusM: detail.geofenceRadiusM } : null}
          onVehicle={setVehicleId} fit={fit} />
        {trip && (
          <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
            <Chip tone="accent">Planned route (dashed)</Chip>
            <Chip tone="ok">Actual route: {detail?.actualPointCount ?? 0} real GPS points</Chip>
            {stop && <Chip tone="neutral">Geofence {detail?.geofenceRadiusM ?? '…'} m</Chip>}
          </div>
        )}
      </section>

      <aside className="panel min-h-0 overflow-y-auto">
        {!trip ? <Empty title="Select a trip" /> : (
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-2">
              <div><p className="eyebrow">Trip</p><p className="text-lg font-semibold">{trip.id}</p></div>
              <StatusChip status={trip.status} />
            </div>
            <div className="rounded-lg border border-cc-border bg-cc-raised p-3">
              <div className="flex items-center justify-between gap-2">
                <button className="text-sm font-medium text-cc-accent hover:underline" onClick={() => setVehicleId(trip.tankerId)}>{trip.vehicleNumber}</button>
                {ls && <TrackingBadge state={ls.state} ageSeconds={ls.age} />}
              </div>
              {v?.position ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><p className="text-cc-muted">GPS source</p><p className="font-medium">{v.position.sourceLabel}</p></div>
                  <div><p className="text-cc-muted">Accuracy</p><p className="num font-medium">{v.position.accuracyM != null ? `± ${Math.round(v.position.accuracyM)} m` : '—'}</p></div>
                  <div><p className="text-cc-muted">Speed</p><p className="num font-medium">{v.position.speedKmh != null ? `${v.position.speedKmh} km/h` : '—'}</p></div>
                  <div><p className="text-cc-muted">Last fix</p><p className="num font-medium">{ls?.age != null ? `${formatAge(ls.age)} ago` : '—'}</p></div>
                </div>
              ) : <p className="mt-2 text-xs text-cc-muted">No GPS fix yet. The marker appears when the driver starts the trip.</p>}
              {v?.position && <Button size="sm" variant="ghost" className="-ml-2 mt-1" icon={<Crosshair className="h-3.5 w-3.5" />}
                onClick={() => setFit({ center: [v.position!.lat, v.position!.lng], zoom: 16, key: `f${Date.now()}` })}>Follow</Button>}
            </div>

            {stop && (
              <div className="rounded-lg border border-cc-border p-3">
                <p className="eyebrow flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Destination (stop {stop.seq})</p>
                <p className="font-medium">{stop.communityName}</p>
                <KV k="Distance (last fix)" v={<span className="num">{v?.trip?.distanceToDestinationM != null ? km(v.trip.distanceToDestinationM / 1000) : '—'}</span>} />
                <KV k="Arrival" v={stop.arrivedAt ? <span className="flex items-center justify-end gap-1">{dt(stop.arrivedAt)} <KindLabel kind="live-gps" title={`${stop.arrivalDistanceM} m from destination`} /></span> : 'Not yet detected'} />
                <KV k="Deliver" v={<span className="num">{stop.allocatedLitres.toLocaleString('en-IN')} L</span>} />
              </div>
            )}

            <div>
              <p className="eyebrow mb-1">Lifecycle</p>
              <ol className="space-y-1 text-xs">
                {([['Created', trip.createdAt], ['Driver assigned', trip.assignedAt], ['Accepted', trip.acceptedAt], ['Started (GPS)', trip.startedAt],
                  ['Arrived (GPS)', trip.arrivedAt], ['Driver ended', trip.driverEndedAt], ['Verified', trip.verifiedAt], ['Completed', trip.completedAt]] as [string, string | null][]).map(([k, t]) => (
                  <li key={k} className="flex justify-between"><span className={t ? 'text-cc-text' : 'text-cc-faint'}>{k}</span><span className="num text-cc-muted">{t ? dt(t) : '—'}</span></li>
                ))}
              </ol>
              <p className="mt-2 text-2xs text-cc-faint">Distance travelled (real GPS): <span className="num">{detail ? km(detail.distanceTravelledKm) : '…'}</span> · planned {km(trip.distanceKm)}</p>
            </div>

            {tripAnoms.length > 0 && (
              <div>
                <p className="eyebrow mb-1">Anomalies</p>
                <ul className="space-y-2">
                  {tripAnoms.map(a => (
                    <li key={a.id} className="rounded-md border border-cc-warn/40 bg-cc-warn/5 p-2 text-xs">
                      <div className="flex items-center justify-between"><Chip tone="warn">{a.kind.replace(/_/g, ' ')}</Chip><span className="text-cc-faint">{timeAgo(a.detectedAt, now)}</span></div>
                      {a.kind === 'route_deviation' && <p className="mt-1 text-cc-muted">{Math.round(a.value || 0)} m from the planned route. A deviation is not by itself wrongdoing.</p>}
                      {a.status === 'open' && can('acknowledge') && <Button size="sm" className="mt-1" onClick={() => ack(a.id)}>Acknowledge</Button>}
                      {a.status !== 'open' && <p className="mt-1 text-cc-faint">{a.status} {a.acknowledgedBy ? `by ${a.acknowledgedBy}` : ''}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="secondary" className="w-full" onClick={() => navigate(`trips/${trip.id}`)}>Full trip record</Button>
          </div>
        )}
      </aside>
      <VehiclePanel id={vehicleId} onClose={() => setVehicleId(null)} onFocus={(lat, lng) => setFit({ center: [lat, lng], zoom: 16, key: `f${Date.now()}` })} onOpenTrip={(r) => navigate(`trips/${r}`)} />
    </div>
  );
};
