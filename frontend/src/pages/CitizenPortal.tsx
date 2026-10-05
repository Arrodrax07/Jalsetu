/**
 * Public portal (no login): ask for water, report a problem, see when water is coming, check a request or complaint.
 * English / मराठी / हिंदी, voice dictation, works offline (requests and complaints wait in an on-device outbox).
 * A water request shows the resident why it has its priority (the same factors staff see) and its place in line.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CloudOff, Droplets, HandTap, Loader2, LocateFixed, MapPin, MessageSquareWarning, Minus, Plus, Search, Send, Ticket, Truck } from '../components/icons';
import { api, ApiError, type PublicRequestStatus } from '../services/api';
import { Button, cx, EASE, ErrorBox, SPRING } from '../components/ui';
import { Mark } from '../components/shell/Shell';
import { districtName } from '../utils/format';
import { LangProvider, useLang, type Lang } from '../i18n';
import { enqueue, newClientRef, recordTicket, useOnline, useOutbox } from '../citizen/outbox';
import { InstallButton, LangSwitch, OfflineBanner, OutboxPanel, ReadAloud, SentToast, VoiceButton } from '../citizen/widgets';
import type { PublicSupply } from '../types';

type Place = { id: string; name: string; ward: string; lat: number; lng: number };
type Tab = 'request' | 'report' | 'water' | 'track';

const PLACES_KEY = 'jalsetu_places_v1';
const PLACE_KEY = 'jalsetu_my_place_v1';

const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

function loadJSON<T>(key: string): T | null { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : null; } catch { return null; } }
function saveJSON(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

/** Places list: network first, the copy kept on the device when offline. */
function usePlaces() {
  const [places, setPlaces] = useState<Place[]>(() => loadJSON<Place[]>(PLACES_KEY) || []);
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.publicCommunities().then(p => { setPlaces(p); saveJSON(PLACES_KEY, p); setFromCache(false); })
      .catch(e => { if (loadJSON<Place[]>(PLACES_KEY)?.length) setFromCache(true); else setErr(e.message); });
  }, []);
  return { places, fromCache, err };
}

/** Remembers the resident's place across visits and tabs (on this device only). */
function useMyPlace(): [Place | null, (p: Place | null) => void] {
  const [p, setP] = useState<Place | null>(() => loadJSON<Place>(PLACE_KEY));
  return [p, (v: Place | null) => { setP(v); if (v) saveJSON(PLACE_KEY, v); }];
}

/** Type-ahead place picker with voice search and "use my location" (computed on the device; never sent). */
const PlacePicker: React.FC<{ places: Place[]; value: Place | null; onChange: (p: Place | null) => void; fromCache?: boolean }> = ({ places, value, onChange, fromCache }) => {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [near, setNear] = useState<(Place & { km: number })[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return places.filter(p => p.name.toLowerCase().includes(n) || districtName(p.ward).toLowerCase().includes(n))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(n)) - Number(!b.name.toLowerCase().startsWith(n))).slice(0, 8);
  }, [q, places]);
  useEffect(() => setActive(0), [q]);
  const locate = () => {
    if (!navigator.geolocation) { setLocErr(t('place.failed')); return; }
    setLocating(true); setLocErr(null);
    navigator.geolocation.getCurrentPosition(pos => {
      const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const ranked = places.map(p => ({ ...p, km: distKm(me, p) })).sort((a, b) => a.km - b.km).slice(0, 4);
      setNear(ranked);
      if (ranked[0]) onChange(ranked[0]);
      setLocating(false);
    }, err => { setLocErr(err.code === 1 ? t('place.denied') : t('place.failed')); setLocating(false); },
    { enableHighAccuracy: true, timeout: 12000 });
  };
  const pick = (p: Place) => { onChange(p); setQ(''); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(matches.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]); }
  };
  return (
    <div ref={box} className="space-y-2">
      <AnimatePresence mode="wait" initial={false}>
        {value ? (
          <motion.div key={value.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="flex items-center gap-3 rounded-2xl border border-cc-accent/30 bg-cc-accent/[0.05] p-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cc-accent text-white"><MapPin className="h-5 w-5" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{value.name}</span><span className="block text-xs text-cc-muted">{districtName(value.ward)} {t('place.district')}</span></span>
            <button type="button" className="min-h-[40px] px-2 text-sm font-medium text-cc-accent-strong underline underline-offset-4" onClick={() => { onChange(null); setOpen(true); }}>{t('place.change')}</button>
          </motion.div>
        ) : (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" aria-hidden />
              <input className="input py-3 pl-10 text-[15px]" placeholder={t('place.search')} value={q} onFocus={() => setOpen(true)} onKeyDown={onKey}
                onChange={e => { setQ(e.target.value); setOpen(true); }} aria-label={t('place.search')} role="combobox" aria-expanded={open && matches.length > 0}
                aria-controls="place-list" aria-activedescendant={matches[active] ? `place-${matches[active].id}` : undefined} autoComplete="off" />
              <AnimatePresence>
                {open && matches.length > 0 && (
                  <motion.ul id="place-list" role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
                    className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-cc-border bg-cc-surface p-1 shadow-pop">
                    {matches.map((p, i) => (
                      <li key={p.id} id={`place-${p.id}`} role="option" aria-selected={i === active}>
                        <button type="button" onClick={() => pick(p)} onMouseEnter={() => setActive(i)}
                          className={cx('flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-left text-[15px]', i === active && 'bg-cc-hover')}>
                          <span>{p.name}</span><span className="text-xs text-cc-muted">{districtName(p.ward)}</span></button></li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
            <VoiceButton compact onText={txt => { setQ(txt); setOpen(true); }} label={t('place.search')} />
          </motion.div>
        )}
      </AnimatePresence>
      {!value && (
        <button type="button" onClick={locate} className="flex min-h-[40px] items-center gap-2 text-sm font-medium text-cc-accent-strong">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />} {t('place.useLocation')}
        </button>
      )}
      {near.length > 1 && value && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-cc-muted">{t('place.nearby')}:</span>
          {near.map(n => (
            <button type="button" key={n.id} onClick={() => onChange(n)} className={cx('min-h-[32px] rounded-full px-2.5 ring-1', n.id === value.id ? 'bg-cc-ink text-cc-on-ink ring-cc-ink' : 'ring-cc-border hover:ring-cc-strong')}>
              {n.name} · {n.km < 1 ? '<1' : n.km.toFixed(0)} km</button>
          ))}
        </div>
      )}
      {fromCache && <p className="text-xs text-cc-muted">{t('place.offlineList')}</p>}
      {locErr && <p role="alert" className="text-xs text-amber-800">{locErr}</p>}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ report
type Result = { kind: 'sent'; id: string; message: string } | { kind: 'queued' };

const Report: React.FC<{ places: Place[]; fromCache: boolean; place: Place | null; setPlace: (p: Place | null) => void; online: boolean }> =
  ({ places, fromCache, place, setPlace, online }) => {
    const { t, lang } = useLang();
    const [text, setText] = useState('');
    const [voiceUsed, setVoiceUsed] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [result, setResult] = useState<Result | null>(null);
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!place) { setErr(t('report.chooseFirst')); return; }
      setBusy(true); setErr(null);
      const payload = { communityId: place.id, description: text.trim(), reporterName: name, reporterPhone: phone, language: lang as Lang,
        inputMode: (voiceUsed ? 'voice' : 'typed') as 'voice' | 'typed', clientRef: newClientRef() };
      if (!navigator.onLine) { enqueue(payload, place.name); setResult({ kind: 'queued' }); setBusy(false); return; }
      try {
        const r = await api.publicComplaint(payload);
        recordTicket({ id: r.id, placeName: place.name, sentAt: new Date().toISOString(), queuedAt: null, viaOutbox: false });
        setResult({ kind: 'sent', id: r.id, message: r.message });
      } catch (x) {
        if (x instanceof ApiError && (x.status === 0 || x.status >= 500)) { enqueue(payload, place.name); setResult({ kind: 'queued' }); }
        else setErr(x instanceof Error ? x.message : String(x));
      }
      setBusy(false);
    };
    const reset = () => { setResult(null); setText(''); setVoiceUsed(false); };
    return (
      <AnimatePresence mode="wait">
        {result ? (
          <motion.div key="done" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}
            className="panel overflow-hidden text-center" role="status">
            <div className={cx('px-6 pb-6 pt-8', result.kind === 'sent' ? 'bg-cc-ok/[0.07]' : 'bg-amber-50')}>
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: 0.12 }}
                className={cx('mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white', result.kind === 'sent' ? 'bg-cc-ok' : 'bg-amber-600')}>
                {result.kind === 'sent' ? <CheckCircle2 className="h-7 w-7" aria-hidden /> : <CloudOff className="h-7 w-7" aria-hidden />}
              </motion.span>
              <p className="eyebrow mt-4">{result.kind === 'sent' ? t('report.done') : t('report.queued')}</p>
              {result.kind === 'sent' && (
                <button type="button" onClick={() => navigator.clipboard?.writeText(result.id).catch(() => undefined)} title="Copy"
                  className="mono mx-auto mt-2 block rounded-[14px] border border-dashed border-cc-ok/50 px-5 py-2 text-[34px] font-semibold tracking-wide">{result.id}</button>
              )}
            </div>
            <div className="space-y-3 p-6">
              <p className="text-[15px] leading-relaxed text-cc-muted">{result.kind === 'sent' ? t('report.keep') : t('report.queuedBody')}</p>
              <Button variant="secondary" size="lg" onClick={reset}>{t('report.another')}</Button>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease: EASE }}
            className="panel space-y-6 p-5 sm:p-6">
            <fieldset><legend className="mb-2 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">1</span>{t('report.step1')}</legend>
              <PlacePicker places={places} value={place} onChange={setPlace} fromCache={fromCache} /></fieldset>
            <fieldset><legend className="mb-1 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">2</span>{t('report.step2')}</legend>
              <p className="mb-2 text-[13px] text-cc-muted">{t('report.step2hint')}</p>
              <textarea className="input text-[15px]" rows={5} required minLength={5} maxLength={3000} value={text} lang={lang}
                onChange={e => setText(e.target.value)} placeholder={t('report.placeholder')} aria-label={t('report.step2')} />
              <div className="mt-2"><VoiceButton onText={txt => { setText(v => (v.trim() ? `${v.trim()} ${txt}` : txt)); setVoiceUsed(true); }} /></div>
            </fieldset>
            <fieldset><legend className="mb-2 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">3</span>{t('report.step3')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className="input py-3" placeholder={t('report.name')} aria-label={t('report.name')} value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" />
                <input className="input py-3" type="tel" inputMode="tel" placeholder={t('report.phone')} aria-label={t('report.phone')} value={phone} onChange={e => setPhone(e.target.value)} maxLength={32} autoComplete="tel" />
              </div>
            </fieldset>
            {err && <ErrorBox message={err} />}
            <Button type="submit" variant="primary" size="lg" className="w-full min-h-[52px]" loading={busy} disabled={!place || text.trim().length < 5}
              icon={online ? <Send className="h-4 w-4" aria-hidden /> : <CloudOff className="h-4 w-4" aria-hidden />}>
              {online ? t('report.submit') : t('report.saveOffline')}
            </Button>
            <p className="text-center text-[12px] leading-relaxed text-cc-faint">{t('report.privacy')}</p>
          </motion.form>
        )}
      </AnimatePresence>
    );
  };

// ------------------------------------------------------------------------------------------------ request water
/** Why a request has its priority: each factor's share of the score, in the resident's language. */
const WhyPriority: React.FC<{ r: PublicRequestStatus }> = ({ r }) => {
  const { t } = useLang();
  const shown = r.factors.filter(f => f.points >= 0.5);
  const max = Math.max(1, ...shown.map(f => f.points));
  return (
    <section className="space-y-3 text-left" aria-label={t('why.title')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold">{t('why.title')}</p>
        <p className="text-sm"><span className="num font-semibold">{t('why.score', { n: r.priorityScore })}</span>
          <span className={cx('ml-2 rounded-full px-2 py-0.5 text-xs font-semibold', r.urgency === 'Critical' ? 'bg-rose-100 text-rose-800' : r.urgency === 'High' ? 'bg-amber-100 text-amber-800' : 'bg-cc-hover text-cc-muted')}>
            {t(`urgency.${r.urgency}`)}</span></p>
      </div>
      <ul className="space-y-2.5">
        {shown.map((f, i) => (
          <li key={f.key}>
            <div className="flex items-baseline justify-between gap-3 text-[13.5px]"><span>{t(`factor.${f.key}`)}</span>
              <span className="num whitespace-nowrap text-xs text-cc-muted">{t('why.points', { n: f.points })}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-cc-hover">
              <motion.div className="h-full rounded-full bg-cc-accent" initial={{ width: 0 }} animate={{ width: `${(100 * f.points) / max}%` }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.05 * i }} /></div>
          </li>
        ))}
      </ul>
      {r.queue && <p className="num text-sm font-medium">{t('why.queue', { n: r.queue.position, total: r.queue.waiting })}</p>}
      <p className="text-[12.5px] leading-relaxed text-cc-faint">{t('why.note')}</p>
    </section>
  );
};

const REQUEST_STEPS = ['Pending', 'Allocated', 'Dispatched', 'Delivered'] as const;

const RequestProgress: React.FC<{ r: PublicRequestStatus }> = ({ r }) => {
  const { t } = useLang();
  const at = REQUEST_STEPS.indexOf(r.progress as typeof REQUEST_STEPS[number]);
  if (r.progress === 'Rejected') return <p className="text-sm font-medium text-amber-800">{t('rstatus.Rejected')}</p>;
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {REQUEST_STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1.5"><span className={cx('h-1.5 rounded-full', i <= at ? 'bg-cc-accent' : 'bg-cc-hover')} />
          <span className={cx('text-xs leading-tight', i <= at ? 'font-medium text-cc-text' : 'text-cc-faint')}>{t(`rstatus.${s}`)}</span></li>
      ))}
    </ol>
  );
};

const PEOPLE_MAX = 5000;
const Stepper: React.FC<{ value: number; onChange: (n: number) => void; min: number; max: number; label: string }> = ({ value, onChange, min, max, label }) => (
  <div className="flex items-center gap-2">
    <button type="button" aria-label={`${label} −`} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
      className="flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-cc-border disabled:opacity-40"><Minus className="h-5 w-5" aria-hidden /></button>
    <input className="input num h-12 w-24 text-center text-lg font-semibold" type="number" inputMode="numeric" min={min} max={max} aria-label={label}
      value={value} onChange={e => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))))} />
    <button type="button" aria-label={`${label} +`} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
      className="flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-cc-border disabled:opacity-40"><Plus className="h-5 w-5" aria-hidden /></button>
  </div>
);

const REASONS = ['req.r.well', 'req.r.tap', 'req.r.tanker', 'req.r.unsafe'];
type RequestResult = { kind: 'sent'; r: PublicRequestStatus } | { kind: 'queued' };

const RequestWater: React.FC<{ places: Place[]; fromCache: boolean; place: Place | null; setPlace: (p: Place | null) => void; online: boolean }> =
  ({ places, fromCache, place, setPlace, online }) => {
    const { t, lang } = useLang();
    const [people, setPeople] = useState(5);
    const [days, setDays] = useState(1);
    const [text, setText] = useState('');
    const [voiceUsed, setVoiceUsed] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [result, setResult] = useState<RequestResult | null>(null);
    const ready = !!place && text.trim().length >= 3 && name.trim().length >= 2 && phone.trim().length >= 6;
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!place) { setErr(t('report.chooseFirst')); return; }
      setBusy(true); setErr(null);
      const payload = { communityId: place.id, peopleAffected: people, daysWithoutWater: days, reason: text.trim(), contactPerson: name.trim(),
        phone: phone.trim(), language: lang as Lang, inputMode: (voiceUsed ? 'voice' : 'typed') as 'voice' | 'typed', clientRef: newClientRef() };
      if (!navigator.onLine) { enqueue(payload, place.name, 'request'); setResult({ kind: 'queued' }); setBusy(false); return; }
      try {
        const r = await api.publicRequest(payload);
        recordTicket({ id: r.id, placeName: place.name, sentAt: new Date().toISOString(), queuedAt: null, viaOutbox: false });
        setResult({ kind: 'sent', r });
      } catch (x) {
        if (x instanceof ApiError && (x.status === 0 || x.status >= 500)) { enqueue(payload, place.name, 'request'); setResult({ kind: 'queued' }); }
        else setErr(x instanceof Error ? x.message : String(x));
      }
      setBusy(false);
    };
    const reset = () => { setResult(null); setText(''); setVoiceUsed(false); };
    return (
      <AnimatePresence mode="wait">
        {result ? (
          <motion.div key="done" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}
            className="panel overflow-hidden text-center" role="status">
            <div className={cx('px-6 pb-6 pt-8', result.kind === 'sent' ? 'bg-cc-ok/[0.07]' : 'bg-amber-50')}>
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: 0.12 }}
                className={cx('mx-auto flex h-14 w-14 items-center justify-center rounded-full text-white', result.kind === 'sent' ? 'bg-cc-ok' : 'bg-amber-600')}>
                {result.kind === 'sent' ? <CheckCircle2 className="h-7 w-7" aria-hidden /> : <CloudOff className="h-7 w-7" aria-hidden />}
              </motion.span>
              <p className="eyebrow mt-4">{result.kind === 'sent' ? t('req.done') : t('report.queued')}</p>
              {result.kind === 'sent' && (
                <button type="button" onClick={() => navigator.clipboard?.writeText(result.r.id).catch(() => undefined)} title="Copy"
                  className="mono mx-auto mt-2 block rounded-[14px] border border-dashed border-cc-ok/50 px-5 py-2 text-[34px] font-semibold tracking-wide">{result.r.id}</button>
              )}
            </div>
            <div className="space-y-4 p-6">
              {result.kind === 'sent' ? (
                <>
                  <p className="text-[15px] leading-relaxed text-cc-muted">{t('req.keep')}</p>
                  {result.r.mergedInto && <p className="rounded-2xl bg-cc-accent/[0.06] px-4 py-3 text-left text-[14px] leading-relaxed">{t('req.merged', { place: result.r.community, id: result.r.mergedInto })}</p>}
                  <RequestProgress r={result.r} />
                  <div className="border-t border-cc-border pt-4"><WhyPriority r={result.r} /></div>
                </>
              ) : <p className="text-[15px] leading-relaxed text-cc-muted">{t('req.queuedBody')}</p>}
              <Button variant="secondary" size="lg" onClick={reset}>{t('req.another')}</Button>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease: EASE }}
            className="panel space-y-6 p-5 sm:p-6">
            <fieldset><legend className="mb-2 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">1</span>{t('report.step1')}</legend>
              <PlacePicker places={places} value={place} onChange={setPlace} fromCache={fromCache} /></fieldset>
            <fieldset className="space-y-5">
              <div><p className="mb-1 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">2</span>{t('req.people')}</p>
                <p className="mb-2 text-[13px] text-cc-muted">{t('req.peopleHint')}</p>
                <Stepper value={people} onChange={setPeople} min={1} max={PEOPLE_MAX} label={t('req.people')} /></div>
              <div><p className="mb-1 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">3</span>{t('req.days')}</p>
                <div className="mb-2" />
                <Stepper value={days} onChange={setDays} min={0} max={60} label={t('req.days')} /></div>
            </fieldset>
            <fieldset><legend className="mb-1 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">4</span>{t('req.why')}</legend>
              <p className="mb-2 text-[13px] text-cc-muted">{t('req.whyHint')}</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {REASONS.map(k => {
                  const label = t(k);
                  const on = text.includes(label);
                  return <button key={k} type="button" aria-pressed={on} onClick={() => setText(v => (on ? v.replace(label, '').replace(/\s*\.\s*\./g, '.').trim() : v.trim() ? `${v.trim()}. ${label}` : label))}
                    className={cx('min-h-[38px] rounded-full px-3 text-[13px] ring-1 transition-colors', on ? 'bg-cc-ink text-cc-on-ink ring-cc-ink' : 'ring-cc-border hover:ring-cc-strong')}>{label}</button>;
                })}
              </div>
              <textarea className="input text-[15px]" rows={3} required minLength={3} maxLength={2000} value={text} lang={lang}
                onChange={e => setText(e.target.value)} aria-label={t('req.why')} />
              <div className="mt-2"><VoiceButton onText={txt => { setText(v => (v.trim() ? `${v.trim()} ${txt}` : txt)); setVoiceUsed(true); }} /></div>
            </fieldset>
            <fieldset><legend className="mb-2 text-[15px] font-semibold"><span className="num mr-2 text-cc-faint">5</span>{t('req.contact')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className="input py-3" required minLength={2} placeholder={t('report.name')} aria-label={t('report.name')} value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" />
                <input className="input py-3" required minLength={6} type="tel" inputMode="tel" placeholder={t('report.phone')} aria-label={t('report.phone')} value={phone} onChange={e => setPhone(e.target.value)} maxLength={32} autoComplete="tel" />
              </div>
            </fieldset>
            {err && <ErrorBox message={err} />}
            <Button type="submit" variant="primary" size="lg" className="w-full min-h-[52px]" loading={busy} disabled={!ready}
              icon={online ? <Send className="h-4 w-4" aria-hidden /> : <CloudOff className="h-4 w-4" aria-hidden />}>
              {online ? t('req.submit') : t('report.saveOffline')}
            </Button>
            <p className="text-center text-[12px] leading-relaxed text-cc-faint">{t('req.privacy')}</p>
          </motion.form>
        )}
      </AnimatePresence>
    );
  };

// ------------------------------------------------------------------------------------------------ water schedule
const SUPPLY_KEY = (id: string) => `jalsetu_supply_${id}`;
const fmtTime = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
/** ISO weekdays (1 = Monday) in the resident's language; "every day" when all seven. */
const dayNames = (days: number[], lang: Lang) => {
  const loc = lang === 'en' ? 'en-IN' : `${lang}-IN`;
  if (days.length === 7) return ({ en: 'Every day', mr: 'दररोज', hi: 'रोज़' } as const)[lang];
  return days.map(d => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(loc, { weekday: 'short', timeZone: 'UTC' })).join(', ');
};
const fmtClock = (iso: string, lang: Lang) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const WaterInfo: React.FC<{ places: Place[]; fromCache: boolean; place: Place | null; setPlace: (p: Place | null) => void }> = ({ places, fromCache, place, setPlace }) => {
  const { t, lang } = useLang();
  const [data, setData] = useState<PublicSupply | null>(null);
  const [stale, setStale] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [index, setIndex] = useState<{ id: string; name: string; ward: string; schedules: number; hasNotice: boolean }[]>([]);
  useEffect(() => { api.publicScheduleIndex().then(setIndex).catch(() => {}); }, []);
  useEffect(() => {
    if (!place) { setData(null); return; }
    setErr(null);
    const cached = loadJSON<PublicSupply>(SUPPLY_KEY(place.id));
    if (cached) { setData(cached); setStale(true); }
    api.publicSupply(place.id).then(d => { setData(d); setStale(false); saveJSON(SUPPLY_KEY(place.id), d); })
      .catch(e => { if (!cached) setErr(e.message); });
  }, [place]);
  const next = data?.nextSupply?.next;
  const summary = data ? [
    next ? (next.running ? `${t('water.now')} ${t('water.until')} ${fmtClock(next.endsAt, lang)}` : `${t('water.next')}: ${fmtTime(next.startsAt, lang)}`) : t('water.noSchedule'),
    data.tanker ? t(`water.tanker.${data.tanker.stage}`) : '',
  ].filter(Boolean).join('. ') : '';
  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-5">
        <p className="text-[15px] font-semibold">{t('water.pick')}</p>
        <PlacePicker places={places} value={place} onChange={setPlace} fromCache={fromCache} />
        {!place && index.length > 0 && (
          <div className="pt-1"><p className="mb-1.5 text-xs text-cc-muted">{t('water.published')}</p>
            <div className="flex flex-wrap gap-1.5">{index.slice(0, 12).map(p => (
              <button key={p.id} type="button" onClick={() => setPlace(places.find(x => x.id === p.id) || { id: p.id, name: p.name, ward: p.ward, lat: 0, lng: 0 })}
                className="min-h-[34px] rounded-full px-3 text-[13px] ring-1 ring-cc-border hover:ring-cc-strong">{p.name}</button>))}</div></div>
        )}
      </section>
      {err && <ErrorBox message={err} />}
      <AnimatePresence mode="wait">
        {data && place && (
          <motion.div key={data.community.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="space-y-4">
            {stale && <p className="flex items-center gap-2 text-xs text-amber-800"><CloudOff className="h-3.5 w-3.5" aria-hidden />{t('water.offlineCopy')}</p>}
            <section className={cx('panel overflow-hidden', next?.running && 'border-cc-accent/40')}>
              <div className={cx('px-5 py-6', next?.running ? 'bg-cc-accent text-white' : 'bg-cc-raised')}>
                <p className={cx('eyebrow', next?.running && '!text-white/80')}>{data.community.name}{data.community.district && districtName(data.community.district) !== data.community.name ? ` · ${districtName(data.community.district)}` : ''}</p>
                {next ? (
                  <>
                    <p className="display mt-2 text-[34px] leading-tight sm:text-[40px]">{next.running ? t('water.now') : fmtTime(next.startsAt, lang)}</p>
                    <p className={cx('mt-1 text-[15px]', next.running ? 'text-white/90' : 'text-cc-muted')}>
                      {next.running ? `${t('water.until')} ${fmtClock(next.endsAt, lang)}` : `${fmtClock(next.startsAt, lang)} – ${fmtClock(next.endsAt, lang)}`} · {data.nextSupply!.pointName}</p>
                  </>
                ) : <p className="mt-2 text-[15px] text-cc-muted">{t('water.noSchedule')}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><ReadAloud text={summary} /></div>
            </section>

            {data.notices.length > 0 && (
              <section className="space-y-2" aria-label={t('water.notices')}>
                {data.notices.map(n => (
                  <div key={n.id} className={cx('rounded-2xl border px-4 py-3', n.kind === 'interruption' || n.kind === 'quality' ? 'border-amber-300/70 bg-amber-50 text-amber-950' : 'border-cc-accent/25 bg-cc-accent/[0.05]')}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{t(`notice.${n.kind}`)}</p>
                    <p className="mt-0.5 text-[15px] leading-snug">{n.message}</p>
                    <p className="mt-1 text-xs opacity-70">{fmtTime(n.startsAt, lang)}{n.endsAt ? ` → ${fmtTime(n.endsAt, lang)}` : ''}</p>
                  </div>
                ))}
              </section>
            )}

            <section className="panel divide-y divide-cc-border">
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cc-hover text-cc-muted"><Truck className="h-5 w-5" aria-hidden /></span>
                <div><p className="text-xs text-cc-muted">{t('water.tanker')}</p><p className="text-[15px] font-medium">{data.tanker ? t(`water.tanker.${data.tanker.stage}`) : t('water.noTanker')}</p></div>
              </div>
              {data.lastDelivery && (
                <div className="flex items-center gap-3 px-5 py-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cc-hover text-cc-muted"><Droplets className="h-5 w-5" aria-hidden /></span>
                  <div><p className="text-xs text-cc-muted">{t('water.lastDelivery')}</p><p className="text-[15px] font-medium">{fmtTime(data.lastDelivery.at, lang)} · <span className="num">{data.lastDelivery.litres.toLocaleString('en-IN')} L</span></p></div>
                </div>
              )}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between text-xs text-cc-muted"><span>{t('water.coverage')}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-800" title={data.coverageBasis}>{t('water.estimate')}</span></div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-cc-hover"><motion.div className="h-full rounded-full bg-cc-accent" initial={{ width: 0 }} animate={{ width: `${data.estimatedCoveragePct}%` }} transition={{ duration: 0.9, ease: EASE }} /></div>
                <p className="num mt-1 text-sm font-medium">{data.estimatedCoveragePct}%</p>
              </div>
            </section>

            {data.schedules.length > 0 && (
              <section className="panel p-5">
                <p className="mb-3 text-[15px] font-semibold">{t('water.allTimings')}</p>
                <ul className="space-y-3">{data.schedules.map(s => (
                  <li key={s.id} className="flex items-start justify-between gap-3 border-b border-dashed border-cc-border pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0"><p className="text-[15px] font-medium">{s.pointName}</p><p className="text-xs text-cc-muted">{t(`kind.${s.kind}`)} · {dayNames(s.days, lang)}</p>{s.notes && <p className="mt-0.5 text-xs text-cc-muted">{s.notes}</p>}</div>
                    <p className="num whitespace-nowrap text-[15px] font-semibold">{s.startTime}–{s.endTime}</p>
                  </li>))}</ul>
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ track
const Track: React.FC<{ tickets: { id: string; placeName: string; sentAt: string }[] }> = ({ tickets }) => {
  const { t, lang } = useLang();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ id: string; status: string; category: string; community: string; submittedAt: string; resolvedAt: string | null } | null>(null);
  const [req, setReq] = useState<PublicRequestStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async (c: string) => {
    setBusy(true); setErr(null); setRes(null); setReq(null);
    const code = c.trim().toUpperCase();
    try {
      if (code.startsWith('WR')) setReq(await api.publicRequestStatus(code));
      else setRes(await api.publicTicket(code));
    } catch (e) { setErr(e instanceof ApiError && e.status === 404 ? t('track.notFound') : (e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <form className="panel flex gap-2 p-4" onSubmit={e => { e.preventDefault(); check(code); }}>
        <input className="input flex-1 py-3 text-[15px] uppercase" placeholder={t('track.placeholder')} aria-label={t('track.placeholder')} value={code} onChange={e => setCode(e.target.value)} />
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.trim().length < 3}>{t('track.go')}</Button>
      </form>
      {err && <ErrorBox message={err} />}
      <AnimatePresence>{req && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel space-y-4 p-5">
          <div><p className="eyebrow">{req.community}</p><p className="display mt-1 text-4xl">{req.id}</p>
            <p className="mt-1 text-[13px] text-cc-muted">{fmtTime(req.submittedAt, lang)}</p></div>
          {req.mergedInto && <p className="rounded-2xl bg-cc-accent/[0.06] px-4 py-3 text-[14px] leading-relaxed">{t('req.merged', { place: req.community, id: req.mergedInto })}</p>}
          <RequestProgress r={req} />
          {req.placeCoveragePct != null && <p className="text-[13px] text-cc-muted">{t('rstatus.coverage', { place: req.community, n: req.placeCoveragePct })} <span className="rounded-full bg-amber-100 px-1.5 text-[10.5px] font-semibold uppercase text-amber-800">{t('water.estimate')}</span></p>}
          <div className="border-t border-cc-border pt-4"><WhyPriority r={req} /></div>
        </motion.section>
      )}</AnimatePresence>
      <AnimatePresence>{res && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel p-5">
          <p className="eyebrow">{res.community}</p>
          <p className="display mt-1 text-4xl">{res.id}</p>
          <ol className="mt-4 flex items-center gap-2" aria-label="Progress">
            {['Pending', 'Assigned', 'Resolved'].map((s, i) => {
              const reached = res.status === 'Resolved' || (res.status === 'Assigned' && i <= 1) || (res.status === 'Escalated' && i <= 1) || i === 0;
              return <li key={s} className="flex flex-1 flex-col gap-1.5"><span className={cx('h-1.5 rounded-full', reached ? 'bg-cc-accent' : 'bg-cc-hover')} />
                <span className={cx('text-xs', reached ? 'font-medium text-cc-text' : 'text-cc-faint')}>{t(`status.${i === 1 && res.status === 'Escalated' ? 'Escalated' : s}`)}</span></li>;
            })}
          </ol>
          <p className="mt-3 text-[13px] text-cc-muted">{res.category} · {fmtTime(res.submittedAt, lang)}</p>
        </motion.section>
      )}</AnimatePresence>
      {tickets.length > 0 && (
        <section className="panel p-5"><p className="mb-2 text-[15px] font-semibold">{t('track.mine')}</p>
          <ul className="divide-y divide-cc-border">{tickets.map(tk => (
            <li key={tk.id}><button type="button" onClick={() => { setCode(tk.id); check(tk.id); }} className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left">
              <span className="flex items-center gap-2"><Ticket className="h-4 w-4 text-cc-faint" aria-hidden /><span className="num font-medium">{tk.id}</span></span>
              <span className="truncate text-[13px] text-cc-muted">{tk.placeName} · {fmtTime(tk.sentAt, lang)}</span></button></li>))}</ul></section>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------ shell
const TABS: { id: Tab; path: string; key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'request', path: '/request', key: 'tab.request', icon: HandTap },
  { id: 'report', path: '/report', key: 'tab.report', icon: MessageSquareWarning },
  { id: 'water', path: '/water', key: 'tab.water', icon: Droplets },
  { id: 'track', path: '/track', key: 'tab.track', icon: Ticket },
];

const Portal: React.FC<{ initial: Tab }> = ({ initial }) => {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>(initial);
  const { places, fromCache, err } = usePlaces();
  const [place, setPlace] = useMyPlace();
  const online = useOnline();
  const { items, tickets, lastFlush } = useOutbox();
  const [sentFlash, setSentFlash] = useState(0);
  useEffect(() => {
    if (lastFlush?.sent) { setSentFlash(lastFlush.sent); const id = setTimeout(() => setSentFlash(0), 3500); return () => clearTimeout(id); }
  }, [lastFlush]);
  useEffect(() => {
    const h = () => { const p = TABS.find(x => x.path === window.location.pathname.replace(/\/$/, '')); if (p) setTab(p.id); };
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, []);
  const go = (id: Tab) => { setTab(id); window.history.pushState(null, '', TABS.find(x => x.id === id)!.path); };
  return (
    <div className="citizen citizen-sky min-h-full">
      <header className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <a href="/report" className="flex items-center gap-2.5" onClick={e => { e.preventDefault(); go('report'); }}>
          <Mark className="h-8 w-8 text-cc-accent" />
          <span className="display text-2xl">JalSetu <span className="text-cc-muted">· जलसेतु</span></span>
        </a>
        <div className="flex items-center gap-2"><InstallButton /><LangSwitch /></div>
      </header>
      <main className="mx-auto max-w-xl px-5 pb-16 pt-6">
        <p className="text-[13px] font-medium text-cc-accent">{t('report.eyebrow')}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1 key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}
            className="display mt-2 text-[34px] leading-[1.06] sm:text-[42px]">{tab === 'request' ? t('req.title') : tab === 'report' ? t('report.title') : tab === 'water' ? t('water.title') : t('track.title')}</motion.h1>
        </AnimatePresence>
        {tab === 'water' && <p className="mt-1 text-[15px] text-cc-muted">{t('water.sub')}</p>}
        {tab === 'request' && <p className="mt-1 text-[15px] text-cc-muted">{t('req.sub')}</p>}
        <nav className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sections">
          {TABS.map(x => {
            const Icon = x.icon;
            const on = tab === x.id;
            return (
              <motion.button key={x.id} type="button" onClick={() => go(x.id)} aria-current={on ? 'page' : undefined} whileTap={{ scale: 0.97 }} transition={SPRING}
                className={cx('relative flex min-h-[88px] flex-col items-start justify-between rounded-[18px] border p-3 text-left transition-colors duration-200',
                  on ? 'border-cc-accent/40 bg-cc-surface shadow-lift' : 'border-cc-border/70 bg-cc-surface/60 hover:bg-cc-surface')}>
                {on && <motion.span layoutId="portal-tab" className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-cc-accent" transition={SPRING} />}
                <span className={cx('flex h-9 w-9 items-center justify-center rounded-[12px] transition-colors', on ? 'bg-cc-accent text-white' : 'bg-cc-hover text-cc-muted')}><Icon className="h-5 w-5" /></span>
                <span className={cx('text-[13px] font-semibold leading-tight sm:text-[14px]', on ? 'text-cc-text' : 'text-cc-muted')}>{t(x.key)}</span>
              </motion.button>
            );
          })}
        </nav>
        <div className="mt-4 space-y-4">
          <OfflineBanner online={online} />
          <OutboxPanel items={items} online={online} />
          {err && !places.length && <ErrorBox message={err} />}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25, ease: EASE }}>
              {tab === 'request' && <RequestWater places={places} fromCache={fromCache} place={place} setPlace={setPlace} online={online} />}
              {tab === 'report' && <Report places={places} fromCache={fromCache} place={place} setPlace={setPlace} online={online} />}
              {tab === 'water' && <WaterInfo places={places} fromCache={fromCache} place={place} setPlace={setPlace} />}
              {tab === 'track' && <Track tickets={tickets} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <SentToast count={sentFlash} />
    </div>
  );
};

export const CitizenPortal: React.FC<{ initial?: Tab }> = ({ initial = 'report' }) => (
  <LangProvider><Portal initial={initial} /></LangProvider>
);
