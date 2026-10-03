import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, LogOut, Mic, Navigation, PenLine, RefreshCw, Satellite, Truck, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import type { DriverAssignment, Trip } from '../types';
import { Button, Chip, cx, EASE, SPRING } from '../components/ui';
import { Mark } from '../components/shell/Shell';
import { currentFix, Fix, geoErrorText, GpsError, GpsWatcher, haversineM, keepAwake, TelemetryUploader, UploadStatus } from './telemetry';
import { speechLocale, useLang } from '../i18n';
import { parseDriverCommand, speak, speechSupported, ttsSupported, useDictation } from '../i18n/speech';
import { LangSwitch } from '../citizen/widgets';

const MOVING = ['En Route', 'Arrived', 'Delivering', 'Delivered'];

function fmtDist(m: number | null | undefined) {
  if (m == null) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

const SPEAK_KEY = 'jalsetu_driver_speak';

export const DriverApp: React.FC = () => {
  const { user, logout, fail, toast } = useApp();
  const { t, lang } = useLang();
  const [speakOn, setSpeakOn] = useState(() => { try { return localStorage.getItem(SPEAK_KEY) !== 'off'; } catch { return true; } });
  const say = useCallback((text: string) => { if (speakOn) speak(text, speechLocale(lang)); }, [speakOn, lang]);
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

  // Spoken updates when the trip moves to a new state (server-driven, e.g. GPS arrival).
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const st = trip ? `${trip.id}:${trip.status}` : null;
    if (st === lastStatus.current) return;
    const first = lastStatus.current === null;
    lastStatus.current = st;
    if (!trip || (first && trip.status !== 'Assigned')) return;
    const place = stop?.communityName ?? '';
    if (trip.status === 'Assigned') say(t('drv.say.assigned', { n: trip.stops.length, p: trip.stops[0]?.communityName ?? '' }));
    else if (trip.status === 'En Route') say(t('drv.say.started', { p: place }));
    else if (trip.status === 'Arrived') say(t('drv.say.arrived', { p: place }));
    else if (trip.status === 'Delivered') say(t('drv.say.delivered'));
  }, [trip, stop, say, t]);

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

  const runCommand = (heard: string) => {
    const cmd = parseDriverCommand(heard);
    if (!trip || !cmd) { toast(t('drv.voiceCmd'), t('drv.voiceUnknown', { t: heard }), 'warning'); return; }
    if (cmd === 'accept' && (trip.status === 'Assigned' || trip.status === 'Planned')) act('Accept', () => api.acceptTrip(trip.id));
    else if (cmd === 'start' && trip.status === 'Accepted') start();
    else if (cmd === 'confirm' && trip.status === 'Arrived') act('Confirm arrival', () => api.confirmArrival(trip.id));
    else if (cmd === 'end' && trip.status === 'Delivered' && !trip.driverEndedAt) act('End trip', async () => { await api.endTrip(trip.id); uploader.current?.stop(); });
    else toast(t('drv.voiceCmd'), `“${heard}” — ${trip.status}`, 'warning');
  };

  if (!user) return null;
  const distLocal = fix && stop ? haversineM(fix, stop) : null;
  const fixAge = fix ? Math.round((Date.now() - Date.parse(fix.deviceTime)) / 1000) : null;

  return (
    <div className="min-h-full bg-cc-bg pb-10">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-cc-border bg-cc-bg/85 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <Mark className="h-8 w-8 text-cc-accent" />
          <div className="leading-none"><p className="display text-[22px]">JalSetu <span className="text-cc-muted">{t('drv.title')}</span></p><p className="mt-0.5 text-[11px] text-cc-muted">{user.name}</p></div>
        </div>
        <div className="flex items-center gap-2">
          {online ? <Chip tone="ok">{t('drv.online')}</Chip> : <Chip tone="danger" icon={<WifiOff className="h-3 w-3" />}>{t('drv.offline')}</Chip>}
          {ttsSupported && <Button variant="ghost" size="sm" aria-pressed={speakOn} aria-label={t('drv.speakUpdates')} title={t('drv.speakUpdates')}
            onClick={() => { const v = !speakOn; setSpeakOn(v); try { localStorage.setItem(SPEAK_KEY, v ? 'on' : 'off'); } catch { /* ignore */ } }}>
            {speakOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button>}
          <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => { watcher.current?.stop(); logout(); }}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 p-4">
        <div className="flex justify-center"><LangSwitch /></div>
        {loadError && <p role="alert" className="rounded-lg border border-cc-danger/40 bg-cc-danger/10 p-3 text-sm text-red-700">Server unreachable: {loadError}. Your GPS fixes are kept on this phone and will be sent when the connection returns.</p>}

        {vehicle && (
          <section className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">{t('drv.vehicle')}</p>
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
            <p className="text-base font-medium">{t('drv.noTrip')}</p>
            <p className="mt-1 text-sm text-cc-muted">{t('drv.noTripBody')}</p>
            <Button className="mx-auto mt-4" icon={<RefreshCw className="h-4 w-4" />} onClick={load}>{t('drv.refresh')}</Button>
          </section>
        )}

        {trip && <Journey status={trip.status} ended={!!trip.driverEndedAt} />}
        {trip && <TripCard trip={trip} />}

        {trip && stop && MOVING.includes(trip.status) && (
          <section className="panel p-4">
            <p className="eyebrow">{t('drv.destination')} · {t('drv.stopOf', { a: stop.seq, b: trip.stops.length })}</p>
            <p className="display mt-0.5 text-3xl leading-tight">{stop.communityName}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-cc-raised p-4"><p className="eyebrow">{t('drv.distance')}</p><p className="display num mt-1 text-4xl leading-none">{fmtDist(distLocal)}</p></div>
              <div className="rounded-2xl bg-cc-raised p-4"><p className="eyebrow">{t('drv.deliver')}</p><p className="display num mt-1 text-4xl leading-none">{stop.allocatedLitres.toLocaleString('en-IN')}<span className="text-lg text-cc-faint"> L</span></p></div>
            </div>
            <a className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-cc-border bg-cc-surface py-3.5 text-sm font-medium text-cc-accent-strong transition hover:border-cc-strong"
              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`} target="_blank" rel="noreferrer">
              <Navigation className="h-4 w-4" /> {t('drv.navigate')}
            </a>
          </section>
        )}

        {/* ---- primary action for the current state ---- */}
        {trip && (trip.status === 'Assigned' || trip.status === 'Planned') && (
          <Button variant="primary" size="lg" className="w-full" loading={busy === 'Accept'} onClick={() => act('Accept', () => api.acceptTrip(trip.id))}>{t('drv.accept')}</Button>
        )}
        {trip?.status === 'Accepted' && (
          <div className="space-y-2">
            <Button variant="success" size="lg" className="w-full" loading={busy === 'Start trip'} onClick={start}
              disabled={!!gpsError && gpsError === 'permission_denied'}>{t('drv.start')}</Button>
            <p className="text-center text-xs text-cc-muted">{t('drv.startHint', { m: th?.startMaxAccuracyM ?? '' })}</p>
          </div>
        )}
        {trip?.status === 'En Route' && (
          <div className="space-y-2">
            <Button size="lg" className="w-full" disabled>{t('drv.arrived')}</Button>
            <p className="text-center text-xs text-cc-muted">{t('drv.arriveHint', { m: th?.geofenceRadiusM ?? '' })}</p>
          </div>
        )}
        {trip?.status === 'Arrived' && (
          <Button variant="success" size="lg" className="w-full" loading={busy === 'Confirm arrival'} onClick={() => act('Confirm arrival', () => api.confirmArrival(trip.id))}>
            {t('drv.confirm')}
          </Button>
        )}
        {trip?.status === 'Delivering' && stop && <DeliveryForm trip={trip} litres={stop.allocatedLitres} onDone={load} />}
        {trip?.status === 'Delivered' && !trip.driverEndedAt && (
          <div className="space-y-2">
            <Button variant="primary" size="lg" className="w-full" loading={busy === 'End trip'} onClick={() => act('End trip', async () => { await api.endTrip(trip.id); uploader.current?.stop(); })}>{t('drv.end')}</Button>
            <p className="text-center text-xs text-cc-muted">{t('drv.endHint')}</p>
          </div>
        )}
        {trip?.status === 'Delivered' && trip.driverEndedAt && (
          <section className="panel p-4 text-center text-sm text-cc-muted">{t('drv.ended')}</section>
        )}
        {trip && speechSupported && ['Assigned', 'Planned', 'Accepted', 'Arrived', 'Delivered'].includes(trip.status) && !trip.driverEndedAt && (
          <VoiceCommand onHeard={runCommand} />
        )}
      </main>
    </div>
  );
};

const VoiceCommand: React.FC<{ onHeard: (t: string) => void }> = ({ onHeard }) => {
  const { t, lang } = useLang();
  const d = useDictation(speechLocale(lang), onHeard);
  return (
    <section className="panel flex items-center gap-3 p-3">
      <motion.button type="button" onClick={d.listening ? d.stop : d.start} whileTap={{ scale: 0.92 }} aria-pressed={d.listening} aria-label={t('drv.voiceCmd')}
        className={cx('relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-white', d.listening ? 'bg-cc-danger' : 'bg-cc-text')}>
        {d.listening && <motion.span aria-hidden className="absolute inset-0 rounded-full bg-cc-danger" animate={{ scale: [1, 1.4], opacity: [0.45, 0] }} transition={{ duration: 1.1, repeat: Infinity }} />}
        <Mic className="relative h-6 w-6" />
      </motion.button>
      <div className="min-w-0" aria-live="polite">
        <p className="text-sm font-semibold">{t('drv.voiceCmd')}</p>
        <p className="text-xs text-cc-muted">{d.state === 'listening' ? t('voice.listening') : d.state === 'processing' ? t('voice.processing')
          : d.state === 'denied' ? t('voice.denied') : d.state === 'offline' ? t('voice.offline') : d.state === 'no_speech' ? t('voice.noSpeech') : t('drv.voiceHint')}</p>
        {d.interim && <p className="truncate text-xs italic text-cc-muted">“{d.interim}”</p>}
      </div>
    </section>
  );
};

const GpsPanel: React.FC<{ fix: Fix | null; fixAge: number | null; error: GpsError; upload: UploadStatus | null; active: boolean }> = ({ fix, fixAge, error, upload, active }) => {
  const { t } = useLang();
  return (
  <section className={cx('panel p-4', error && 'border-cc-danger/50')}>
    <div className="flex items-center justify-between">
      <p className="eyebrow flex items-center gap-1.5"><Satellite className="h-3.5 w-3.5" /> {t('drv.gps')}</p>
      {error ? <Chip tone="danger">{t('drv.gpsError')}</Chip> : fix ? (fixAge != null && fixAge <= 30 ? <Chip tone="ok">{t('drv.gpsOk')}</Chip> : <Chip tone="warn">{t('drv.gpsOld')}</Chip>) : <Chip tone="neutral">{t('drv.gpsSearching')}</Chip>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{geoErrorText(error)}</p>}
    {fix && (
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-cc-muted">{t('drv.accuracy')}</dt><dd className="num text-right">± {fix.accuracyM ?? '?'} m</dd>
        <dt className="text-cc-muted">Position</dt><dd className="num text-right">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</dd>
        <dt className="text-cc-muted">Fix time</dt><dd className="num text-right">{new Date(fix.deviceTime).toLocaleTimeString('en-IN')} ({fixAge}s ago)</dd>
        {fix.speedKmh != null && <><dt className="text-cc-muted">Speed</dt><dd className="num text-right">{fix.speedKmh} km/h</dd></>}
      </dl>
    )}
    {active && upload && (
      <div className="mt-3 border-t border-cc-border pt-2 text-xs text-cc-muted space-y-0.5">
        <p>{t('drv.lastSent')}: {upload.lastSentAt ? new Date(upload.lastSentAt).toLocaleTimeString('en-IN') : '—'} · {t('drv.buffered')}: <span className="num">{upload.queued}</span></p>
        {!upload.online && <p className="text-amber-800">{t('drv.noConn')}</p>}
        {upload.error && <p className="text-amber-800">{upload.error}</p>}
      </div>
    )}
  </section>
  );
};

const STEPS = ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering', 'Delivered'] as const;

/** Where the driver is in the trip, at a glance. */
const Journey: React.FC<{ status: string; ended: boolean }> = ({ status, ended }) => {
  const { t } = useLang();
  const idx = Math.max(0, STEPS.indexOf((status === 'Planned' ? 'Assigned' : status) as typeof STEPS[number]));
  const pct = ended ? 100 : (idx / (STEPS.length - 1)) * 100;
  return (
    <section className="panel px-4 pb-4 pt-5">
      <div className="relative mx-3">
        <div className="absolute left-0 right-0 top-[11px] h-[3px] rounded-full bg-cc-hover" />
        <motion.div className="absolute left-0 top-[11px] h-[3px] rounded-full bg-cc-accent" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: EASE }} />
        <ol className="relative flex justify-between">
          {STEPS.map((s, i) => {
            const done = i < idx || ended, here = i === idx && !ended;
            return (
              <li key={s} className="flex w-0 flex-col items-center">
                <motion.span initial={false} animate={{ scale: here ? 1.15 : 1 }} transition={SPRING}
                  className={cx('flex h-[25px] w-[25px] items-center justify-center rounded-full border-2 text-[10px] font-semibold',
                    done ? 'border-cc-accent bg-cc-accent text-white' : here ? 'border-cc-accent bg-cc-surface text-cc-accent shadow-[0_0_0_5px_rgb(12_110_150/0.12)]' : 'border-cc-border bg-cc-surface text-cc-faint')}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </motion.span>
                <span className={cx('mt-1.5 whitespace-nowrap text-[10.5px]', here ? 'font-semibold text-cc-text' : 'text-cc-muted')}>{t(`drv.step.${s}`)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
};

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
            s.status === 'Delivered' || s.status === 'Verified' ? 'bg-cc-ok text-white' : s.status === 'Arrived' ? 'bg-cc-accent-strong text-white' : 'bg-cc-raised text-cc-muted')}>
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
  const { t } = useLang();
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
      <p className="text-base font-semibold">{t('drv.record')}</p>
      <label className="block"><span className="label">{t('drv.litres')}</span>
        <input className="input num py-3 text-lg font-semibold" type="number" inputMode="numeric" min={0} max={60000} step={100} value={amount} onChange={e => setAmount(Number(e.target.value))} required />
      </label>
      <label className="block"><span className="label">{t('drv.receiver')}</span>
        <input className="input py-3" value={receiver} onChange={e => setReceiver(e.target.value)} required minLength={2} autoComplete="name" />
      </label>
      <label className="block"><span className="label">{t('drv.receiverPhone')}</span>
        <input className="input py-3" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      </label>
      <SignaturePad onChange={setSig} />
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cc-strong px-3 py-3 text-sm text-cc-muted">
        <Camera className="h-5 w-5" aria-hidden />{photo ? photo.name : t('drv.photo')}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={e => setPhoto(e.target.files?.[0] || null)} />
      </label>
      <input className="input py-3" placeholder={t('drv.notes')} value={notes} onChange={e => setNotes(e.target.value)} />
      <p className="text-2xs text-cc-faint">The vehicle's latest real GPS fix is attached on the server and checked against the destination.</p>
      <Button type="submit" variant="success" size="lg" className="w-full" loading={busy} icon={<CheckCircle2 className="h-5 w-5" />}>{t('drv.deliveryDone')}</Button>
    </form>
  );
};

const SignaturePad: React.FC<{ onChange: (dataUrl: string) => void }> = ({ onChange }) => {
  const { t } = useLang();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * (ref.current!.width / r.width), (e.clientY - r.top) * (ref.current!.height / r.height)] as const;
  };
  const down = (e: React.PointerEvent) => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.strokeStyle = '#131f2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
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
      <div className="flex items-center justify-between"><span className="label flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> {t('drv.signature')}</span>
        {has && <button type="button" className="text-xs text-cc-accent" onClick={clear}>{t('drv.clear')}</button>}</div>
      <canvas ref={ref} width={600} height={200} aria-label="Signature pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="h-32 w-full touch-none rounded-lg border border-cc-border bg-cc-bg" />
    </div>
  );
};

