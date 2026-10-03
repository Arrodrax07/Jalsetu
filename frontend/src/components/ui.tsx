/** JalSetu UI kit ("water atlas"). Status is never conveyed by colour alone: every chip carries an icon and text. */
import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, Database, ExternalLink, FlaskConical, Globe2, Info, Loader2,
  PencilLine, Radio, RadioTower, Satellite, SignalLow, Sigma, WifiOff, X,
} from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Shared easing: quick out, soft landing. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;

// ---------------------------------------------------------------------------- motion helpers
/** Fades and lifts its children in, staggered. Wrap a list or grid. */
export const Stagger: React.FC<{ children: React.ReactNode; className?: string; delay?: number; step?: number; as?: 'div' | 'ul' | 'ol' }> =
  ({ children, className, delay = 0, step = 0.045, as = 'div' }) => {
    const Tag = motion[as];
    return (
      <Tag className={className} initial="hidden" animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}>
        {children}
      </Tag>
    );
  };
export const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};
export const Item: React.FC<{ children: React.ReactNode; className?: string; as?: 'div' | 'li' }> = ({ children, className, as = 'div' }) => {
  const Tag = motion[as];
  return <Tag className={className} variants={itemVariants}>{children}</Tag>;
};

/** Counts a number up when it scrolls into view and eases between later values. */
export const CountUp: React.FC<{ value: number; format?: (n: number) => string; className?: string; duration?: number }> =
  ({ value, format = n => Math.round(n).toLocaleString('en-IN'), className, duration = 1.1 }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const seen = useInView(ref, { once: true });
    const reduce = useReducedMotion();
    const from = useRef(0);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      if (!seen || reduce) { el.textContent = format(value); return; }
      const ctl = animate(from.current, value, { duration, ease: EASE, onUpdate: v => { el.textContent = format(v); } });
      from.current = value;
      return () => ctl.stop();
    }, [value, seen, reduce, duration, format]);
    return <span ref={ref} className={cx('num', className)}>{format(0)}</span>;
  };

// ---------------------------------------------------------------------------- layout
export const Panel: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode; eyebrow?: string }> =
  ({ title, actions, className, bodyClassName, children, eyebrow }) => (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}
      className={cx('panel flex flex-col min-w-0', className)}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
            {title && <h2 className="truncate text-[15px] font-semibold text-cc-text">{title}</h2>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0', bodyClassName ?? 'p-5')}>{children}</div>
    </motion.section>
  );

export const PageHeader: React.FC<{ title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }> = ({ title, subtitle, actions, eyebrow }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
    className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
      <h1 className="display text-[34px] leading-[1.05] text-cc-text md:text-[40px]">{title}</h1>
      {subtitle && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-cc-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </motion.div>
);

// ---------------------------------------------------------------------------- buttons
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-cc-text text-white shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_6px_14px_-6px_rgb(19_31_42/0.5)] hover:bg-[#0b1621] disabled:bg-cc-text/40',
  secondary: 'bg-cc-surface text-cc-text border border-cc-border shadow-[0_1px_2px_rgb(19_31_42/0.05)] hover:border-cc-strong hover:bg-cc-raised',
  danger: 'bg-cc-danger/[0.07] text-red-700 border border-cc-danger/25 hover:bg-cc-danger/[0.12]',
  ghost: 'text-cc-muted hover:text-cc-text hover:bg-cc-hover',
  success: 'bg-cc-accent text-white shadow-[0_6px_14px_-6px_rgb(12_110_150/0.6)] hover:bg-cc-accent-strong disabled:bg-cc-accent/40',
};
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: React.ReactNode }> =
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }) => (
    <motion.button
      {...(rest as React.ComponentProps<typeof motion.button>)}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={SPRING}
      disabled={disabled || loading}
      className={cx('inline-flex select-none items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-3.5 text-[15px]' : 'px-3.5 py-2 text-sm', BTN[variant], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </motion.button>
  );

// ---------------------------------------------------------------------------- chips
export const Chip: React.FC<{ tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'seeded' | 'external' | 'predicted' | 'estimated'; icon?: React.ReactNode; children: React.ReactNode; title?: string; className?: string }> =
  ({ tone = 'neutral', icon, children, title, className }) => {
    const t: Record<string, string> = {
      neutral: 'bg-cc-hover/70 text-cc-muted ring-cc-border',
      accent: 'bg-cc-accent/[0.08] text-cc-accent-strong ring-cc-accent/20',
      ok: 'bg-cc-ok/[0.08] text-green-800 ring-cc-ok/20',
      warn: 'bg-cc-warn/[0.09] text-amber-800 ring-cc-warn/25',
      danger: 'bg-cc-danger/[0.08] text-red-700 ring-cc-danger/20',
      seeded: 'bg-cc-seeded/[0.08] text-violet-700 ring-cc-seeded/20',
      external: 'bg-cc-external/[0.08] text-sky-800 ring-cc-external/20',
      predicted: 'bg-cc-predicted/[0.08] text-pink-700 ring-cc-predicted/20',
      estimated: 'bg-cc-estimated/[0.09] text-amber-800 ring-cc-estimated/25',
    };
    return (
      <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset', t[tone], className)}>
        {icon}{children}
      </span>
    );
  };

export type TrackingState = 'live' | 'stale' | 'offline' | 'no_signal';
export const TrackingBadge: React.FC<{ state: TrackingState; ageSeconds?: number | null; compact?: boolean }> = ({ state, ageSeconds, compact }) => {
  const map = {
    live: { tone: 'ok' as const, icon: <span className="relative mr-0.5 flex h-1.5 w-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-cc-live opacity-60" /><span className="relative h-1.5 w-1.5 rounded-full bg-cc-live" /></span>, label: 'Live' },
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
  synthetic: { tone: 'predicted' as const, icon: <FlaskConical className="h-3 w-3" aria-hidden />, label: 'Synthetic', title: 'Labelled demo history (scripts/demo_history.py). Never used operationally.' },
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
export const SEVERITY_COLOR: Record<string, string> = { Extreme: '#a8201a', Severe: '#cc5422', Moderate: '#c4880a', Minor: '#2860c8', Unknown: '#8c96a0' };
export const SeverityChip: React.FC<{ severity: string }> = ({ severity }) => (
  <Chip tone={SEVERITY_TONE[severity] || 'neutral'} icon={severity === 'Extreme' || severity === 'Severe' ? <AlertOctagon className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}>
    {severity}
  </Chip>
);

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'> = {
  Completed: 'ok', Verified: 'ok', Delivered: 'ok', Resolved: 'ok', Available: 'ok', Approved: 'ok', connected: 'ok', healthy: 'ok', receiving: 'ok',
  'En Route': 'accent', 'On Trip': 'accent', Arrived: 'accent', Delivering: 'accent', Accepted: 'accent', Assigned: 'accent', Allocated: 'accent', Dispatched: 'accent', Proposed: 'accent',
  Pending: 'neutral', Planned: 'neutral', 'Pending Verification': 'warn', Escalated: 'warn', degraded: 'warn', unknown: 'neutral', idle: 'neutral', awaiting_credentials: 'neutral',
  Merged: 'neutral', Mismatch: 'danger', 'Under Investigation': 'danger', Maintenance: 'danger', Cancelled: 'neutral', Rejected: 'neutral', down: 'danger', unavailable: 'danger',
  Critical: 'danger', High: 'warn', Medium: 'accent', Low: 'neutral', 'High Demand': 'warn', Normal: 'neutral', 'Recently Served': 'ok',
};
export const StatusChip: React.FC<{ status: string; label?: string }> = ({ status, label }) => {
  const tone = STATUS_TONE[status] || 'neutral';
  const icon = tone === 'ok' ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : tone === 'danger' ? <AlertOctagon className="h-3 w-3" aria-hidden /> : tone === 'warn' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : tone === 'accent' ? <Radio className="h-3 w-3" aria-hidden /> : <CircleDot className="h-3 w-3" aria-hidden />;
  return <Chip tone={tone} icon={icon}>{label || status.replace(/_/g, ' ')}</Chip>;
};

// ---------------------------------------------------------------------------- states
export const Empty: React.FC<{ title: string; hint?: React.ReactNode; icon?: React.ReactNode; className?: string }> = ({ title, hint, icon, className }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
    className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
    <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-cc-hover text-cc-faint">{icon || <Info className="h-5 w-5" aria-hidden />}</div>
    <p className="text-sm font-medium text-cc-text">{title}</p>
    {hint && <p className="max-w-sm text-xs leading-relaxed text-cc-muted">{hint}</p>}
  </motion.div>
);

export const Loading: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading…', className }) => (
  <div role="status" className={cx('flex items-center justify-center gap-3 py-12 text-sm text-cc-muted', className)}>
    <span className="relative flex h-4 w-4"><span className="absolute inset-0 animate-ping rounded-full bg-cc-accent/30" /><span className="relative m-auto h-2 w-2 rounded-full bg-cc-accent" /></span>
    {label}
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cx('relative overflow-hidden rounded-lg bg-cc-hover', className)}>
    <motion.div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
      animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
  </div>
);

export const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-start gap-3 rounded-xl border border-cc-danger/25 bg-cc-danger/[0.05] p-3 text-sm text-red-800">
    <AlertOctagon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
    <div className="flex-1">{message}</div>
    {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
  </div>
);

// ---------------------------------------------------------------------------- KPI
export type KpiTone = 'default' | 'danger' | 'warn' | 'ok' | 'accent' | 'violet' | 'teal';
const KPI_TONE: Record<KpiTone, { dot: string; badge: string; value: string; bar: string }> = {
  default: { dot: 'bg-cc-faint', badge: 'bg-cc-hover text-cc-muted', value: 'text-cc-text', bar: 'bg-cc-strong' },
  danger: { dot: 'bg-cc-danger', badge: 'bg-cc-danger/[0.08] text-red-700', value: 'text-red-800', bar: 'bg-cc-danger' },
  warn: { dot: 'bg-cc-warn', badge: 'bg-cc-warn/10 text-amber-800', value: 'text-amber-900', bar: 'bg-cc-warn' },
  ok: { dot: 'bg-cc-ok', badge: 'bg-cc-ok/[0.08] text-green-800', value: 'text-cc-text', bar: 'bg-cc-ok' },
  accent: { dot: 'bg-cc-accent', badge: 'bg-cc-accent/[0.08] text-cc-accent-strong', value: 'text-cc-text', bar: 'bg-cc-accent' },
  violet: { dot: 'bg-cc-violet', badge: 'bg-cc-violet/[0.08] text-violet-700', value: 'text-cc-text', bar: 'bg-cc-violet' },
  teal: { dot: 'bg-cc-teal', badge: 'bg-cc-teal/[0.08] text-teal-800', value: 'text-cc-text', bar: 'bg-cc-teal' },
};
export const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: KpiTone; icon?: React.ReactNode; onClick?: () => void }> =
  ({ label, value, sub, tone = 'default', icon, onClick }) => {
    const t = KPI_TONE[tone];
    const numeric = typeof value === 'number';
    return (
      <motion.button type="button" onClick={onClick} disabled={!onClick} variants={itemVariants}
        whileHover={onClick ? { y: -2 } : undefined} transition={SPRING}
        className={cx('panel group relative overflow-hidden px-4 pb-3.5 pt-3.5 text-left disabled:cursor-default', onClick && 'hover:shadow-lift hover:border-cc-strong')}>
        <div className="flex items-start justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-cc-muted">
            <span className={cx('h-1.5 w-1.5 flex-shrink-0 rounded-full', t.dot)} aria-hidden /><span className="truncate">{label}</span>
          </p>
          {icon && <span className={cx('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-110', t.badge)}>{icon}</span>}
        </div>
        <p className={cx('display mt-1 text-[38px] leading-none', t.value)}>
          {numeric ? <CountUp value={value as number} /> : value}
        </p>
        {sub && <p className="mt-1.5 truncate text-[11.5px] text-cc-muted">{sub}</p>}
        <span className={cx('absolute bottom-0 left-4 right-4 h-[2px] origin-left scale-x-0 rounded-full transition-transform duration-500 group-hover:scale-x-100', t.bar)} aria-hidden />
      </motion.button>
    );
  };

// ---------------------------------------------------------------------------- overlays
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export const SlideOver: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: string }> =
  ({ open, onClose, title, subtitle, children, width = 'max-w-md' }) => {
    useEscape(open, onClose);
    return (
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
            <motion.button aria-label="Close panel" className="absolute inset-0 bg-cc-text/25 backdrop-blur-[2px]" onClick={onClose}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className={cx('relative flex h-full w-full flex-col border-l border-cc-border bg-cc-surface shadow-pop', width)}
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 360, damping: 38 }}>
              <header className="flex items-start justify-between gap-3 border-b border-cc-border px-6 py-5">
                <div className="min-w-0">
                  <div className="display text-2xl leading-tight text-cc-text">{title}</div>
                  {subtitle && <div className="mt-1 text-xs text-cc-muted">{subtitle}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
              </header>
              <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    );
  };

export const Dialog: React.FC<{ open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }> =
  ({ open, onClose, title, subtitle, children, wide }) => {
    useEscape(open, onClose);
    return (
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
            <motion.button aria-label="Close dialog" className="absolute inset-0 bg-cc-text/30 backdrop-blur-[3px]" onClick={onClose}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className={cx('relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl border border-cc-border bg-cc-surface shadow-pop', wide ? 'max-w-3xl' : 'max-w-lg')}
              initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ duration: 0.35, ease: EASE }}>
              <header className="flex items-start justify-between gap-3 border-b border-cc-border px-6 py-5">
                <div>
                  <h2 className="display text-2xl leading-tight">{title}</h2>
                  {subtitle && <p className="mt-1 text-xs text-cc-muted">{subtitle}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
              </header>
              <div className="overflow-y-auto px-6 py-5">{children}</div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }> = ({ label, children, hint, className }) => (
  <label className={cx('block', className)}>
    <span className="label">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-[11px] text-cc-faint">{hint}</span>}
  </label>
);

export const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex items-start justify-between gap-4 border-b border-dashed border-cc-border py-2 text-sm last:border-0">
    <span className="text-cc-muted">{k}</span>
    <span className="min-w-0 break-words text-right font-medium text-cc-text">{v}</span>
  </div>
);

export const SourceLink: React.FC<{ href: string; label?: string }> = ({ href, label = 'Official source' }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium text-cc-accent underline decoration-cc-accent/30 underline-offset-4 hover:decoration-cc-accent">
    {label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
  </a>
);

export const Tabs: React.FC<{ tabs: { id: string; label: React.ReactNode }[]; value: string; onChange: (id: string) => void }> = ({ tabs, value, onChange }) => {
  const id = useId();
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-cc-border px-3">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('relative whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition-colors', value === t.id ? 'text-cc-text' : 'text-cc-muted hover:text-cc-text')}>
          {t.label}
          {value === t.id && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-cc-text" transition={SPRING} />}
        </button>
      ))}
    </div>
  );
};

/** Segmented control (pills) with a sliding thumb. */
export const Segmented: React.FC<{ options: { id: string; label: React.ReactNode }[]; value: string; onChange: (id: string) => void; className?: string }> =
  ({ options, value, onChange, className }) => {
    const id = useId();
    return (
      <div role="radiogroup" className={cx('inline-flex rounded-full bg-cc-hover p-0.5', className)}>
        {options.map(o => (
          <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            className={cx('relative rounded-full px-3 py-1 text-xs font-medium transition-colors', value === o.id ? 'text-cc-text' : 'text-cc-muted hover:text-cc-text')}>
            {value === o.id && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-cc-surface shadow-[0_1px_3px_rgb(19_31_42/0.15)]" transition={SPRING} />}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    );
  };

/** Re-mounts children with a soft fade whenever `k` changes (used for route transitions). */
export const FadeSwap: React.FC<{ k: string; children: React.ReactNode; className?: string }> = ({ k, children, className }) => {
  const [first, setFirst] = useState(true);
  useEffect(() => { setFirst(false); }, []);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} className={className} initial={first ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.28, ease: EASE }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
