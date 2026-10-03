/** JalSetu operations UI kit. Status is never conveyed by colour alone: every chip carries an icon and text. */
import React, { useEffect } from 'react';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, Database, ExternalLink, FlaskConical, Globe2, Info, Loader2,
  PencilLine, Radio, RadioTower, Satellite, SignalLow, Sigma, WifiOff, X,
} from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------- layout
export const Panel: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode; eyebrow?: string }> =
  ({ title, actions, className, bodyClassName, children, eyebrow }) => (
    <section className={cx('panel flex flex-col min-w-0', className)}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="text-sm font-semibold text-cc-text truncate">{title}</h2>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );

export const PageHeader: React.FC<{ title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-5">
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-cc-text">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-cc-muted max-w-3xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

// ---------------------------------------------------------------------------- buttons
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-cc-accent-strong text-white hover:bg-cc-accent disabled:bg-cc-accent-strong/40',
  secondary: 'bg-cc-raised text-cc-text border border-cc-border hover:bg-cc-hover hover:border-cc-strong',
  danger: 'bg-cc-danger/15 text-red-300 border border-cc-danger/40 hover:bg-cc-danger/25',
  ghost: 'text-cc-muted hover:text-cc-text hover:bg-cc-hover',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-600/40',
};
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: React.ReactNode }> =
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }) => (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-3.5 text-base' : 'px-3.5 py-2 text-sm', BTN[variant], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );

// ---------------------------------------------------------------------------- chips
export const Chip: React.FC<{ tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'seeded' | 'external' | 'predicted' | 'estimated'; icon?: React.ReactNode; children: React.ReactNode; title?: string; className?: string }> =
  ({ tone = 'neutral', icon, children, title, className }) => {
    const t: Record<string, string> = {
      neutral: 'bg-cc-raised text-cc-muted border-cc-border',
      accent: 'bg-cc-accent/10 text-cc-accent border-cc-accent/30',
      ok: 'bg-cc-ok/10 text-green-300 border-cc-ok/30',
      warn: 'bg-cc-warn/10 text-amber-300 border-cc-warn/30',
      danger: 'bg-cc-danger/10 text-red-300 border-cc-danger/40',
      seeded: 'bg-cc-seeded/10 text-violet-300 border-cc-seeded/30',
      external: 'bg-cc-external/10 text-sky-300 border-cc-external/30',
      predicted: 'bg-cc-predicted/10 text-pink-300 border-cc-predicted/30',
      estimated: 'bg-cc-estimated/10 text-amber-200 border-cc-estimated/30',
    };
    return (
      <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide', t[tone], className)}>
        {icon}{children}
      </span>
    );
  };

export type TrackingState = 'live' | 'stale' | 'offline' | 'no_signal';
export const TrackingBadge: React.FC<{ state: TrackingState; ageSeconds?: number | null; compact?: boolean }> = ({ state, ageSeconds, compact }) => {
  const map = {
    live: { tone: 'ok' as const, icon: <Radio className="h-3 w-3" aria-hidden />, label: 'Live' },
    stale: { tone: 'warn' as const, icon: <SignalLow className="h-3 w-3" aria-hidden />, label: 'Stale' },
    offline: { tone: 'danger' as const, icon: <WifiOff className="h-3 w-3" aria-hidden />, label: 'Offline' },
    no_signal: { tone: 'neutral' as const, icon: <CircleDot className="h-3 w-3" aria-hidden />, label: 'No signal' },
  }[state];
  return (
    <Chip tone={map.tone} icon={map.icon} title={ageSeconds != null ? `Last fix ${formatAge(ageSeconds)} ago` : 'No position received yet'}>
      {map.label}{!compact && ageSeconds != null && state !== 'no_signal' ? ` · ${formatAge(ageSeconds)}` : ''}
    </Chip>
  );
};

export function formatAge(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const ORIGIN = {
  seeded: { tone: 'seeded' as const, icon: <Database className="h-3 w-3" aria-hidden />, label: 'Seeded · reference', title: 'Reference/seed record — not live or official data' },
  manual: { tone: 'neutral' as const, icon: <PencilLine className="h-3 w-3" aria-hidden />, label: 'Manual', title: 'Entered by staff' },
  external: { tone: 'external' as const, icon: <Globe2 className="h-3 w-3" aria-hidden />, label: 'External', title: 'Imported from an external source (see provenance)' },
  citizen: { tone: 'accent' as const, icon: <PencilLine className="h-3 w-3" aria-hidden />, label: 'Citizen', title: 'Submitted through the public portal' },
};
export const OriginLabel: React.FC<{ origin?: string | null }> = ({ origin }) => {
  const o = ORIGIN[(origin || 'manual') as keyof typeof ORIGIN] || ORIGIN.manual;
  return <Chip tone={o.tone} icon={o.icon} title={o.title}>{o.label}</Chip>;
};

export const KindLabel: React.FC<{ kind: 'predicted' | 'estimated' | 'live-gps' | 'external-alert' | 'rule-based'; title?: string }> = ({ kind, title }) => {
  const m = {
    predicted: { tone: 'predicted' as const, icon: <FlaskConical className="h-3 w-3" aria-hidden />, label: 'ML prediction' },
    estimated: { tone: 'estimated' as const, icon: <Sigma className="h-3 w-3" aria-hidden />, label: 'Estimated' },
    'live-gps': { tone: 'ok' as const, icon: <Satellite className="h-3 w-3" aria-hidden />, label: 'Live GPS' },
    'external-alert': { tone: 'external' as const, icon: <RadioTower className="h-3 w-3" aria-hidden />, label: 'External alert' },
    'rule-based': { tone: 'accent' as const, icon: <Info className="h-3 w-3" aria-hidden />, label: 'Rule-based' },
  }[kind];
  return <Chip tone={m.tone} icon={m.icon} title={title}>{m.label}</Chip>;
};

export const SEVERITY_TONE: Record<string, 'danger' | 'warn' | 'accent' | 'neutral'> = { Extreme: 'danger', Severe: 'danger', Moderate: 'warn', Minor: 'accent', Unknown: 'neutral' };
export const SEVERITY_COLOR: Record<string, string> = { Extreme: '#dc2626', Severe: '#f97316', Moderate: '#eab308', Minor: '#3b82f6', Unknown: '#64748b' };
export const SeverityChip: React.FC<{ severity: string }> = ({ severity }) => (
  <Chip tone={SEVERITY_TONE[severity] || 'neutral'} icon={severity === 'Extreme' || severity === 'Severe' ? <AlertOctagon className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}>
    {severity}
  </Chip>
);

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'> = {
  Completed: 'ok', Verified: 'ok', Delivered: 'ok', Resolved: 'ok', Available: 'ok', Approved: 'ok', connected: 'ok', healthy: 'ok', receiving: 'ok',
  'En Route': 'accent', 'On Trip': 'accent', Arrived: 'accent', Delivering: 'accent', Accepted: 'accent', Assigned: 'accent', Allocated: 'accent', Dispatched: 'accent', Proposed: 'accent',
  Pending: 'neutral', Planned: 'neutral', 'Pending Verification': 'warn', Escalated: 'warn', degraded: 'warn', unknown: 'neutral', idle: 'neutral', awaiting_credentials: 'neutral',
  Mismatch: 'danger', 'Under Investigation': 'danger', Maintenance: 'danger', Cancelled: 'neutral', Rejected: 'neutral', down: 'danger', unavailable: 'danger',
  Critical: 'danger', High: 'warn', Medium: 'accent', Low: 'neutral',
};
export const StatusChip: React.FC<{ status: string; label?: string }> = ({ status, label }) => {
  const tone = STATUS_TONE[status] || 'neutral';
  const icon = tone === 'ok' ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : tone === 'danger' ? <AlertOctagon className="h-3 w-3" aria-hidden /> : tone === 'warn' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <CircleDot className="h-3 w-3" aria-hidden />;
  return <Chip tone={tone} icon={icon}>{label || status.replace(/_/g, ' ')}</Chip>;
};

// ---------------------------------------------------------------------------- states
export const Empty: React.FC<{ title: string; hint?: React.ReactNode; icon?: React.ReactNode; className?: string }> = ({ title, hint, icon, className }) => (
  <div className={cx('flex flex-col items-center justify-center gap-2 py-10 text-center', className)}>
    <div className="text-cc-faint">{icon || <Info className="h-6 w-6" aria-hidden />}</div>
    <p className="text-sm font-medium text-cc-muted">{title}</p>
    {hint && <p className="max-w-sm text-xs text-cc-faint">{hint}</p>}
  </div>
);

export const Loading: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading…', className }) => (
  <div role="status" className={cx('flex items-center justify-center gap-2 py-10 text-sm text-cc-muted', className)}>
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
  </div>
);

export const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-start gap-3 rounded-lg border border-cc-danger/40 bg-cc-danger/10 p-3 text-sm text-red-200">
    <AlertOctagon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
    <div className="flex-1">{message}</div>
    {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
  </div>
);

// ---------------------------------------------------------------------------- KPI
export type KpiTone = 'default' | 'danger' | 'warn' | 'ok' | 'accent' | 'violet' | 'teal';
const KPI_TONE: Record<KpiTone, { bar: string; wash: string; badge: string; value: string }> = {
  default: { bar: 'from-cc-strong to-cc-strong/0', wash: 'from-cc-raised/70', badge: 'bg-cc-raised text-cc-muted ring-cc-border', value: 'text-cc-text' },
  danger: { bar: 'from-cc-danger to-cc-danger/0', wash: 'from-cc-danger/15', badge: 'bg-cc-danger/15 text-red-300 ring-cc-danger/40', value: 'text-red-200' },
  warn: { bar: 'from-cc-warn to-cc-warn/0', wash: 'from-cc-warn/15', badge: 'bg-cc-warn/15 text-amber-300 ring-cc-warn/40', value: 'text-amber-100' },
  ok: { bar: 'from-cc-ok to-cc-ok/0', wash: 'from-cc-ok/15', badge: 'bg-cc-ok/15 text-green-300 ring-cc-ok/40', value: 'text-green-100' },
  accent: { bar: 'from-cc-accent to-cc-accent/0', wash: 'from-cc-accent/15', badge: 'bg-cc-accent/15 text-sky-300 ring-cc-accent/40', value: 'text-sky-100' },
  violet: { bar: 'from-cc-violet to-cc-violet/0', wash: 'from-cc-violet/15', badge: 'bg-cc-violet/15 text-violet-300 ring-cc-violet/40', value: 'text-violet-100' },
  teal: { bar: 'from-cc-teal to-cc-teal/0', wash: 'from-cc-teal/15', badge: 'bg-cc-teal/15 text-teal-300 ring-cc-teal/40', value: 'text-teal-100' },
};
export const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: KpiTone; icon?: React.ReactNode; onClick?: () => void }> =
  ({ label, value, sub, tone = 'default', icon, onClick }) => {
    const t = KPI_TONE[tone];
    const Tag = onClick ? 'button' : 'div';
    return (
      <Tag onClick={onClick} className={cx('panel group relative overflow-hidden bg-gradient-to-br to-transparent px-3.5 py-3 text-left', t.wash,
        onClick && 'transition-all hover:-translate-y-0.5 hover:border-cc-strong hover:shadow-pop')}>
        <span className={cx('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', t.bar)} aria-hidden />
        <div className="flex items-start justify-between gap-2">
          <p className="eyebrow truncate pt-0.5">{label}</p>
          {icon && <span className={cx('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ring-1', t.badge)}>{icon}</span>}
        </div>
        <p className={cx('num -mt-0.5 text-2xl font-bold tracking-tight', t.value)}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-2xs text-cc-muted">{sub}</p>}
      </Tag>
    );
  };

// ---------------------------------------------------------------------------- overlays
export const SlideOver: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: string }> =
  ({ open, onClose, title, subtitle, children, width = 'max-w-md' }) => {
    useEffect(() => {
      if (!open) return;
      const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [open, onClose]);
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
        <button aria-label="Close panel" className="absolute inset-0 bg-black/50" onClick={onClose} />
        <aside className={cx('relative flex h-full w-full flex-col border-l border-cc-border bg-cc-surface shadow-pop', width)}>
          <header className="flex items-start justify-between gap-3 border-b border-cc-border px-5 py-4">
            <div className="min-w-0">
              <div className="text-base font-semibold text-cc-text">{title}</div>
              {subtitle && <div className="mt-0.5 text-xs text-cc-muted">{subtitle}</div>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </aside>
      </div>
    );
  };

export const Dialog: React.FC<{ open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }> =
  ({ open, onClose, title, subtitle, children, wide }) => {
    useEffect(() => {
      if (!open) return;
      const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [open, onClose]);
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
        <button aria-label="Close dialog" className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className={cx('relative max-h-[90vh] w-full overflow-hidden rounded-xl border border-cc-border bg-cc-surface shadow-pop flex flex-col', wide ? 'max-w-3xl' : 'max-w-lg')}>
          <header className="flex items-start justify-between gap-3 border-b border-cc-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-cc-muted">{subtitle}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    );
  };

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }> = ({ label, children, hint, className }) => (
  <label className={cx('block', className)}>
    <span className="label">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-2xs text-cc-faint">{hint}</span>}
  </label>
);

export const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex items-start justify-between gap-4 border-b border-cc-border/70 py-1.5 text-sm last:border-0">
    <span className="text-cc-muted">{k}</span>
    <span className="text-right text-cc-text min-w-0 break-words">{v}</span>
  </div>
);

export const SourceLink: React.FC<{ href: string; label?: string }> = ({ href, label = 'Official source' }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-cc-accent hover:underline">
    {label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
  </a>
);

export const Tabs: React.FC<{ tabs: { id: string; label: React.ReactNode }[]; value: string; onChange: (id: string) => void }> = ({ tabs, value, onChange }) => (
  <div role="tablist" className="flex gap-1 border-b border-cc-border px-2">
    {tabs.map(t => (
      <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
        className={cx('-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors', value === t.id ? 'border-cc-accent text-cc-text' : 'border-transparent text-cc-muted hover:text-cc-text')}>
        {t.label}
      </button>
    ))}
  </div>
);
