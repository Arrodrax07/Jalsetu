import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Droplets, LogOut, Navigation, PenLine, RefreshCw, Satellite, Truck, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import type { DriverAssignment, Trip } from '../types';
import { Button, Chip, cx } from '../components/ui';
import { currentFix, Fix, geoErrorText, GpsError, GpsWatcher, haversineM, keepAwake, TelemetryUploader, UploadStatus } from './telemetry';

const MOVING = ['En Route', 'Arrived', 'Delivering', 'Delivered'];

function fmtDist(m: number | null | undefined) {
  if (m == null) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export const DriverApp: React.FC = () => {
  const { user, logout, fail, toast } = useApp();
  const [data, setData] = useState<DriverAssignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<GpsError>(null);
  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const watcher = useRef<GpsWatcher | null>(null);
  const uploader = useRef<TelemetryUploader | null>(null);
  const release = useRef<(() => void) | null>(null);

  const trip = data?.trip ?? null;
  const vehicle = data?.vehicle ?? null;
  const th = data?.thresholds;
  const stop = trip?.stops.find(s => s.status === 'Pending' || s.status === 'Arrived') ?? null;
  const telemetryActive = !!trip && MOVING.includes(trip.status) && !trip.driverEndedAt;

  const load = useCallback(async () => {
    try { setData(await api.driverAssignment()); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);
  useEffect(() => {
    const on = () => { setOnline(true); load(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [load]);

  // GPS watch runs whenever there is an open trip (so START has a fresh fix); upload only after START.
  const needGps = !!trip && ['Assigned', 'Accepted', ...MOVING].includes(trip.status) && !trip.driverEndedAt;
  useEffect(() => {
    if (!needGps) { watcher.current?.stop(); watcher.current = null; return; }
    const w = new GpsWatcher(f => { setFix(f); uploader.current?.add(f); }, setGpsError);
    watcher.current = w;
    w.start();
    return () => w.stop();
  }, [needGps]);

  useEffect(() => {
    if (!telemetryActive || !trip || !vehicle) return;
    const u = new TelemetryUploader(vehicle.vehicleId, trip.id, (s, resp) => {
      setUpload(s);
      if (resp && resp.tripStatus !== trip.status) load();   // server-side transition (e.g. GPS arrival)
      if (resp?.arrivedAt) toast('Arrival detected', `GPS confirms you are at ${resp.arrivedAt}.`, 'success');
    });
    uploader.current = u;
    u.start();
    if (fix) u.add(fix);
    keepAwake().then(r => { release.current = r; });
    return () => { u.stop(); uploader.current = null; release.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetryActive, trip?.id, vehicle?.vehicleId]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await load(); } catch (e) { fail(e, `${label} failed`); }
    setBusy(null);
  };

  const start = () => act('Start trip', async () => {
    if (!trip) return;
    const f: Fix = fix && Date.now() - Date.parse(fix.deviceTime) < 30000 ? fix : await currentFix().catch((e: GpsError) => { throw new Error(geoErrorText(e)); });
    if (f.accuracyM == null || (th && f.accuracyM > th.startMaxAccuracyM)) {
      throw new Error(`GPS accuracy ${f.accuracyM ?? '?'} m — need ≤ ${th?.startMaxAccuracyM} m. Move to open sky and wait a moment.`);
    }
    await api.startTrip(trip.id, { lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, speedKmh: f.speedKmh, heading: f.heading, deviceTime: f.deviceTime });
    toast('Trip started', 'Live tracking is on. Keep this screen open.', 'success');
  });

  if (!user) return null;
  const distLocal = fix && stop ? haversineM(fix, stop) : null;
  const fixAge = fix ? Math.round((Date.now() - Date.parse(fix.deviceTime)) / 1000) : null;

  return (
    <div className="min-h-full bg-cc-bg pb-10">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-cc-border bg-cc-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Droplets className="h-5 w-5 text-cc-accent" aria-hidden />
          <div><p className="text-sm font-semibold">JalSetu Driver</p><p className="text-2xs text-cc-muted">{user.name}</p></div>
        </div>
        <div className="flex items-center gap-2">
          {online ? <Chip tone="ok">Online</Chip> : <Chip tone="danger" icon={<WifiOff className="h-3 w-3" />}>Offline</Chip>}
          <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => { watcher.current?.stop(); logout(); }}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 p-4">
        {loadError && <p role="alert" className="rounded-lg border border-cc-danger/40 bg-cc-danger/10 p-3 text-sm text-red-200">Server unreachable: {loadError}. Your GPS fixes are kept on this phone and will be sent when the connection returns.</p>}

        {vehicle && (
          <section className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Vehicle</p>
                <p className="text-lg font-semibold">{vehicle.registration}</p>
                <p className="text-xs text-cc-muted">Tracking source: Phone GPS (this device)</p>
              </div>
              <Truck className="h-6 w-6 text-cc-faint" aria-hidden />
            </div>
          </section>
        )}

        {needGps && <GpsPanel fix={fix} fixAge={fixAge} error={gpsError} upload={upload} active={telemetryActive} />}

        {!trip && (
          <section className="panel p-6 text-center">
            <p className="text-base font-medium">No active assignment</p>
            <p className="mt-1 text-sm text-cc-muted">Your trip will appear here when the dispatcher assigns it.</p>
            <Button className="mx-auto mt-4" icon={<RefreshCw className="h-4 w-4" />} onClick={load}>Refresh</Button>
          </section>
        )}

        {trip && <TripCard trip={trip} />}

        {trip && stop && MOVING.includes(trip.status) && (
          <section className="panel p-4">
            <p className="eyebrow">Destination · stop {stop.seq} of {trip.stops.length}</p>
            <p className="text-lg font-semibold">{stop.communityName}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-cc-raised p-3"><p className="eyebrow">Distance (GPS)</p><p className="num text-xl font-semibold">{fmtDist(distLocal)}</p></div>
              <div className="rounded-lg bg-cc-raised p-3"><p className="eyebrow">Deliver</p><p className="num text-xl font-semibold">{stop.allocatedLitres.toLocaleString('en-IN')} L</p></div>
            </div>
            <a className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-cc-border py-3 text-sm font-medium text-cc-accent"
              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`} target="_blank" rel="noreferrer">
              <Navigation className="h-4 w-4" /> Open navigation
            </a>
          </section>
        )}

        {/* ---- primary action for the current state ---- */}
        {trip && (trip.status === 'Assigned' || trip.status === 'Planned') && (
          <Button variant="primary" size="lg" className="w-full" loading={busy === 'Accept'} onClick={() => act('Accept', () => api.acceptTrip(trip.id))}>ACCEPT TRIP</Button>
        )}
        {trip?.status === 'Accepted' && (
          <div className="space-y-2">
            <Button variant="success" size="lg" className="w-full" loading={busy === 'Start trip'} onClick={start}
              disabled={!!gpsError && gpsError === 'permission_denied'}>START TRIP</Button>
            <p className="text-center text-xs text-cc-muted">Needs a fresh GPS fix with accuracy ≤ {th?.startMaxAccuracyM} m. Location permission will be requested.</p>
          </div>
        )}
        {trip?.status === 'En Route' && (
          <div className="space-y-2">
            <Button size="lg" className="w-full" disabled>ARRIVED</Button>
            <p className="text-center text-xs text-cc-muted">Unlocks automatically when GPS shows you within {th?.geofenceRadiusM} m of the destination for {th?.arrivalConsecutiveFixes} consecutive fixes.</p>
          </div>
        )}
        {trip?.status === 'Arrived' && (
          <Button variant="success" size="lg" className="w-full" loading={busy === 'Confirm arrival'} onClick={() => act('Confirm arrival', () => api.confirmArrival(trip.id))}>
            ARRIVED · CONFIRM
          </Button>
        )}
        {trip?.status === 'Delivering' && stop && <DeliveryForm trip={trip} litres={stop.allocatedLitres} onDone={load} />}
        {trip?.status === 'Delivered' && !trip.driverEndedAt && (
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" loading={busy === 'End trip'} onClick={() => act('End trip', async () => { await api.endTrip(trip.id); uploader.current?.stop(); })}>END TRIP</Button>
            <p className="text-center text-xs text-cc-muted">All deliveries recorded. Ending stops location sharing. An operator then verifies the delivery.</p>
          </div>
        )}
        {trip?.status === 'Delivered' && trip.driverEndedAt && (
          <section className="panel p-4 text-center text-sm text-cc-muted">Trip ended. Awaiting operator verification of the delivery.</section>
        )}
      </main>
    </div>
  );
};

const GpsPanel: React.FC<{ fix: Fix | null; fixAge: number | null; error: GpsError; upload: UploadStatus | null; active: boolean }> = ({ fix, fixAge, error, upload, active }) => (
  <section className={cx('panel p-4', error && 'border-cc-danger/50')}>
    <div className="flex items-center justify-between">
      <p className="eyebrow flex items-center gap-1.5"><Satellite className="h-3.5 w-3.5" /> GPS</p>
      {error ? <Chip tone="danger">Error</Chip> : fix ? (fixAge != null && fixAge <= 30 ? <Chip tone="ok">Fix OK</Chip> : <Chip tone="warn">Old fix</Chip>) : <Chip tone="neutral">Searching…</Chip>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-200">{geoErrorText(error)}</p>}
    {fix && (
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-cc-muted">Accuracy</dt><dd className="num text-right">± {fix.accuracyM ?? '?'} m</dd>
        <dt className="text-cc-muted">Position</dt><dd className="num text-right">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</dd>
        <dt className="text-cc-muted">Fix time</dt><dd className="num text-right">{new Date(fix.deviceTime).toLocaleTimeString('en-IN')} ({fixAge}s ago)</dd>
        {fix.speedKmh != null && <><dt className="text-cc-muted">Speed</dt><dd className="num text-right">{fix.speedKmh} km/h</dd></>}
      </dl>
    )}
    {active && upload && (
      <div className="mt-3 border-t border-cc-border pt-2 text-xs text-cc-muted space-y-0.5">
        <p>Last sent: {upload.lastSentAt ? new Date(upload.lastSentAt).toLocaleTimeString('en-IN') : 'not yet'} · Buffered: <span className="num">{upload.queued}</span></p>
        {!upload.online && <p className="text-amber-300">No connection — fixes are kept on this phone and sent when back online.</p>}
        {upload.error && <p className="text-amber-300">{upload.error}</p>}
      </div>
    )}
  </section>
);

const TripCard: React.FC<{ trip: Trip }> = ({ trip }) => (
  <section className="panel p-4">
    <div className="flex items-center justify-between">
      <div><p className="eyebrow">Trip</p><p className="text-lg font-semibold">{trip.id}</p></div>
      <Chip tone={trip.status === 'Completed' ? 'ok' : 'accent'}>{trip.status}</Chip>
    </div>
    <ol className="mt-3 space-y-2">
      {trip.stops.map(s => (
        <li key={s.id} className="flex items-center gap-3 text-sm">
          <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
            s.status === 'Delivered' || s.status === 'Verified' ? 'bg-emerald-600 text-white' : s.status === 'Arrived' ? 'bg-cc-accent-strong text-white' : 'bg-cc-raised text-cc-muted')}>
            {s.status === 'Delivered' || s.status === 'Verified' ? <CheckCircle2 className="h-4 w-4" /> : s.seq}
          </span>
          <span className="flex-1">{s.communityName}</span>
          <span className="num text-cc-muted">{s.allocatedLitres.toLocaleString('en-IN')} L</span>
        </li>
      ))}
    </ol>
  </section>
);

const DeliveryForm: React.FC<{ trip: Trip; litres: number; onDone: () => void }> = ({ trip, litres, onDone }) => {
  const { fail, toast } = useApp();
  const [amount, setAmount] = useState(litres);
  const [receiver, setReceiver] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [sig, setSig] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.recordDelivery(trip.id, { deliveredAmount: amount, receiverName: receiver, receiverPhone: phone, notes, signature: sig || undefined, photo });
      toast('Delivery recorded', r.delivery.status === 'Mismatch' ? `Flagged for review: ${r.delivery.notes}` : 'Awaiting operator verification.', r.delivery.status === 'Mismatch' ? 'warning' : 'success');
      onDone();
    } catch (err) { fail(err, 'Delivery not recorded'); }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="panel space-y-3 border-cc-accent/50 p-4">
      <p className="text-base font-semibold">Record delivery</p>
      <label className="block"><span className="label">Litres delivered (from meter)</span>
        <input className="input num py-3 text-lg font-semibold" type="number" inputMode="numeric" min={0} max={60000} step={100} value={amount} onChange={e => setAmount(Number(e.target.value))} required />
      </label>
      <label className="block"><span className="label">Receiver / authorised representative</span>
        <input className="input py-3" value={receiver} onChange={e => setReceiver(e.target.value)} required minLength={2} autoComplete="name" />
      </label>
      <label className="block"><span className="label">Receiver phone (optional)</span>
        <input className="input py-3" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      </label>
      <SignaturePad onChange={setSig} />
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cc-strong px-3 py-3 text-sm text-cc-muted">
        <Camera className="h-5 w-5" aria-hidden />{photo ? photo.name : 'Photo of meter / handover (optional)'}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={e => setPhoto(e.target.files?.[0] || null)} />
      </label>
      <input className="input py-3" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      <p className="text-2xs text-cc-faint">The vehicle's latest real GPS fix is attached on the server and checked against the destination.</p>
      <Button type="submit" variant="success" size="lg" className="w-full" loading={busy} icon={<CheckCircle2 className="h-5 w-5" />}>DELIVERY DONE</Button>
    </form>
  );
};

const SignaturePad: React.FC<{ onChange: (dataUrl: string) => void }> = ({ onChange }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * (ref.current!.width / r.width), (e.clientY - r.top) * (ref.current!.height / r.height)] as const;
  };
  const down = (e: React.PointerEvent) => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.strokeStyle = '#e6edf6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y);
    drawing.current = true; ref.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; setHas(true); onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => { ref.current!.getContext('2d')!.clearRect(0, 0, 600, 200); setHas(false); onChange(''); };
  return (
    <div>
      <div className="flex items-center justify-between"><span className="label flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> Receiver signature (optional)</span>
        {has && <button type="button" className="text-xs text-cc-accent" onClick={clear}>Clear</button>}</div>
      <canvas ref={ref} width={600} height={200} aria-label="Signature pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="h-32 w-full touch-none rounded-lg border border-cc-border bg-cc-bg" />
    </div>
  );
};

