// Display formatting. All times are shown in IST (the operating time zone); stored/transmitted as UTC.
const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };

export const litres = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('en-IN')} L`);

export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const km = (n: number | null | undefined) => (n == null ? '—' : n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(n < 10 ? 2 : 1)} km`);

export function timeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'Never';
  const diff = (nowMs - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return dt(iso);
}

export const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST' : '—';

export const dateTime = dt;

export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

export const pct = (n: number | null | undefined, digits = 0) => (n == null ? '—' : `${n.toFixed(digits)}%`);

export const minutes = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null;

/** District names as people say them today (the boundary dataset uses older / transliterated forms). */
const DISTRICT_DISPLAY: Record<string, string> = {
  Bid: 'Beed', Osmanabad: 'Dharashiv', Aurangabad: 'Chh. Sambhajinagar', Ahmadnagar: 'Ahilyanagar', Raigarh: 'Raigad',
  Gondiya: 'Gondia', Buldana: 'Buldhana',
};
export const districtName = (n: string | null | undefined) => (n ? DISTRICT_DISPLAY[n] ?? n : '');
