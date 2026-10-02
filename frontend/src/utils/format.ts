export const litres = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('en-IN')} L`);

export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'Just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return dateTime(iso);
}

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const pct = (n: number | null | undefined, digits = 0) => (n == null ? '—' : `${n.toFixed(digits)}%`);
