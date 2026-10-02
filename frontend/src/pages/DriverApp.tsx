import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Droplets, LogOut, Navigation, NavigationOff, MapPin, Camera, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { api } from '../services/api';
import type { Tanker, Trip, TripStop } from '../types';
import { litres } from '../utils/format';

const PING_EVERY_MS = 10_000;

export const DriverApp: React.FC = () => {
  const { currentUser, logout, handleError, addToast } = useWaterData();
  const [tanker, setTanker] = useState<Tanker | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [fix, setFix] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    try { const r = await api.driverTrip(); setTanker(r.tanker); setTrip(r.trip); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const stopSharing = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
  }, []);

  const startSharing = () => {
    if (!('geolocation' in navigator)) { setGeoError('This device has no GPS / location support.'); return; }
    setGeoError(null);
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        setFix(pos);
        const now = Date.now();
        if (now - lastSent.current < PING_EVERY_MS) return;
        lastSent.current = now;
        const speed = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;
        api.ping({ lat: pos.coords.latitude, lng: pos.coords.longitude, speedKmh: speed, heading: pos.coords.heading, accuracyM: pos.coords.accuracy })
          .catch(() => undefined);
      },
      err => { setGeoError(err.code === err.PERMISSION_DENIED ? 'Location permission denied. Enable it in browser settings.' : err.message); stopSharing(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    setSharing(true);
  };
  useEffect(() => () => stopSharing(), [stopSharing]);

  const pending = trip?.stops.filter(s => s.status === 'Pending') || [];
  const next = pending[0];

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2"><Droplets className="w-5 h-5 text-sky-400" /><div><p className="text-sm font-black">JalSetu Driver</p><p className="text-[11px] text-slate-400">{currentUser?.name}</p></div></div>
        <button onClick={() => { stopSharing(); logout(); }} className="p-2 rounded-lg hover:bg-white/10" aria-label="Sign out"><LogOut className="w-4 h-4" /></button>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {error && <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">{error}</p>}

        {tanker && (
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-subtle">
            <div className="flex justify-between items-start">
              <div><p className="text-xs text-slate-500">Your tanker</p><p className="text-lg font-black text-slate-900">{tanker.vehicleNumber}</p></div>
              <span className="text-xs font-bold px-2 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200">{tanker.status}</span>
            </div>
            <p className="text-sm text-slate-600 mt-1">Load {litres(tanker.currentLoad)} / {litres(tanker.capacity)}</p>
          </div>
        )}

        <div className={`p-4 rounded-2xl border ${sharing ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{sharing ? 'Sharing live location' : 'Location sharing is off'}</p>
              <p className="text-xs text-slate-600">{fix ? `±${Math.round(fix.coords.accuracy)} m · ${fix.coords.latitude.toFixed(5)}, ${fix.coords.longitude.toFixed(5)}` : 'Turn on while driving so control room can track you.'}</p>
            </div>
            {sharing
              ? <button onClick={stopSharing} className="px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center gap-2"><NavigationOff className="w-4 h-4" />Stop</button>
              : <button onClick={startSharing} className="px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center gap-2"><Navigation className="w-4 h-4" />Start</button>}
          </div>
          {geoError && <p className="text-xs text-rose-700 mt-2">{geoError}</p>}
        </div>

        {!trip ? (
          <div className="p-6 rounded-2xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
            No active trip. You'll see your route here when control room dispatches you.
            <button onClick={load} className="mt-3 mx-auto flex items-center gap-1.5 text-sky-700 font-semibold"><RefreshCw className="w-4 h-4" />Refresh</button>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-2xl bg-white border border-slate-200">
              <p className="text-xs text-slate-500">Trip {trip.id} · {trip.distanceKm} km · ~{Math.round(trip.durationMin)} min driving</p>
              <ol className="mt-2 space-y-2">
                {trip.stops.map(s => (
                  <li key={s.id} className="flex items-center gap-3 text-sm">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${s.status === 'Delivered' ? 'bg-emerald-500 text-white' : s.id === next?.id ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {s.status === 'Delivered' ? <CheckCircle2 className="w-4 h-4" /> : s.seq}
                    </span>
                    <span className="flex-1 font-semibold text-slate-800">{s.communityName}</span>
                    <span className="text-slate-600">{litres(s.allocatedLitres)}</span>
                    {s.status === 'Pending' && (
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg bg-slate-100 text-slate-700" aria-label="Navigate"><MapPin className="w-4 h-4" /></a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            {next && <DeliveryForm key={next.id} stop={next} fix={fix} onDone={() => { addToast('Delivery recorded', next.communityName, 'success'); load(); }} onError={e => handleError(e, 'Could not record delivery')} />}
            {pending.length === 0 && <p className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 font-semibold">All stops delivered. Return to depot.</p>}
          </>
        )}
      </main>
    </div>
  );
};

const DeliveryForm: React.FC<{ stop: TripStop; fix: GeolocationPosition | null; onDone: () => void; onError: (e: unknown) => void }> = ({ stop, fix, onDone, onError }) => {
  const [amount, setAmount] = useState(stop.allocatedLitres);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const getFix = (): Promise<GeolocationPosition | null> => new Promise(res => {
    if (fix && Date.now() - fix.timestamp < 60_000) return res(fix);
    if (!('geolocation' in navigator)) return res(null);
    navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 15000 });
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const pos = await getFix();
      await api.recordDelivery({ tripStopId: stop.id, deliveredAmount: amount, notes, photo, lat: pos?.coords.latitude, lng: pos?.coords.longitude });
      onDone();
    } catch (err) { onError(err); }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="p-4 rounded-2xl bg-white border-2 border-sky-300 space-y-3">
      <p className="text-sm font-black text-slate-900">Proof of delivery: {stop.communityName}</p>
      <label className="block text-xs font-semibold text-slate-700">Litres delivered (from meter)
        <input type="number" inputMode="numeric" min={0} max={60000} step={100} value={amount} onChange={e => setAmount(Number(e.target.value))} required
          className="mt-1 w-full px-3 py-3 text-lg font-bold rounded-xl border border-slate-300" />
      </label>
      <label className="flex items-center gap-2 px-3 py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer">
        <Camera className="w-5 h-5" />{photo ? photo.name : 'Add photo (meter / handover)'}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => setPhoto(e.target.files?.[0] || null)} />
      </label>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300" />
      <p className="text-[11px] text-slate-500">Your GPS position is attached and checked against the community location.</p>
      <button type="submit" disabled={busy} className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-base font-bold flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Confirm delivery
      </button>
    </form>
  );
};
