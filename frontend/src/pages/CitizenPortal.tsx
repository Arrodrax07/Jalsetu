import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Loader2, LocateFixed, MapPin, Search, Send } from 'lucide-react';
import { api } from '../services/api';
import { Button, cx, EASE, ErrorBox, Field, SPRING } from '../components/ui';
import { Mark } from '../components/shell/Shell';
import { districtName } from '../utils/format';

type Place = { id: string; name: string; ward: string; lat: number; lng: number };

const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

/** Type-ahead place picker with "use my location" (computed on the device; the location itself is not sent). */
const PlacePicker: React.FC<{ places: Place[]; value: Place | null; onChange: (p: Place | null) => void }> = ({ places, value, onChange }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
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
  const locate = () => {
    if (!navigator.geolocation) { setLocErr('This browser cannot share location.'); return; }
    setLocating(true); setLocErr(null);
    navigator.geolocation.getCurrentPosition(pos => {
      const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const ranked = places.map(p => ({ ...p, km: distKm(me, p) })).sort((a, b) => a.km - b.km).slice(0, 4);
      setNear(ranked);
      if (ranked[0]) onChange(ranked[0]);
      setLocating(false);
    }, err => { setLocErr(err.code === 1 ? 'Location permission was denied. Search for your area instead.' : 'Could not get your location. Search for your area instead.'); setLocating(false); },
    { enableHighAccuracy: true, timeout: 12000 });
  };
  const pick = (p: Place) => { onChange(p); setQ(''); setOpen(false); };
  return (
    <div ref={box} className="space-y-2">
      <AnimatePresence mode="wait">
        {value ? (
          <motion.div key={value.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="flex items-center gap-3 rounded-2xl border border-cc-accent/30 bg-cc-accent/[0.05] p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cc-accent text-white"><MapPin className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{value.name}</span><span className="block text-xs text-cc-muted">{districtName(value.ward)} district</span></span>
            <button type="button" className="text-xs font-medium text-cc-accent-strong underline underline-offset-4" onClick={() => { onChange(null); setOpen(true); }}>Change</button>
          </motion.div>
        ) : (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
            <input className="input pl-10" placeholder="Type your town or village" value={q} onFocus={() => setOpen(true)}
              onChange={e => { setQ(e.target.value); setOpen(true); }} aria-label="Search your area" />
            <AnimatePresence>
              {open && matches.length > 0 && (
                <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
                  className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-cc-border bg-cc-surface p-1 shadow-pop">
                  {matches.map(p => (
                    <li key={p.id}><button type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-cc-hover">
                      <span>{p.name}</span><span className="text-xs text-cc-muted">{districtName(p.ward)}</span></button></li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      {!value && (
        <button type="button" onClick={locate} className="flex items-center gap-2 text-sm font-medium text-cc-accent-strong">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Use my location
        </button>
      )}
      {near.length > 1 && value && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-cc-muted">Nearby:</span>
          {near.map(n => (
            <button type="button" key={n.id} onClick={() => onChange(n)} className={cx('rounded-full px-2.5 py-1 ring-1', n.id === value.id ? 'bg-cc-text text-white ring-cc-text' : 'ring-cc-border hover:ring-cc-strong')}>
              {n.name} · {n.km < 1 ? '<1' : n.km.toFixed(0)} km</button>
          ))}
        </div>
      )}
      {locErr && <p className="text-xs text-amber-800">{locErr}</p>}
    </div>
  );
};

export const CitizenPortal: React.FC = () => {
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ id: string; category: string; severity: string; message: string } | null>(null);
  useEffect(() => { api.publicCommunities().then(setPlaces).catch(e => setErr(e.message)); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!place) { setErr('Choose your town or village first.'); return; }
    setBusy(true); setErr(null);
    try { setTicket(await api.publicComplaint({ communityId: place.id, description: text, reporterName: name, reporterPhone: phone })); }
    catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
  return (
    <div className="contours min-h-full bg-cc-bg">
      <header className="mx-auto flex max-w-xl items-center gap-2.5 px-5 pt-6">
        <Mark className="h-8 w-8 text-cc-accent" />
        <span className="display text-2xl">JalSetu <span className="text-cc-muted">· जलसेतु</span></span>
      </header>
      <main className="mx-auto max-w-xl px-5 pb-16 pt-8">
        <AnimatePresence mode="wait">
          {ticket ? (
            <motion.div key="done" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: EASE }}
              className="panel overflow-hidden text-center">
              <div className="bg-cc-accent/[0.06] px-6 pb-6 pt-8">
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: 0.15 }}
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cc-ok text-white"><CheckCircle2 className="h-7 w-7" /></motion.span>
                <p className="eyebrow mt-4">Complaint registered · तक्रार नोंदवली</p>
                <p className="display mt-1 text-5xl">{ticket.id}</p>
              </div>
              <div className="space-y-3 p-6">
                <p className="text-sm leading-relaxed text-cc-muted">{ticket.message}</p>
                <p className="text-xs text-cc-faint">Keep this number to follow up with your ward water office.</p>
                <Button variant="secondary" onClick={() => { setTicket(null); setText(''); }}>Report another problem</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.5, ease: EASE }}>
              <p className="eyebrow">For residents · no account needed</p>
              <h1 className="display mt-2 text-[44px] leading-[1.02] sm:text-[52px]">Report a water problem</h1>
              <p className="mt-1 text-lg text-cc-muted">पाण्याची तक्रार नोंदवा · पानी की शिकायत</p>
              <form onSubmit={submit} className="panel mt-7 space-y-5 p-5 sm:p-6">
                <Field label="1 · Your town or village"><PlacePicker places={places} value={place} onChange={setPlace} /></Field>
                <Field label="2 · What is the problem? (any language)">
                  <textarea className="input" rows={5} required minLength={5} maxLength={3000} value={text} onChange={e => setText(e.target.value)}
                    placeholder="e.g. No water for 3 days in lane 4 / टँकर आला नाही / 3 दिन से पानी नहीं आया" />
                </Field>
                <Field label="3 · Contact (optional)">
                  <div className="grid grid-cols-2 gap-3"><input className="input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
                    <input className="input" type="tel" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} maxLength={32} /></div>
                </Field>
                {err && <ErrorBox message={err} />}
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!place} icon={<Send className="h-4 w-4" />}>Submit complaint</Button>
                <p className="text-center text-[11px] leading-relaxed text-cc-faint">Goes straight to the water operations room. Your phone number is used only to contact you about this complaint. Your location never leaves this device.</p>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
