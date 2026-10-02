/**
 * Real device GPS -> buffered telemetry uploader.
 *
 * - Positions come ONLY from the browser Geolocation API (watchPosition + periodic fresh getCurrentPosition).
 * - Each fix keeps the device's own timestamp. Nothing is interpolated, predicted or re-timestamped.
 * - Fixes are buffered in localStorage while offline and flushed (idempotently: the backend de-duplicates
 *   on vehicle + device time) when the connection returns.
 */
import { api, ApiError } from '../services/api';

export interface Fix { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; heading: number | null; deviceTime: string }

export function toFix(p: GeolocationPosition): Fix {
  const c = p.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracyM: Number.isFinite(c.accuracy) ? Math.round(c.accuracy * 10) / 10 : null,
    speedKmh: c.speed != null && Number.isFinite(c.speed) ? Math.round(c.speed * 3.6 * 10) / 10 : null,
    heading: c.heading != null && Number.isFinite(c.heading) ? Math.round(c.heading) : null,
    deviceTime: new Date(p.timestamp).toISOString(),
  };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type GpsError = 'permission_denied' | 'unavailable' | 'timeout' | 'unsupported' | null;

export function geoErrorText(e: GpsError): string {
  switch (e) {
    case 'permission_denied': return 'Location permission denied. Allow location for this site in browser settings, then retry.';
    case 'unavailable': return 'GPS position unavailable. Move to open sky and make sure device location is ON.';
    case 'timeout': return 'GPS is taking too long. Keep the phone still with a clear view of the sky.';
    case 'unsupported': return 'This browser does not support location. Use Chrome or Safari over HTTPS.';
    default: return '';
  }
}

const OPTS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };

/** Wraps watchPosition + a fresh-fix heartbeat (some phones stop emitting watch events when stationary). */
export class GpsWatcher {
  private watchId: number | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  constructor(private onFix: (f: Fix) => void, private onError: (e: GpsError) => void, private heartbeatMs = 15000) {}

  start() {
    if (!('geolocation' in navigator)) { this.onError('unsupported'); return; }
    if (this.watchId !== null) return;
    const ok = (p: GeolocationPosition) => { this.onError(null); this.onFix(toFix(p)); };
    const err = (e: GeolocationPositionError) => this.onError(e.code === e.PERMISSION_DENIED ? 'permission_denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable');
    this.watchId = navigator.geolocation.watchPosition(ok, err, OPTS);
    this.hb = setInterval(() => navigator.geolocation.getCurrentPosition(ok, err, OPTS), this.heartbeatMs);
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    if (this.hb) clearInterval(this.hb);
    this.watchId = null;
    this.hb = null;
  }
}

export function currentFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject('unsupported'); return; }
    navigator.geolocation.getCurrentPosition(p => resolve(toFix(p)),
      e => reject(e.code === e.PERMISSION_DENIED ? 'permission_denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable'), OPTS);
  });
}

export interface UploadStatus { queued: number; lastSentAt: number | null; lastServerStatus: string | null; online: boolean; error: string | null; stopped: boolean }

/** Persistent queue + uploader for one trip. */
export class TelemetryUploader {
  private key: string;
  private queue: Fix[] = [];
  private lastQueued: Fix | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  status: UploadStatus = { queued: 0, lastSentAt: null, lastServerStatus: null, online: navigator.onLine, error: null, stopped: false };

  constructor(private vehicleId: string, private tripId: string, private onChange: (s: UploadStatus, response?: { tripStatus: string; arrivedAt: string | null }) => void) {
    this.key = `jalsetu_tq_${tripId}`;
    try { this.queue = JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { this.queue = []; }
    this.status.queued = this.queue.length;
  }

  private persist() {
    try { localStorage.setItem(this.key, JSON.stringify(this.queue.slice(-5000))); } catch { /* storage full: keep in memory */ }
    this.status.queued = this.queue.length;
    this.onChange({ ...this.status });
  }

  /** Thin the stream sensibly: every >= 4 s, or >= 15 m moved, or a notably more accurate fix. Never alters values. */
  add(f: Fix) {
    const prev = this.lastQueued;
    if (prev) {
      const dt = Date.parse(f.deviceTime) - Date.parse(prev.deviceTime);
      if (dt <= 0) return;
      const moved = haversineM(prev, f);
      const better = f.accuracyM != null && prev.accuracyM != null && f.accuracyM < prev.accuracyM * 0.6;
      if (dt < 4000 && moved < 15 && !better) return;
    }
    this.lastQueued = f;
    this.queue.push(f);
    this.persist();
  }

  start() {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.timer = setInterval(() => this.flush(), 4000);
    this.flush();
  }

  stop() {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  clear() {
    this.queue = [];
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
    this.persist();
  }

  private onOnline = () => { this.status.online = true; this.onChange({ ...this.status }); this.flush(); };
  private onOffline = () => { this.status.online = false; this.onChange({ ...this.status }); };

  async flush() {
    if (this.busy || this.status.stopped || this.queue.length === 0) return;
    this.busy = true;
    const batch = this.queue.slice(0, 100);
    try {
      const r = await api.sendTelemetry(this.vehicleId, this.tripId, batch);
      const sent = new Set(batch.map(b => b.deviceTime));
      this.queue = this.queue.filter(q => !sent.has(q.deviceTime));   // accepted, duplicate or rejected: all processed
      this.status = { ...this.status, lastSentAt: Date.now(), lastServerStatus: r.tripStatus, online: true, error: r.rejected.length ? `${r.rejected.length} fix(es) rejected: ${r.rejected[0].reason}` : null };
      this.persist();
      this.onChange({ ...this.status }, { tripStatus: r.tripStatus, arrivedAt: r.arrivedAt });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 404)) {
        this.status = { ...this.status, error: e.message, stopped: true };   // trip ended / not ours: stop sending
        this.clear();
      } else {
        this.status = { ...this.status, online: e instanceof ApiError && e.status !== 0 ? navigator.onLine : false, error: e instanceof Error ? e.message : String(e) };
        this.onChange({ ...this.status });
      }
    } finally {
      this.busy = false;
    }
    if (this.queue.length > 0 && !this.status.stopped && this.status.online) setTimeout(() => this.flush(), 300);
  }
}

/** Keep the screen awake during a trip (browsers suspend GPS when the screen turns off). */
export async function keepAwake(): Promise<() => void> {
  try {
    const wl = await (navigator as any).wakeLock?.request('screen');
    return () => { try { wl?.release(); } catch { /* ignore */ } };
  } catch {
    return () => undefined;
  }
}
