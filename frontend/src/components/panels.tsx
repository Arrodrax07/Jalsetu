import React, { useEffect, useState } from 'react';
import { Crosshair, Phone, Route as RouteIcon, Satellite } from './icons';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import type { DisasterEvent, DisasterImpact } from '../types';
import { dt, km } from '../utils/format';
import { Button, Chip, Empty, ErrorBox, formatAge, KindLabel, KV, Loading, OriginLabel, SeverityChip, SlideOver, SourceLink, StatusChip, TrackingBadge } from './ui';

// ---------------------------------------------------------------------------- vehicle
type VehicleProps = { id: string | null; onClose: () => void; onFocus?: (lat: number, lng: number) => void; onOpenTrip?: (ref: string) => void };

export const VehiclePanel: React.FC<VehicleProps> = (props) => {
  const { vehicles, thresholds, serverOffsetMs } = useApp();
  const now = useNow(serverOffsetMs);
  const v = vehicles.find(x => x.vehicleId === props.id);
  if (!props.id) return null;
  const ls = v ? liveState(v, thresholds, now) : null;
  return (
    <SlideOver open={!!props.id} onClose={props.onClose} title={<span className="flex items-center gap-2">{v?.registration ?? 'Vehicle'} {ls && <TrackingBadge state={ls.state} ageSeconds={ls.age} />}</span>}
      subtitle={v ? `${v.vehicleId} · ${v.status}` : undefined}>
      <VehicleDetail {...props} />
    </SlideOver>
  );
};

/** Vehicle facts, every one from the last accepted real GPS fix. Used in a slide-over and inline in the command centre. */
export const VehicleDetail: React.FC<VehicleProps> =
  ({ id, onFocus, onOpenTrip }) => {
    const { vehicles, thresholds, serverOffsetMs } = useApp();
    const now = useNow(serverOffsetMs);
    const v = vehicles.find(x => x.vehicleId === id);
    const [eta, setEta] = useState<Awaited<ReturnType<typeof api.vehicleEta>> | null>(null);
    useEffect(() => {
      setEta(null);
      if (!v?.trip || !v.position) return;
      let alive = true;
      api.vehicleEta(v.vehicleId).then(r => alive && setEta(r)).catch(() => alive && setEta({ available: false, reason: 'Routing service unavailable' }));
      return () => { alive = false; };
      // recompute only when a new real fix arrives
    }, [v?.vehicleId, v?.position?.deviceTime, v?.trip?.destinationId]);
    if (!id) return null;
    const ls = v ? liveState(v, thresholds, now) : null;
    return (
      <>
        {!v ? <Empty title="Vehicle not found" /> : (
          <div className="space-y-5">
            <div className="rounded-lg border border-cc-border bg-cc-raised p-3">
              <div className="flex items-center justify-between">
                <p className="eyebrow flex items-center gap-1"><Satellite className="h-3.5 w-3.5" /> GPS source</p>
                <Chip tone="accent">{v.position?.sourceLabel || (v.trackingSource === 'phone_gps' ? 'Phone GPS' : v.trackingSource)}</Chip>
              </div>
              {(v.position?.source || v.trackingSource) === 'phone_gps' && (
                <p className="mt-2 text-2xs text-cc-faint">Position reported by the driver's smartphone. This is not a certified vehicle tracker (VLTD / AIS-140).</p>
              )}
            </div>
            {!v.position ? <Empty title="No position received yet" hint="The marker appears only after the driver starts a trip and the phone sends a real GPS fix." /> : (
              <div>
                <KV k="Last update" v={<span className="num">{ls?.age != null ? `${formatAge(ls.age)} ago` : '—'}</span>} />
                <KV k="Fix time (device)" v={<span className="num">{dt(v.position.deviceTime)}</span>} />
                <KV k="Received (server)" v={<span className="num">{dt(v.position.receivedAt)}</span>} />
                <KV k="Coordinates" v={<span className="num">{v.position.lat.toFixed(5)}, {v.position.lng.toFixed(5)}</span>} />
                <KV k="GPS accuracy" v={<span className="num">{v.position.accuracyM != null ? `± ${Math.round(v.position.accuracyM)} m` : 'not reported'}</span>} />
                <KV k="Speed" v={<span className="num">{v.position.speedKmh != null ? `${v.position.speedKmh} km/h` : '—'}</span>} />
                <KV k="Heading" v={v.position.headingLabel || '—'} />
                {ls?.state !== 'live' && <p className="mt-2 rounded-md border border-cc-warn/40 bg-cc-warn/10 p-2 text-xs text-amber-800">Marker shows the last known position. It does not move until a new fix arrives.</p>}
              </div>
            )}
            <div>
              <p className="eyebrow mb-1">Assignment</p>
              <KV k="Driver" v={v.driverName || 'Unassigned'} />
              {v.driverPhone && <KV k="Contact" v={<a className="inline-flex items-center gap-1 text-cc-accent" href={`tel:${v.driverPhone.replace(/\s/g, '')}`}><Phone className="h-3.5 w-3.5" />{v.driverPhone}</a>} />}
              {v.trip ? (
                <>
                  <KV k="Trip" v={<button className="text-cc-accent hover:underline" onClick={() => onOpenTrip?.(v.trip!.id)}>{v.trip.id}</button>} />
                  <KV k="Trip status" v={<StatusChip status={v.trip.status} />} />
                  <KV k="Destination" v={v.trip.destination || '—'} />
                  <KV k="Distance to destination" v={<span className="num">{v.trip.distanceToDestinationM != null ? `${km(v.trip.distanceToDestinationM / 1000)} straight-line` : '—'}</span>} />
                  <KV k="ETA" v={eta == null ? '…' : eta.available
                    ? <span className="flex items-center justify-end gap-2"><span className="num">{eta.durationMin} min ({eta.roadDistanceKm} km)</span><KindLabel kind="estimated" title={eta.method} /></span>
                    : <span className="text-cc-faint">{eta.reason}</span>} />
                </>
              ) : <KV k="Trip" v="None" />}
              {v.capacity != null && <KV k="Capacity / load" v={<span className="num">{v.capacity?.toLocaleString('en-IN')} L / {v.currentLoad?.toLocaleString('en-IN')} L</span>} />}
              <KV k="Record" v={<OriginLabel origin={v.dataOrigin} />} />
            </div>
            <div className="flex gap-2">
              {v.position && <Button icon={<Crosshair className="h-4 w-4" />} onClick={() => onFocus?.(v.position!.lat, v.position!.lng)}>Locate</Button>}
              {v.trip && <Button icon={<RouteIcon className="h-4 w-4" />} onClick={() => onOpenTrip?.(v.trip!.id)}>Trip details</Button>}
            </div>
          </div>
        )}
      </>
    );
  };

// ---------------------------------------------------------------------------- alert
const AREA_METHOD: Record<string, string> = {
  ok: 'Official polygon published with the alert',
  district_names: 'Derived: district names in the official alert text matched to district boundaries (not the official polygon)',
  pending: 'Official polygon not yet retrieved',
  unavailable: 'No area geometry available',
  not_needed: 'Alert expired before geometry was needed',
};

export const AlertPanel: React.FC<{ id: number | null; onClose: () => void; onZoom?: (bbox: number[]) => void }> = ({ id, onClose, onZoom }) => {
  if (id == null) return null;
  return (
    <SlideOver open onClose={onClose} width="max-w-xl" title="Official alert">
      <AlertDetail id={id} onZoom={onZoom} />
    </SlideOver>
  );
};

/** Official alert, its area and its operational impact on JalSetu records. */
export const AlertDetail: React.FC<{ id: number | null; onZoom?: (bbox: number[]) => void }> = ({ id, onZoom }) => {
  const { fail, toast, can, refresh } = useApp();
  const [e, setE] = useState<DisasterEvent | null>(null);
  const [imp, setImp] = useState<DisasterImpact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setE(null); setImp(null); setErr(null);
    if (id == null) return;
    api.disaster(id).then(setE).catch(x => setErr(x.message));
    api.disasterImpact(id).then(setImp).catch(x => setErr(x.message));
  }, [id]);
  if (id == null) return null;
  return (
    <>
      {err && <ErrorBox message={err} />}
      {!e ? <Loading /> : (
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2"><SeverityChip severity={e.severity} /><span className="text-[15px] font-semibold">{e.eventRaw || e.eventType}</span></div>
            <p className="mt-1 text-[12px] text-cc-muted">{e.provider} via {e.sourceLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2"><KindLabel kind="external-alert" title="Issued by an official authority; JalSetu does not create alerts" />
            <StatusChip status={e.status === 'active' ? 'connected' : 'unknown'} label={e.status} /></div>
          <p className="text-sm leading-relaxed">{e.headline}</p>
          {e.instruction && <p className="rounded-md border border-cc-border bg-cc-raised p-2 text-xs text-cc-muted">Official instruction: {e.instruction}</p>}
          <div>
            <KV k="Where" v={e.areaDesc || '—'} />
            <KV k="Severity · urgency · certainty" v={`${e.severity} · ${e.urgency} · ${e.certainty}`} />
            <KV k="Onset" v={<span className="num">{dt(e.onsetAt)}</span>} />
            <KV k="Expires" v={<span className="num">{dt(e.expiresAt)}</span>} />
            <KV k="Published" v={<span className="num">{dt(e.publishedAt)}</span>} />
            <KV k="Retrieved by JalSetu" v={<span className="num">{dt(e.retrievedAt)}</span>} />
            <KV k="Issuer" v={e.provider} />
            <KV k="CAP identifier" v={<span className="num text-xs">{e.externalId}</span>} />
            <KV k="Area geometry" v={<span className="text-xs">{AREA_METHOD[e.geometryStatus] || e.geometryStatus}</span>} />
            {e.lgdDistrictCodes.length > 0 && <KV k="LGD district codes" v={<span className="num text-xs">{e.lgdDistrictCodes.join(', ')}</span>} />}
          </div>
          <div className="flex flex-wrap gap-2">
            <SourceLink href={e.sourceUrl} label="Official CAP record" />
            {e.bbox && <Button size="sm" onClick={() => onZoom?.(e.bbox!)}>Zoom to area</Button>}
            {can('acknowledge') && !e.acknowledgedBy && <Button size="sm" onClick={async () => { try { setE(await api.acknowledgeDisaster(e.id)); refresh('disasters'); } catch (x) { fail(x); } }}>Acknowledge</Button>}
            {e.acknowledgedBy && <Chip tone="ok">Acknowledged by {e.acknowledgedBy}</Chip>}
          </div>

          <section className="rounded-lg border border-cc-border">
            <header className="flex items-center justify-between border-b border-cc-border px-3 py-2">
              <p className="text-sm font-semibold">Operational impact</p><KindLabel kind="rule-based" title="Deterministic intersection of the alert area with JalSetu records" />
            </header>
            {!imp ? <Loading label="Computing impact…" /> : (
              <div className="space-y-3 p-3 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[['Communities', imp.communities.length], ['Open requests', imp.openRequests.length], ['Tankers ≤ ' + imp.radiusKm + ' km', imp.availableTankersNearby.length], ['Trips touching', imp.tripsAffected.length]].map(([k, val]) => (
                    <div key={k as string} className="rounded-md bg-cc-raised p-2 text-center"><p className="num text-lg font-semibold">{val}</p><p className="text-2xs text-cc-muted">{k}</p></div>
                  ))}
                </div>
                <div className="rounded-md border border-cc-accent/30 bg-cc-accent/5 p-3">
                  <p className="font-medium">{imp.recommendation.headline}</p>
                  {imp.recommendation.actions.length > 0 && <ol className="mt-2 list-decimal space-y-1 pl-5 text-cc-muted">{imp.recommendation.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>}
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-cc-accent">Why: factors and sources</summary>
                  <table className="table-cc mt-2 text-xs"><thead><tr><th>Factor</th><th>Value</th><th>Source</th></tr></thead>
                    <tbody>{imp.recommendation.factors.map(f => <tr key={f.factor}><td>{f.factor}</td><td>{String(f.value)}</td><td className="text-cc-muted">{f.source}</td></tr>)}</tbody></table>
                </details>
                {imp.communities.length > 0 && (
                  <details open>
                    <summary className="cursor-pointer text-xs text-cc-accent">Affected communities ({imp.communities.length})</summary>
                    <ul className="mt-1 space-y-1">{imp.communities.map(c => <li key={c.id} className="flex items-center justify-between gap-2 text-xs"><span>{c.name}</span><span className="flex items-center gap-2"><span className="num text-cc-muted">vuln {Math.round(c.vulnerabilityScore)}</span><OriginLabel origin={c.dataOrigin} /></span></li>)}</ul>
                  </details>
                )}
                {can('acknowledge') && <Button size="sm" variant="secondary" onClick={async () => { try { await api.saveRecommendation(e.id); toast('Recommendation recorded', 'Snapshot of all facts saved to the audit trail.', 'success'); } catch (x) { fail(x); } }}>Record recommendation snapshot</Button>}
                <p className="text-2xs text-cc-faint">Computed {dt(imp.computedAt)} from JalSetu records only. No figures are estimated.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
};
