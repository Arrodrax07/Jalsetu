import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, DotsThree, Loader2, LogOut, Mic, Navigation, PenLine, RefreshCw, Satellite, Truck, Volume2, VolumeX, WifiOff } from '../components/icons';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import type { DriverAssignment, Trip } from '../types';
import { Button, cx, ProvMark } from '../components/ui';
import { DUR, EASE_OUT, SPRING, SPRING_SHEET, SPRING_SOFT } from '../motion';
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
  const [menu, setMenu] = useState(false);
  const [finished, setFinished] = useState<{ id: string; place: string } | null>(null);
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
      if (resp?.arrivedAt) toast(t('drv.arrivalToast'), t('drv.arrivalToastBody', { p: resp.arrivedAt }), 'success');
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
      throw new Error(`GPS accuracy ${f.accuracyM ?? '?'} m; need ≤ ${th?.startMaxAccuracyM} m. Move to open sky and wait a moment.`);
    }
    await api.startTrip(trip.id, { lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, speedKmh: f.speedKmh, heading: f.heading, deviceTime: f.deviceTime });
    toast(t('drv.started'), t('drv.startedBody'), 'success');
  });

  const runCommand = (heard: string) => {
    const cmd = parseDriverCommand(heard);
    if (!trip || !cmd) { toast(t('drv.voiceCmd'), t('drv.voiceUnknown', { t: heard }), 'warning'); return; }
    if (cmd === 'accept' && (trip.status === 'Assigned' || trip.status === 'Planned')) act('Accept', () => api.acceptTrip(trip.id));
    else if (cmd === 'start' && trip.status === 'Accepted') start();
    else if (cmd === 'confirm' && trip.status === 'Arrived') act('Confirm arrival', () => api.confirmArrival(trip.id));
    else if (cmd === 'end' && trip.status === 'Delivered' && !trip.driverEndedAt) act('End trip', async () => { await api.endTrip(trip.id); uploader.current?.stop(); });
    else toast(t('drv.voiceCmd'), `“${heard}” · ${trip.status}`, 'warning');
  };

  if (!user) return null;
  const distLocal = fix && stop ? haversineM(fix, stop) : null;
  const fixAge = fix ? Math.round((Date.now() - Date.parse(fix.deviceTime)) / 1000) : null;
  const ended = !!trip?.driverEndedAt;
  const place = stop?.communityName ?? trip?.stops[trip.stops.length - 1]?.communityName ?? '';
  const taskKey = !trip ? 'none' : ended ? 'ended' : trip.status === 'Planned' ? 'Assigned' : trip.status;
  const radius = th?.geofenceRadiusM ?? 150;

  // The one thing to do now, at thumb height.
  let action: React.ReactNode = null;
  if (trip && !ended) {
    if (trip.status === 'Assigned' || trip.status === 'Planned') action = (
      <DockButton tone="ink" loading={busy === 'Accept'} onClick={() => act('Accept', () => api.acceptTrip(trip.id))}>{t('drv.accept')}</DockButton>);
    else if (trip.status === 'Accepted') action = (
      <>
        <p className="mb-2 text-center text-[12.5px] text-cc-muted">{t('drv.startHint', { m: th?.startMaxAccuracyM ?? '' })}</p>
        <DockButton tone="accent" loading={busy === 'Start trip'} onClick={start} disabled={gpsError === 'permission_denied'}>{t('drv.start')}</DockButton>
      </>);
    else if (trip.status === 'En Route') {
      const near = distLocal != null ? Math.max(0, Math.min(1, radius / Math.max(distLocal, radius))) : 0;
      action = (
        <>
          <div className="mb-2 flex items-center justify-between text-[12.5px] text-cc-muted">
            <span>{distLocal != null ? t('drv.away', { d: fmtDist(distLocal) }) : t('drv.gpsSearching')}</span>
            <span>{t('drv.unlocks', { m: radius })}</span>
          </div>
          <div className="relative h-14 overflow-hidden rounded-[14px] border border-cc-border bg-cc-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(near * 100)} aria-label={t('drv.arrived')}>
            <motion.div className="absolute inset-y-0 left-0 bg-cc-accent/20" initial={false} animate={{ width: `${near * 100}%` }} transition={SPRING_SOFT} />
            <span className="relative flex h-full items-center justify-center text-[17px] font-semibold tracking-wide text-cc-muted">{t('drv.arrived')}</span>
          </div>
        </>);
    } else if (trip.status === 'Arrived') action = (
      <DockButton tone="accent" loading={busy === 'Confirm arrival'} onClick={() => act('Confirm arrival', () => api.confirmArrival(trip.id))}>{t('drv.confirm')}</DockButton>);
    else if (trip.status === 'Delivered') action = (
      <>
        <p className="mb-2 text-center text-[12.5px] text-cc-muted">{t('drv.endHint')}</p>
        <DockButton tone="ink" loading={busy === 'End trip'} onClick={() => act('End trip', async () => { await api.endTrip(trip.id); uploader.current?.stop(); setFinished({ id: trip.id, place }); })}>{t('drv.end')}</DockButton>
      </>);
  }

  return (
    <div className="flex min-h-full flex-col bg-cc-bg">
      <header className="sticky top-0 z-sticky border-b border-cc-border bg-cc-bg/90 px-4 pb-2.5 pt-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Mark className="h-8 w-8 flex-shrink-0 text-cc-accent" />
            <div className="min-w-0 leading-tight"><p className="display truncate text-[17px]">{vehicle?.registration ?? 'JalSetu'}</p><p className="truncate text-[12px] text-cc-muted">{user.name}</p></div>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusPill ok={online} label={online ? t('drv.online') : t('drv.offline')} icon={online ? <ProvMark kind="live" /> : <WifiOff className="h-3.5 w-3.5" />} />
            {needGps && <StatusPill ok={!gpsError && fixAge != null && fixAge <= 30} warn={!gpsError && (fixAge == null || fixAge > 30)}
              label={gpsError ? t('drv.gpsError') : fix ? `±${Math.round(fix.accuracyM ?? 0)} m` : t('drv.gpsSearching')} icon={<Satellite className="h-3.5 w-3.5" />} />}
            <button onClick={() => setMenu(true)} className="flex h-10 w-10 items-center justify-center rounded-full text-cc-muted hover:bg-cc-hover" aria-label={t('drv.menu')}><DotsThree className="h-6 w-6" weight="bold" /></button>
          </div>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {(!online || loadError) && (
          <motion.div role="status" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }} className="overflow-hidden">
            <p className="mx-auto max-w-lg px-4 pt-3"><span className="flex items-start gap-2 rounded-[12px] bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900"><WifiOff className="mt-0.5 h-4 w-4 flex-shrink-0" />{t('drv.noConn')}</span></p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={cx('mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4', action ? 'pb-48' : 'pb-10')}>
        {!trip && finished ? (
          <motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_SHEET}
            className="rounded-[18px] border border-cc-live/40 bg-cc-live/[0.07] px-5 pb-6 pt-7 text-center">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: 0.12 }} className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cc-ok text-white">
              <CheckCircle2 className="h-9 w-9" weight="bold" /></motion.span>
            <p className="display mt-4 text-[26px]">{t('drv.task.ended')}</p>
            <p className="mono mt-1 text-[13px] text-cc-muted">{finished.id} · {finished.place}</p>
            <p className="mt-3 text-[14px] text-cc-muted">{t('drv.ended')}</p>
            <Button className="mt-5" size="lg" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { setFinished(null); load(); }}>{t('drv.refresh')}</Button>
          </motion.section>
        ) : !trip ? (
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT }}
            className="flex flex-col items-center px-4 pb-6 pt-14 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-cc-strong text-cc-faint"><Truck className="h-9 w-9" weight="light" /></span>
            <p className="display mt-5 text-[24px]">{t('drv.noTrip')}</p>
            <p className="mt-1.5 max-w-xs text-[14px] text-cc-muted">{t('drv.noTripBody')}</p>
            <Button className="mt-5" size="lg" icon={<RefreshCw className="h-4 w-4" />} onClick={load}>{t('drv.refresh')}</Button>
          </motion.section>
        ) : (
          <>
            <AnimatePresence mode="wait" initial={false}>
              <motion.section key={taskKey} aria-live="polite"
                initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -14, scale: 0.98 }} transition={SPRING_SHEET}
                className={cx('overflow-hidden rounded-[18px] border shadow-lift', taskKey === 'Arrived' || taskKey === 'Delivered' ? 'border-cc-live/40 bg-cc-live/[0.07]' : 'border-cc-border bg-cc-surface')}>
                <div className="px-5 pb-5 pt-4">
                  <p className="flex items-center justify-between text-[12.5px] text-cc-muted">
                    <span className="mono">{trip.id}</span>
                    {stop && <span>{t('drv.stopOf', { a: stop.seq, b: trip.stops.length })}</span>}
                  </p>
                  <h1 className="display mt-2 text-[28px] leading-[1.12]">
                    {taskKey === 'ended' ? t('drv.task.ended') : t(`drv.task.${taskKey}`, { p: place })}
                  </h1>
                  {stop && !ended && trip.status !== 'Delivered' && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-[14px] bg-cc-raised px-4 py-3">
                        <p className="text-[12px] text-cc-muted">{t('drv.distance')}</p>
                        <p className="mono mt-1 text-[26px] font-semibold leading-none">{fmtDist(distLocal)}</p>
                      </div>
                      <div className="rounded-[14px] bg-cc-raised px-4 py-3">
                        <p className="text-[12px] text-cc-muted">{t('drv.deliver')}</p>
                        <p className="mono mt-1 text-[26px] font-semibold leading-none">{stop.allocatedLitres.toLocaleString('en-IN')}<span className="ml-1 text-[14px] font-normal text-cc-faint">L</span></p>
                      </div>
                    </div>
                  )}
                  {(taskKey === 'Delivered' || taskKey === 'ended') && (
                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...SPRING, delay: 0.1 }}
                      className="mt-4 flex items-center gap-3 text-[14px] text-green-800"><CheckCircle2 className="h-8 w-8" weight="fill" />{ended ? t('drv.ended') : t('drv.say.delivered')}</motion.div>
                  )}
                  {stop && trip.status === 'En Route' && !ended && (
                    <a className="mt-4 flex h-12 items-center justify-center gap-2 rounded-[14px] border border-cc-border bg-cc-surface text-[15px] font-medium text-cc-accent-strong transition-colors active:bg-cc-hover"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`} target="_blank" rel="noreferrer">
                      <Navigation className="h-5 w-5" /> {t('drv.navigate')}
                    </a>
                  )}
                </div>
                <div className="border-t border-cc-border/70 px-5 pb-4 pt-4"><Journey status={trip.status} ended={ended} /></div>
              </motion.section>
            </AnimatePresence>

            {trip.status === 'Delivering' && stop && <DeliveryForm trip={trip} litres={stop.allocatedLitres} onDone={load} />}

            {needGps && <GpsPanel fix={fix} fixAge={fixAge} error={gpsError} upload={upload} active={telemetryActive} />}

            {trip.stops.length > 1 && (
              <section className="rounded-[16px] border border-cc-border bg-cc-surface p-4">
                <p className="mb-2 text-[13px] font-semibold">{t('drv.stops')}</p>
                <ol className="space-y-2">
                  {trip.stops.map(s => {
                    const done = s.status === 'Delivered' || s.status === 'Verified';
                    return (
                      <li key={s.id} className="flex items-center gap-3 text-[14px]">
                        <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold', done ? 'bg-cc-ok text-white' : s.id === stop?.id ? 'bg-cc-accent text-white' : 'bg-cc-hover text-cc-muted')}>
                          {done ? <CheckCircle2 className="h-4 w-4" weight="bold" /> : s.seq}</span>
                        <span className={cx('flex-1', done && 'text-cc-muted line-through decoration-cc-faint')}>{s.communityName}</span>
                        <span className="mono text-cc-muted">{s.allocatedLitres.toLocaleString('en-IN')} L</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {speechSupported && ['Assigned', 'Planned', 'Accepted', 'Arrived', 'Delivered'].includes(trip.status) && !ended && <VoiceCommand onHeard={runCommand} />}
          </>
        )}
      </main>

      <AnimatePresence>
        {action && (
          <motion.div key="dock" initial={{ y: 120 }} animate={{ y: 0 }} exit={{ y: 120 }} transition={SPRING_SHEET}
            className="fixed inset-x-0 bottom-0 z-sticky border-t border-cc-border bg-cc-bg/92 px-4 pt-3 backdrop-blur-xl"
            style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={taskKey} className="mx-auto max-w-lg" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: DUR.quick, ease: EASE_OUT }}>
                {action}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menu && (
          <div className="fixed inset-0 z-drawer" role="dialog" aria-modal="true" aria-label={t('drv.menu')}>
            <motion.button aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-cc-sunken/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={SPRING_SHEET}
              className="absolute inset-x-0 bottom-0 space-y-4 rounded-t-[22px] border-t border-cc-border bg-cc-surface px-5 pt-3 shadow-pop" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
              <span className="mx-auto block h-1 w-10 rounded-full bg-cc-border" aria-hidden />
              <div><p className="mb-2 text-[13px] font-medium text-cc-muted">{t('lang.label')}</p><LangSwitch /></div>
              {ttsSupported && (
                <button className="flex h-12 w-full items-center justify-between rounded-[12px] border border-cc-border px-4 text-[15px]" aria-pressed={speakOn}
                  onClick={() => { const v = !speakOn; setSpeakOn(v); try { localStorage.setItem(SPEAK_KEY, v ? 'on' : 'off'); } catch { /* ignore */ } }}>
                  <span className="flex items-center gap-2.5">{speakOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}{t('drv.speakUpdates')}</span>
                  <span className={cx('h-6 w-10 rounded-full p-0.5 transition-colors', speakOn ? 'bg-cc-accent' : 'bg-cc-hover')}><motion.span layout transition={SPRING} className={cx('block h-5 w-5 rounded-full bg-white shadow', speakOn && 'ml-auto')} /></span>
                </button>
              )}
              <Button size="lg" className="w-full" icon={<LogOut className="h-4 w-4" />} onClick={() => { watcher.current?.stop(); logout(); }}>{t('drv.signout')}</Button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DockButton: React.FC<{ tone: 'ink' | 'accent'; loading?: boolean; disabled?: boolean; onClick?: () => void; submit?: boolean; children: React.ReactNode }> = ({ tone, loading, disabled, onClick, submit, children }) => (
  <motion.button type={submit ? 'submit' : 'button'} onClick={onClick} disabled={disabled || loading} whileTap={{ scale: 0.97 }} transition={SPRING} aria-busy={loading || undefined}
    className={cx('flex h-14 w-full items-center justify-center gap-2 rounded-[14px] text-[17px] font-semibold tracking-wide shadow-lift transition-colors disabled:opacity-50',
      tone === 'accent' ? 'bg-cc-accent text-white' : 'bg-cc-ink text-cc-on-ink')}>
    {loading && <Loader2 className="h-5 w-5 animate-spin" />}{children}
  </motion.button>
);

const StatusPill: React.FC<{ ok: boolean; warn?: boolean; label: string; icon: React.ReactNode }> = ({ ok, warn, label, icon }) => (
  <span role="status" className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium',
    ok ? 'bg-cc-live/10 text-green-800' : warn ? 'bg-cc-warn/[0.12] text-amber-800' : 'bg-cc-danger/10 text-red-700')}>{icon}<span className="mono whitespace-nowrap">{label}</span></span>
);

const VoiceCommand: React.FC<{ onHeard: (t: string) => void }> = ({ onHeard }) => {
  const { t, lang } = useLang();
  const d = useDictation(speechLocale(lang), onHeard);
  return (
    <section className="flex items-center gap-3 rounded-[16px] border border-cc-border bg-cc-surface p-3">
      <motion.button type="button" onClick={d.listening ? d.stop : d.start} whileTap={{ scale: 0.92 }} aria-pressed={d.listening} aria-label={t('drv.voiceCmd')}
        className={cx('relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full', d.listening ? 'bg-cc-danger text-white' : 'bg-cc-ink text-cc-on-ink')}>
        {d.listening && <motion.span aria-hidden className="absolute inset-0 rounded-full bg-cc-danger" animate={{ scale: [1, 1.4], opacity: [0.45, 0] }} transition={{ duration: 1.1, repeat: Infinity }} />}
        <Mic className="relative h-6 w-6" />
      </motion.button>
      <div className="min-w-0" aria-live="polite">
        <p className="text-[15px] font-semibold">{t('drv.voiceCmd')}</p>
        <p className="text-[13px] text-cc-muted">{d.state === 'listening' ? t('voice.listening') : d.state === 'processing' ? t('voice.processing')
          : d.state === 'denied' ? t('voice.denied') : d.state === 'offline' ? t('voice.offline') : d.state === 'no_speech' ? t('voice.noSpeech') : t('drv.voiceHint')}</p>
        {d.interim && <p className="truncate text-[13px] italic text-cc-muted">“{d.interim}”</p>}
      </div>
    </section>
  );
};

const GpsPanel: React.FC<{ fix: Fix | null; fixAge: number | null; error: GpsError; upload: UploadStatus | null; active: boolean }> = ({ fix, fixAge, error, upload, active }) => {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const fresh = !error && fix && fixAge != null && fixAge <= 30;
  return (
    <section className={cx('rounded-[16px] border bg-cc-surface p-4', error ? 'border-cc-danger/40' : 'border-cc-border')}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-semibold"><Satellite className="h-4 w-4 text-cc-muted" /> {t('drv.gps')}
          <span className={cx('rounded-full px-2 py-0.5 text-[12px] font-medium', error ? 'bg-cc-danger/10 text-red-700' : fresh ? 'bg-cc-live/10 text-green-800' : 'bg-cc-warn/[0.12] text-amber-800')}>
            {error ? t('drv.gpsError') : fix ? (fresh ? t('drv.gpsOk') : t('drv.gpsOld')) : t('drv.gpsSearching')}</span></p>
        <button className="text-[13px] font-medium text-cc-accent" aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('drv.details')}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{geoErrorText(error)}</p>}
      {fix && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[11.5px] text-cc-muted">{t('drv.accuracy')}</p><p className="mono text-[16px] font-semibold">±{Math.round(fix.accuracyM ?? 0)} m</p></div>
          <div><p className="text-[11.5px] text-cc-muted">{t('drv.fixTime')}</p><p className="mono text-[16px] font-semibold">{t('drv.ago', { s: fixAge ?? 0 })}</p></div>
          <div><p className="text-[11.5px] text-cc-muted">{t('drv.buffered')}</p><p className="mono text-[16px] font-semibold">{active && upload ? upload.queued : 0}</p></div>
        </div>
      )}
      <p className="mt-3 flex items-center gap-2 text-[12.5px] text-cc-muted">
        {active ? <><ProvMark kind="live" />{t('drv.sending')}{upload?.lastSentAt && <> · {t('drv.lastSent')} <span className="mono">{new Date(upload.lastSentAt).toLocaleTimeString('en-IN')}</span></>}</> : t('drv.notSending')}
      </p>
      {active && upload && !upload.online && <p className="mt-1 text-[12.5px] text-amber-800">{t('drv.noConn')}</p>}
      {active && upload?.error && <p className="mt-1 text-[12.5px] text-amber-800">{upload.error}</p>}
      <AnimatePresence initial={false}>
        {open && fix && (
          <motion.dl initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}
            className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 overflow-hidden border-t border-cc-border pt-3 text-[13px]">
            <dt className="text-cc-muted">{t('drv.position')}</dt><dd className="mono text-right">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</dd>
            <dt className="text-cc-muted">{t('drv.fixTime')}</dt><dd className="mono text-right">{new Date(fix.deviceTime).toLocaleTimeString('en-IN')}</dd>
            {fix.speedKmh != null && <><dt className="text-cc-muted">km/h</dt><dd className="mono text-right">{fix.speedKmh}</dd></>}
          </motion.dl>
        )}
      </AnimatePresence>
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
    <div className="relative mx-2" aria-label={t(`drv.step.${STEPS[idx]}`)}>
      <div className="absolute left-0 right-0 top-[11px] h-[3px] rounded-full bg-cc-hover" />
      <motion.div className="absolute left-0 top-[11px] h-[3px] rounded-full bg-cc-accent" initial={false} animate={{ width: `${pct}%` }} transition={SPRING_SOFT} />
      <ol className="relative flex justify-between">
        {STEPS.map((s, i) => {
          const done = i < idx || ended, here = i === idx && !ended;
          return (
            <li key={s} className="flex w-0 flex-col items-center">
              <motion.span initial={false} animate={{ scale: here ? 1.18 : 1 }} transition={SPRING}
                className={cx('flex h-[24px] w-[24px] items-center justify-center rounded-full border-2 text-[11px] font-semibold',
                  done ? 'border-cc-accent bg-cc-accent text-white' : here ? 'border-cc-accent bg-cc-surface text-cc-accent shadow-[0_0_0_5px_rgb(var(--cc-accent)/0.14)]' : 'border-cc-border bg-cc-surface text-cc-faint')}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" weight="bold" /> : i + 1}
              </motion.span>
              <span className={cx('mt-1.5 whitespace-nowrap text-[11px]', here ? 'font-semibold text-cc-text' : 'text-cc-muted', !here && 'hidden min-[400px]:inline')}>{t(`drv.step.${s}`)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

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
    <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SHEET} className="space-y-4 rounded-[18px] border border-cc-accent/40 bg-cc-surface p-5 shadow-lift">
      <p className="display text-[20px]">{t('drv.record')}</p>
      <label className="block"><span className="label">{t('drv.litres')}</span>
        <input className="input mono h-14 text-[22px] font-semibold" type="number" inputMode="numeric" min={0} max={60000} step={100} value={amount} onChange={e => setAmount(Number(e.target.value))} required />
      </label>
      <label className="block"><span className="label">{t('drv.receiver')}</span>
        <input className="input h-12 text-[15px]" value={receiver} onChange={e => setReceiver(e.target.value)} required minLength={2} autoComplete="name" />
      </label>
      <label className="block"><span className="label">{t('drv.receiverPhone')}</span>
        <input className="input h-12 text-[15px]" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      </label>
      <SignaturePad onChange={setSig} />
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cc-strong px-3 py-3 text-sm text-cc-muted">
        <Camera className="h-5 w-5" aria-hidden />{photo ? photo.name : t('drv.photo')}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={e => setPhoto(e.target.files?.[0] || null)} />
      </label>
      <input className="input h-12 text-[15px]" placeholder={t('drv.notes')} value={notes} onChange={e => setNotes(e.target.value)} />
      
      <DockButton tone="accent" loading={busy} submit>{t('drv.deliveryDone')}</DockButton>
    </motion.form>
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
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--cc-text').trim().replace(/\s+/g, ',');
    ctx.strokeStyle = ink ? `rgb(${ink})` : '#0c1822'; ctx.lineWidth = 3; ctx.lineCap = 'round';
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

