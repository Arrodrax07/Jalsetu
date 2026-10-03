import React, { useEffect, useMemo, useState } from 'react';
import { Route as RouteIcon, Send, XCircle } from 'lucide-react';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { OpsMap, MapRoute } from '../components/map/OpsMap';
import { AutoDispatch } from '../components/AutoDispatch';
import { Button, Chip, Dialog, Empty, Field, KindLabel, KV, Loading, OriginLabel, PageHeader, Panel, StatusChip } from '../components/ui';
import type { RouteOptimizationResult, Trip } from '../types';
import { dt, km, litres, minutes } from '../utils/format';

export const Trips: React.FC<{ tripRef?: string }> = ({ tripRef }) => {
  const { trips, can, navigate } = useApp();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all' | 'completed'>('open');
  if (tripRef) return <TripRecord ref_={tripRef} />;
  const rows = trips.filter(t => filter === 'all' ? true : filter === 'completed' ? t.status === 'Completed' : !['Completed', 'Cancelled'].includes(t.status));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Trips & dispatch" subtitle="Dispatch assigns a tanker and driver. The trip starts only when the driver presses START with a real GPS fix."
        actions={can('dispatch') && <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setDispatchOpen(true)}>Dispatch trip</Button>} />
      <AutoDispatch />
      <div className="mb-3 flex gap-1">
        {(['open', 'completed', 'all'] as const).map(f => <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</Button>)}
      </div>
      <Panel bodyClassName="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No trips" hint={filter === 'open' ? 'Dispatch a trip to begin.' : undefined} /> : (
          <table className="table-cc">
            <thead><tr><th>Trip</th><th>Vehicle</th><th>Driver</th><th>Stops</th><th>Status</th><th>Started</th><th>Completed</th><th className="text-right">Distance (GPS)</th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`trips/${t.id}`)}>
                  <td className="font-medium text-cc-accent">{t.id}</td><td>{t.vehicleNumber}</td><td>{t.driverName || <span className="text-cc-faint">unassigned</span>}</td>
                  <td className="max-w-xs truncate text-cc-muted">{t.stops.map(s => s.communityName).join(' → ')}</td>
                  <td><StatusChip status={t.status} /></td><td className="num text-cc-muted">{dt(t.startedAt)}</td><td className="num text-cc-muted">{dt(t.completedAt)}</td>
                  <td className="num text-right">{t.status === 'Completed' ? km(t.distanceTravelledKm) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <DispatchDialog open={dispatchOpen} onClose={() => setDispatchOpen(false)} />
    </div>
  );
};

const DispatchDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { vehicles, drivers, communities, depots, fail, toast, refresh, navigate, trips } = useApp();
  const available = vehicles.filter(v => v.status === 'Available');
  const busyDrivers = new Set(trips.filter(t => !['Completed', 'Cancelled'].includes(t.status)).map(t => t.driverUserId));
  const freeDrivers = drivers.filter(d => d.isActive && !busyDrivers.has(d.id));
  const [tankerId, setTankerId] = useState('');
  const [driverId, setDriverId] = useState<number | ''>('');
  const [stops, setStops] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<RouteOptimizationResult | null>(null);
  const [busy, setBusy] = useState<'opt' | 'send' | null>(null);

  useEffect(() => { if (open) { setPreview(null); setStops([]); setTankerId(available[0]?.vehicleId || ''); setDriverId(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => {
    const v = vehicles.find(x => x.vehicleId === tankerId);
    if (v?.driverUserId && freeDrivers.some(d => d.id === v.driverUserId)) setDriverId(v.driverUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tankerId]);
  useEffect(() => setPreview(null), [tankerId, stops]);

  const ranked = useMemo(() => [...communities].filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.districtName || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.priorityScore - a.priorityScore), [communities, q]);
  const toggle = (id: string) => setStops(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= 8 ? s : [...s, id]);

  const optimise = async () => {
    setBusy('opt');
    try { setPreview(await api.optimizeRoute(tankerId, stops)); } catch (e) { fail(e, 'Route planning failed'); }
    setBusy(null);
  };
  const dispatch = async () => {
    setBusy('send');
    try {
      const t = await api.createTrip({ tankerId, communityIds: stops, driverUserId: driverId === '' ? undefined : driverId });
      toast('Trip dispatched', `${t.id} assigned. It starts when the driver presses START on their phone.`, 'success');
      await refresh('trips', 'vehicles', 'overview', 'requests');
      onClose();
      navigate(`trips/${t.id}`);
    } catch (e) { fail(e, 'Dispatch failed'); }
    setBusy(null);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Dispatch trip" subtitle="Assign an available tanker and driver to one or more destinations." wide>
      {available.length === 0 ? <Empty title="No available tankers" hint="All vehicles are assigned, on trips or under maintenance." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Tanker (available)">
              <select className="input" value={tankerId} onChange={e => setTankerId(e.target.value)}>
                {available.map(v => <option key={v.vehicleId} value={v.vehicleId}>{v.registration} · {v.capacity?.toLocaleString('en-IN')} L{v.dataOrigin === 'seeded' ? ' · reference' : ''}</option>)}
              </select>
            </Field>
            <Field label="Driver" hint="The driver accepts and starts the trip on their phone. Only this driver's phone can send GPS for it.">
              <select className="input" value={driverId} onChange={e => setDriverId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Assign later</option>
                {freeDrivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.email})</option>)}
              </select>
            </Field>
            <Field label={`Destinations (${stops.length}/8), ranked by priority`}>
              <input className="input mb-2" placeholder="Filter by name or district" value={q} onChange={e => setQ(e.target.value)} />
              <div className="max-h-64 overflow-y-auto rounded-lg border border-cc-border">
                {ranked.map(c => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-cc-border px-2.5 py-1.5 text-sm last:border-0 hover:bg-cc-hover">
                    <input type="checkbox" checked={stops.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span className="flex-1 truncate">{c.name}<span className="text-cc-faint"> · {c.districtName || c.ward}</span></span>
                    <span className="num text-2xs text-cc-muted">P{c.priorityScore}</span>
                    {c.dataOrigin === 'seeded' && <span className="text-2xs text-violet-300">ref</span>}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex gap-2">
              <Button onClick={optimise} disabled={!tankerId || !stops.length} loading={busy === 'opt'} icon={<RouteIcon className="h-4 w-4" />}>Plan route</Button>
              <Button variant="primary" onClick={dispatch} disabled={!tankerId || !stops.length} loading={busy === 'send'} icon={<Send className="h-4 w-4" />}>Dispatch</Button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-72 overflow-hidden rounded-lg border border-cc-border">
              <OpsMap vehicles={[]} communities={communities.filter(c => stops.includes(c.id))} depots={depots}
                routes={preview ? [{ id: 'p', coords: preview.routeGeometry, kind: 'proposal' }] : []}
                fit={preview?.routeGeometry.length ? { bbox: bboxOf(preview.routeGeometry), key: `p${preview.distanceAfterKm}` } : null} />
            </div>
            {preview ? (
              <div className="text-sm">
                <KV k="Order" v={preview.recommendedSequence.join(' → ')} />
                <KV k="Planned distance" v={<span className="num">{km(preview.distanceAfterKm)} (vs {km(preview.distanceBeforeKm)} as entered)</span>} />
                <KV k="Drive time" v={<span className="flex items-center justify-end gap-2"><span className="num">{preview.timeAfterMin} min</span><KindLabel kind="estimated" title="Road-network estimate" /></span>} />
                <KV k="Litres per stop" v={preview.sequence.map(s => `${s.name}: ${s.litres.toLocaleString('en-IN')}`).join(' · ')} />
                <KV k="Routing" v={preview.routingSource === 'osrm' ? 'OSRM road network' : 'Fallback estimate (routing service unavailable)'} />
              </div>
            ) : <p className="text-xs text-cc-muted">Plan the route to preview the road path and stop order.</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
};

export function bboxOf(coords: [number, number][]): number[] {
  const lats = coords.map(c => c[0]), lngs = coords.map(c => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

// ---------------------------------------------------------------------------- trip record
const TripRecord: React.FC<{ ref_: string }> = ({ ref_ }) => {
  const { vehicles, thresholds, serverOffsetMs, drivers, can, fail, toast, refresh, navigate, trips } = useApp();
  const now = useNow(serverOffsetMs, 2000);
  const [t, setT] = useState<Trip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const summary = trips.find(x => x.id === ref_);
  const v = vehicles.find(x => x.vehicleId === t?.tankerId);

  const load = () => api.trip(ref_).then(setT).catch(e => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ref_, summary?.status, v?.position?.deviceTime]);

  if (err) return <div className="p-6"><Empty title="Trip not available" hint={err} /></div>;
  if (!t) return <Loading />;
  const routes: MapRoute[] = [{ id: 'p', coords: t.routeGeometry, kind: 'planned', highlight: true }];
  if (t.actualRoute && t.actualRoute.length > 1) routes.push({ id: 'a', coords: t.actualRoute, kind: 'actual' });
  const open = !['Completed', 'Cancelled'].includes(t.status);
  const mapVehicles = v && open ? [{ v, state: liveState(v, thresholds, now).state }] : [];
  const assign = async (id: number) => { try { setT(await api.assignDriver(t.id, id)); refresh('trips', 'vehicles'); } catch (e) { fail(e); } };
  const cancel = async () => { try { setT(await api.cancelTrip(t.id, reason)); setCancelOpen(false); refresh('trips', 'vehicles', 'overview'); toast('Trip cancelled', t.id, 'info'); } catch (e) { fail(e); } };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={`Trip ${t.id}`} subtitle={`${t.vehicleNumber} · ${t.driverName || 'no driver assigned'} · ${t.stops.length} stop(s)`}
        actions={<>
          <StatusChip status={t.status} />
          <Button variant="ghost" onClick={() => navigate('trips')}>All trips</Button>
          {open && can('dispatch') && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>Cancel trip</Button>}
        </>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Route: planned vs actual" actions={<><Chip tone="accent">Planned (dashed)</Chip><Chip tone="ok">Actual: {t.actualPointCount ?? 0} GPS points</Chip></>} bodyClassName="h-[460px] relative">
          <OpsMap vehicles={mapVehicles} communities={[]} routes={routes} selectedVehicleId={t.tankerId}
            geofence={open && t.stops.find(s => s.status === 'Pending' || s.status === 'Arrived') ? (() => { const s = t.stops.find(x => x.status === 'Pending' || x.status === 'Arrived')!; return { lat: s.lat, lng: s.lng, radiusM: t.geofenceRadiusM }; })() : null}
            fit={{ bbox: bboxOf([...(t.routeGeometry || []), ...(t.actualRoute || []), ...t.stops.map(s => [s.lat, s.lng] as [number, number])]), key: t.id }} />
          {(t.actualPointCount ?? 0) < 2 && <p className="absolute bottom-3 left-3 z-10 rounded-md bg-cc-bg/90 px-2 py-1 text-2xs text-cc-muted">The actual route appears from real telemetry once the driver starts. Nothing is drawn without GPS data.</p>}
        </Panel>
        <div className="space-y-4">
          <Panel title="Lifecycle">
            {([['Created', t.createdAt], ['Driver assigned', t.assignedAt], ['Accepted by driver', t.acceptedAt], ['Started (GPS fix)', t.startedAt],
              ['First GPS arrival', t.arrivedAt], ['Driver ended', t.driverEndedAt], ['Verified', t.verifiedAt], ['Completed', t.completedAt], ['Cancelled', t.cancelledAt]] as [string, string | null][])
              .filter(([k, x]) => x || k !== 'Cancelled').map(([k, x]) => <KV key={k} k={k} v={<span className="num">{x ? dt(x) : '—'}</span>} />)}
            {t.cancelReason && <p className="mt-2 text-xs text-cc-muted">Reason: {t.cancelReason}</p>}
            <div className="mt-2 border-t border-cc-border pt-2 text-sm">
              <KV k="Planned distance" v={<span className="num">{km(t.distanceKm)} ({t.routingSource})</span>} />
              <KV k="Travelled (real GPS)" v={<span className="num">{km(t.distanceTravelledKm)}</span>} />
              <KV k="Start → completion" v={<span className="num">{minutes(t.startedAt, t.completedAt) != null ? `${minutes(t.startedAt, t.completedAt)} min` : '—'}</span>} />
              {t.startLat != null && <KV k="Start position" v={<span className="num">{t.startLat.toFixed(5)}, {t.startLng!.toFixed(5)}</span>} />}
            </div>
            {['Planned', 'Assigned'].includes(t.status) && can('dispatch') && (
              <Field label="Assign / change driver" className="mt-3">
                <select className="input" value={t.driverUserId ?? ''} onChange={e => e.target.value && assign(Number(e.target.value))}>
                  <option value="">Select driver…</option>
                  {drivers.filter(d => d.isActive).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
          </Panel>
          <Panel title="Stops">
            <ul className="space-y-2">
              {t.stops.map(s => (
                <li key={s.id} className="rounded-lg border border-cc-border p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.seq}. {s.communityName}</span><StatusChip status={s.status} /></div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-cc-muted">
                    <span className="num">{litres(s.allocatedLitres)}</span>
                    {s.arrivedAt && <span className="flex items-center gap-1">arrived {dt(s.arrivedAt)} <KindLabel kind="live-gps" title={`${s.arrivalDistanceM} m from destination`} /></span>}
                    <OriginLabel origin={s.dataOrigin} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title={`Deliveries (${t.deliveries?.length ?? 0})`} actions={can('verify_delivery') && <Button size="sm" onClick={() => navigate('verification')}>Verification queue</Button>}>
          {!t.deliveries?.length ? <Empty title="No deliveries recorded yet" /> : (
            <ul className="space-y-2">{t.deliveries.map(d => (
              <li key={d.id} className="rounded-lg border border-cc-border p-2.5 text-sm">
                <div className="flex items-center justify-between"><span className="font-medium">{d.id} · {d.communityName}</span><StatusChip status={d.status} /></div>
                <p className="num mt-1 text-xs text-cc-muted">{litres(d.deliveredAmount)} of {litres(d.allocatedAmount)} · receiver {d.receiverName || '—'} · {dt(d.deliveryTime)}</p>
                {d.notes && <p className="mt-1 text-xs text-amber-200">{d.notes}</p>}
                {d.verifiedBy && <p className="mt-1 text-xs text-green-300">Verified by {d.verifiedBy} {dt(d.verifiedAt)}{d.verificationNotes ? ` — ${d.verificationNotes}` : ''}</p>}
              </li>))}</ul>
          )}
        </Panel>
        <Panel title="Audit timeline">
          {!t.timeline?.length ? <Empty title="No events" /> : (
            <ol className="space-y-1.5 text-xs">{t.timeline.map((e, i) => (
              <li key={i} className="flex gap-3"><span className="num w-28 flex-shrink-0 text-cc-faint">{dt(e.at)}</span><span className="font-medium">{e.action}</span><span className="truncate text-cc-muted">{e.by}</span></li>
            ))}</ol>
          )}
        </Panel>
      </div>
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel ${t.id}`} subtitle="The tanker returns to Available. Undelivered requests return to Allocated.">
        <Field label="Reason (recorded in the audit log)"><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setCancelOpen(false)}>Keep trip</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={cancel}>Cancel trip</Button></div>
      </Dialog>
    </div>
  );
};
