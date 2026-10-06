/**
 * JalSetu UI kit. Status and provenance are never conveyed by colour alone: every chip carries a glyph and text.
 * Motion values come from ../motion (see the rules there).
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, Radio, X,
} from './icons';
import { DUR, EASE_OUT, SPRING, SPRING_SHEET, fadeUp } from '../motion';

export { EASE, SPRING } from '../motion';
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------- motion helpers
/** Children fade and lift in, staggered. Wrap a list or grid whose order carries meaning. */
export const Stagger: React.FC<{ children: React.ReactNode; className?: string; delay?: number; step?: number; as?: 'div' | 'ul' | 'ol' }> =
  ({ children, className, delay = 0, step = 0.035, as = 'div' }) => {
    const Tag = motion[as];
    return (
      <Tag className={className} initial="hidden" animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}>
        {children}
      </Tag>
    );
  };
export const itemVariants = fadeUp;
export const Item: React.FC<{ children: React.ReactNode; className?: string; as?: 'div' | 'li' }> = ({ children, className, as = 'div' }) => {
  const Tag = motion[as];
  return <Tag className={className} variants={itemVariants}>{children}</Tag>;
};

/** Counts a number up when it first appears and eases between later values (changes read as changes). */
export const CountUp: React.FC<{ value: number; format?: (n: number) => string; className?: string; duration?: number }> =
  ({ value, format = n => Math.round(n).toLocaleString('en-IN'), className, duration = 0.9 }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const seen = useInView(ref, { once: true });
    const reduce = useReducedMotion();
    const from = useRef(0);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      if (!seen || reduce) { el.textContent = format(value); from.current = value; return; }
      const ctl = animate(from.current, value, { duration, ease: EASE_OUT, onUpdate: v => { el.textContent = format(v); } });
      from.current = value;
      return () => ctl.stop();
    }, [value, seen, reduce, duration, format]);
    return <span ref={ref} className={cx('num', className)}>{format(0)}</span>;
  };

// ---------------------------------------------------------------------------- layout
export const Panel: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode; eyebrow?: string; flush?: boolean }> =
  ({ title, actions, className, bodyClassName, children, eyebrow, flush }) => (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}
      className={cx(flush ? 'flex min-w-0 flex-col' : 'panel flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <header className={cx('flex flex-wrap items-center justify-between gap-x-3 gap-y-2', flush ? 'pb-3' : 'border-b border-cc-border px-5 py-3')}>
          <div className="min-w-0">
            {eyebrow && <p className="mb-0.5 text-[11px] font-medium text-cc-faint">{eyebrow}</p>}
            {title && <h2 className="text-balance text-[14px] font-semibold text-cc-text">{title}</h2>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0', bodyClassName ?? (flush ? '' : 'p-5'))}>{children}</div>
    </motion.section>
  );

export const PageHeader: React.FC<{ title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }> = ({ title, subtitle, actions, eyebrow }) => (
  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT }}
    className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      {eyebrow && <p className="mb-1.5 text-[12px] font-medium text-cc-accent">{eyebrow}</p>}
      <h1 className="display text-[28px] leading-[1.08] text-cc-text md:text-[32px]">{title}</h1>
      {subtitle && <p className="mt-2 max-w-[68ch] text-[13.5px] leading-relaxed text-cc-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </motion.div>
);

// ---------------------------------------------------------------------------- buttons
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-cc-ink text-cc-on-ink hover:bg-cc-ink/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(var(--cc-shadow)/0.2)]',
  secondary: 'bg-cc-surface text-cc-text border border-cc-border hover:border-cc-strong hover:bg-cc-raised shadow-[0_1px_0_rgb(var(--cc-shadow)/0.04)]',
  danger: 'bg-cc-danger/[0.08] text-red-700 border border-cc-danger/25 hover:bg-cc-danger/[0.14]',
  ghost: 'text-cc-muted hover:text-cc-text hover:bg-cc-hover',
  success: 'bg-cc-accent text-white hover:bg-cc-accent/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(var(--cc-shadow)/0.2)]',
};
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: React.ReactNode }> =
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }) => (
    <motion.button
      {...(rest as React.ComponentProps<typeof motion.button>)}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={SPRING}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : size === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-9 px-3.5 text-[13.5px]', BTN[variant], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </motion.button>
  );

// ---------------------------------------------------------------------------- chips
export type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'seeded' | 'external' | 'predicted' | 'estimated';
const CHIP: Record<ChipTone, string> = {
  neutral: 'bg-cc-hover text-cc-muted',
  accent: 'bg-cc-accent/10 text-cc-accent-strong',
  ok: 'bg-cc-ok/10 text-green-800',
  warn: 'bg-cc-warn/[0.12] text-amber-800',
  danger: 'bg-cc-danger/10 text-red-700',
  seeded: 'bg-cc-seeded/10 text-violet-700',
  external: 'bg-cc-external/10 text-sky-800',
  predicted: 'bg-cc-predicted/10 text-pink-700',
  estimated: 'bg-cc-estimated/[0.12] text-amber-800',
};
export const Chip: React.FC<{ tone?: ChipTone; icon?: React.ReactNode; children: React.ReactNode; title?: string; className?: string }> =
  ({ tone = 'neutral', icon, children, title, className }) => (
    <span title={title} className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium leading-none', CHIP[tone], className)}>
      {icon}{children}
    </span>
  );

// ---------------------------------------------------------------------------- provenance & freshness
/**
 * The trust language. Shape says how we know; colour only reinforces it.
 *   observed  (solid mark)    live GPS, official external feeds, staff entries, citizen reports
 *   derived   (outlined mark) estimates and model predictions
 *   reference (hatched mark)  seeded reference data, synthetic demo history
 *   freshness (degraded mark) stale: hollow ring;  offline: struck through;  no signal: dashed
 */
export type ProvenanceKind = 'live' | 'external' | 'manual' | 'citizen' | 'estimated' | 'predicted' | 'rule' | 'seeded' | 'reference' | 'synthetic' | 'stale' | 'offline' | 'no_signal';
const PROV: Record<ProvenanceKind, { label: string; color: string; mark: 'solid' | 'pulse' | 'outline' | 'dashed' | 'hatch' | 'hollow' | 'struck'; title: string }> = {
  live: { label: 'Live', color: 'text-cc-live', mark: 'pulse', title: 'Observed now from device GPS' },
  external: { label: 'External', color: 'text-cc-external', mark: 'solid', title: 'Imported from an official or open source; see provenance' },
  manual: { label: 'Staff entry', color: 'text-cc-muted', mark: 'solid', title: 'Entered by staff' },
  citizen: { label: 'Citizen', color: 'text-cc-accent', mark: 'solid', title: 'Submitted through the public portal' },
  estimated: { label: 'Estimated', color: 'text-cc-estimated', mark: 'outline', title: 'Derived from norms and assumptions, not measured' },
  predicted: { label: 'ML prediction', color: 'text-cc-predicted', mark: 'dashed', title: 'Model output; advisory' },
  rule: { label: 'Rule-based', color: 'text-cc-accent', mark: 'outline', title: 'Computed by transparent weighted rules' },
  seeded: { label: 'Seeded', color: 'text-cc-seeded', mark: 'hatch', title: 'Reference / seed record, not live or official data' },
  reference: { label: 'Reference', color: 'text-cc-seeded', mark: 'hatch', title: 'Reference data' },
  synthetic: { label: 'Synthetic', color: 'text-cc-predicted', mark: 'hatch', title: 'Labelled demo history; never used operationally' },
  stale: { label: 'Stale', color: 'text-cc-stale', mark: 'hollow', title: 'Last observation is older than the live window' },
  offline: { label: 'Offline', color: 'text-cc-offline', mark: 'struck', title: 'No observation for longer than the offline threshold' },
  no_signal: { label: 'No signal', color: 'text-cc-nosignal', mark: 'dashed', title: 'Nothing observed yet' },
};

export const ProvMark: React.FC<{ kind: ProvenanceKind; className?: string }> = ({ kind, className }) => {
  const p = PROV[kind];
  const base = 'relative inline-block h-2 w-2 flex-shrink-0 rounded-full';
  return (
    <span aria-hidden className={cx(base, p.color, className)}>
      {p.mark === 'solid' && <span className="absolute inset-0 rounded-full bg-current" />}
      {p.mark === 'pulse' && <><span className="vm-ring absolute inset-0 rounded-full bg-current" /><span className="absolute inset-0 rounded-full bg-current" /></>}
      {p.mark === 'outline' && <span className="absolute inset-0 rounded-full border-[1.5px] border-current" />}
      {p.mark === 'dashed' && <span className="absolute -inset-px rounded-full border-[1.5px] border-dashed border-current" />}
      {p.mark === 'hatch' && <span className="hatch absolute inset-0 rounded-[2px] border border-current" />}
      {p.mark === 'hollow' && <span className="absolute inset-0 rounded-full border-2 border-current" />}
      {p.mark === 'struck' && <><span className="absolute inset-0 rounded-full border-[1.5px] border-current" /><span className="absolute left-[-2px] top-[3px] h-[1.5px] w-3 -rotate-45 bg-current" /></>}
    </span>
  );
};

export const Provenance: React.FC<{ kind: ProvenanceKind; label?: string; title?: string; className?: string }> = ({ kind, label, title, className }) => {
  const p = PROV[kind];
  return (
    <span title={title || p.title} className={cx('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-cc-border bg-cc-surface px-2 text-[11.5px] font-medium text-cc-muted', className)}>
      <ProvMark kind={kind} />{label || p.label}
    </span>
  );
};

export type TrackingState = 'live' | 'stale' | 'offline' | 'no_signal';
export const TrackingBadge: React.FC<{ state: TrackingState; ageSeconds?: number | null; compact?: boolean }> = ({ state, ageSeconds, compact }) => {
  const label = { live: 'Live', stale: 'Stale', offline: 'Offline', no_signal: 'No signal' }[state];
  const tone = { live: 'bg-cc-live/10 text-green-800', stale: 'bg-cc-stale/[0.12] text-amber-800', offline: 'bg-cc-offline/10 text-red-700', no_signal: 'bg-cc-hover text-cc-muted' }[state];
  return (
    <motion.span layout="position" key={state} initial={{ opacity: 0.4, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING}
      title={ageSeconds != null ? `Last fix ${formatAge(ageSeconds)} ago` : 'No position received yet'}
      className={cx('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium', tone)}>
      <ProvMark kind={state} />
      {label}{!compact && ageSeconds != null && state !== 'no_signal' ? <span className="mono opacity-80">{formatAge(ageSeconds)}</span> : null}
    </motion.span>
  );
};

export function formatAge(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const ORIGIN_KIND: Record<string, ProvenanceKind> = { seeded: 'seeded', manual: 'manual', external: 'external', citizen: 'citizen', synthetic: 'synthetic', derived: 'estimated' };
export const OriginLabel: React.FC<{ origin?: string | null }> = ({ origin }) => <Provenance kind={ORIGIN_KIND[origin || 'manual'] || 'manual'} />;

export const KindLabel: React.FC<{ kind: 'predicted' | 'estimated' | 'live-gps' | 'external-alert' | 'rule-based'; title?: string }> = ({ kind, title }) => {
  const k: ProvenanceKind = kind === 'live-gps' ? 'live' : kind === 'external-alert' ? 'external' : kind === 'rule-based' ? 'rule' : kind;
  return <Provenance kind={k} title={title} label={kind === 'live-gps' ? 'Live GPS' : kind === 'external-alert' ? 'Official alert' : undefined} />;
};

export const SEVERITY_TONE: Record<string, ChipTone> = { Extreme: 'danger', Severe: 'danger', Moderate: 'warn', Minor: 'accent', Unknown: 'neutral' };
export const SEVERITY_COLOR: Record<string, string> = { Extreme: '#a01e1a', Severe: '#c44e20', Moderate: '#b47c06', Minor: '#2462c4', Unknown: '#808c96' };
export const SeverityChip: React.FC<{ severity: string }> = ({ severity }) => (
  <Chip tone={SEVERITY_TONE[severity] || 'neutral'} icon={severity === 'Extreme' || severity === 'Severe' ? <AlertOctagon className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}>
    {severity}
  </Chip>
);

const STATUS_TONE: Record<string, ChipTone> = {
  Completed: 'ok', Verified: 'ok', Delivered: 'ok', Resolved: 'ok', Available: 'ok', Approved: 'ok', connected: 'ok', healthy: 'ok', receiving: 'ok',
  'En Route': 'accent', 'On Trip': 'accent', Arrived: 'accent', Delivering: 'accent', Accepted: 'accent', Assigned: 'accent', Allocated: 'accent', Dispatched: 'accent', Proposed: 'accent',
  Pending: 'neutral', Planned: 'neutral', 'Pending Verification': 'warn', Escalated: 'warn', degraded: 'warn', unknown: 'neutral', idle: 'neutral', awaiting_credentials: 'neutral',
  Merged: 'neutral', Mismatch: 'danger', 'Under Investigation': 'danger', Maintenance: 'danger', Cancelled: 'neutral', Rejected: 'neutral', down: 'danger', unavailable: 'danger',
  Critical: 'danger', High: 'warn', Medium: 'accent', Low: 'neutral', 'High Demand': 'warn', Normal: 'neutral', 'Recently Served': 'ok',
};
export const StatusChip: React.FC<{ status: string; label?: string }> = ({ status, label }) => {
  const tone = STATUS_TONE[status] || 'neutral';
  const icon = tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : tone === 'danger' ? <AlertOctagon className="h-3.5 w-3.5" />
    : tone === 'warn' ? <AlertTriangle className="h-3.5 w-3.5" /> : tone === 'accent' ? <Radio className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full border border-current" />;
  return <Chip tone={tone} icon={icon}>{label || status.replace(/_/g, ' ')}</Chip>;
};

// ---------------------------------------------------------------------------- states
export const Empty: React.FC<{ title: string; hint?: React.ReactNode; icon?: React.ReactNode; className?: string; action?: React.ReactNode }> = ({ title, hint, icon, className, action }) => (
  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}
    className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
    <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-cc-strong text-cc-faint">{icon || <Info className="h-5 w-5" />}</div>
    <p className="text-[13.5px] font-medium text-cc-text">{title}</p>
    {hint && <p className="max-w-sm text-[12.5px] leading-relaxed text-cc-muted">{hint}</p>}
    {action && <div className="mt-2">{action}</div>}
  </motion.div>
);

export const Loading: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading', className }) => (
  <div role="status" aria-live="polite" className={cx('flex flex-col gap-2.5 px-5 py-8', className)}>
    <span className="sr-only">{label}</span>
    {[72, 100, 88, 64].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />)}
    <p className="mt-1 text-[12px] text-cc-faint" aria-hidden>{label}</p>
  </div>
);

export const Skeleton: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <div style={style} className={cx('shimmer relative overflow-hidden rounded-md bg-cc-hover', className)} />
);

export const ErrorBox: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <motion.div role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.quick }}
    className="flex items-start gap-3 rounded-control border border-cc-danger/25 bg-cc-danger/[0.06] p-3 text-[13px] text-red-800">
    <AlertOctagon className="mt-0.5 h-4 w-4 flex-shrink-0" />
    <div className="flex-1">{message}</div>
    {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
  </motion.div>
);

// ---------------------------------------------------------------------------- metrics
export type KpiTone = 'default' | 'danger' | 'warn' | 'ok' | 'accent' | 'violet' | 'teal';
const KPI_VALUE: Record<KpiTone, string> = {
  default: 'text-cc-text', danger: 'text-red-700', warn: 'text-amber-800', ok: 'text-cc-text', accent: 'text-cc-text', violet: 'text-cc-text', teal: 'text-cc-text',
};
const KPI_BAR: Record<KpiTone, string> = {
  default: 'bg-cc-strong', danger: 'bg-cc-danger', warn: 'bg-cc-warn', ok: 'bg-cc-ok', accent: 'bg-cc-accent', violet: 'bg-cc-violet', teal: 'bg-cc-teal',
};
/** A metric: label, the number, one line of context. No card box; strips are separated by hairlines. */
export const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: KpiTone; icon?: React.ReactNode; onClick?: () => void; className?: string }> =
  ({ label, value, sub, tone = 'default', icon, onClick, className }) => {
    const numeric = typeof value === 'number';
    return (
      <motion.button type="button" onClick={onClick} disabled={!onClick} variants={itemVariants}
        className={cx('group relative min-w-0 rounded-card px-3 py-3.5 text-left sm:px-4 transition-colors duration-150 disabled:cursor-default',
          onClick && 'hover:bg-cc-hover/70 focus-visible:bg-cc-hover/70', className)}>
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-cc-muted">
          {icon && <span className="kpi-icon flex-shrink-0 text-cc-faint transition-colors group-hover:text-cc-text">{icon}</span>}
          <span className="truncate">{label}</span>
        </p>
        <p className={cx('display mt-1.5 truncate text-[24px] leading-none sm:text-[30px]', KPI_VALUE[tone])}>
          {numeric ? <CountUp value={value as number} /> : value}
        </p>
        {sub && <p className="mt-1.5 truncate text-[12px] text-cc-muted">{sub}</p>}
        <span className={cx('absolute bottom-0 left-4 h-[2px] w-6 rounded-full transition-[width] duration-300 ease-out group-hover:w-12', KPI_BAR[tone], !onClick && 'opacity-60')} aria-hidden />
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

/** Keeps focus inside an open overlay and restores it to the opener on close. */
function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = () => node?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    setTimeout(() => first()?.focus(), 40);
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return;
      const f = [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.hasAttribute('disabled'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    node?.addEventListener('keydown', trap);
    return () => { node?.removeEventListener('keydown', trap); prev?.focus?.(); };
  }, [open]);
  return ref;
}

/** Contextual surface that slides in from the right edge; the page stays visible behind it. */
export const SlideOver: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: string; modal?: boolean }> =
  ({ open, onClose, title, subtitle, children, width = 'max-w-md', modal = true }) => {
    useEscape(open, onClose);
    const ref = useFocusTrap(open && modal);
    const reduce = useReducedMotion();
    return (
      <AnimatePresence>
        {open && (
          <div className={cx('fixed inset-0 z-drawer flex justify-end', !modal && 'pointer-events-none')} role="dialog" aria-modal={modal}>
            {modal && <motion.button aria-label="Close panel" tabIndex={-1} className="absolute inset-0 bg-cc-sunken/40 backdrop-blur-[2px]" onClick={onClose}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.quick }} />}
            <motion.aside ref={ref} className={cx('pointer-events-auto relative flex h-full w-full flex-col border-l border-cc-border bg-cc-surface shadow-pop', width)}
              initial={reduce ? { opacity: 0 } : { x: '100%' }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x: '100%' }} transition={SPRING_SHEET}>
              <header className="flex items-start justify-between gap-3 border-b border-cc-border px-6 py-4">
                <div className="min-w-0">
                  <div className="display text-[22px] leading-tight text-cc-text">{title}</div>
                  {subtitle && <div className="mt-1 text-[12.5px] text-cc-muted">{subtitle}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!w-8 !px-0"><X className="h-4 w-4" /></Button>
              </header>
              <motion.div className="flex-1 overflow-y-auto px-6 py-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08, duration: DUR.base }}>
                {children}
              </motion.div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    );
  };

export const Dialog: React.FC<{ open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }> =
  ({ open, onClose, title, subtitle, children, wide }) => {
    useEscape(open, onClose);
    const ref = useFocusTrap(open);
    return (
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-drawer flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
            <motion.button aria-label="Close dialog" tabIndex={-1} className="absolute inset-0 bg-cc-sunken/50 backdrop-blur-[3px]" onClick={onClose}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.quick }} />
            <motion.div ref={ref} className={cx('relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[18px] border border-cc-border bg-cc-surface shadow-pop sm:rounded-card', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
              initial={{ opacity: 0, y: 24, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.985 }} transition={SPRING_SHEET}>
              <header className="flex items-start justify-between gap-3 border-b border-cc-border px-6 py-4">
                <div>
                  <h2 className="display text-[20px] leading-tight">{title}</h2>
                  {subtitle && <p className="mt-1 text-[12.5px] text-cc-muted">{subtitle}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!w-8 !px-0"><X className="h-4 w-4" /></Button>
              </header>
              <div className="overflow-y-auto px-6 py-5">{children}</div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string; error?: string | null }> = ({ label, children, hint, className, error }) => (
  <label className={cx('block', className)}>
    <span className="label">{label}</span>
    {children}
    {error ? <span role="alert" className="mt-1 block text-[11.5px] text-red-700">{error}</span> : hint && <span className="mt-1 block text-[11.5px] text-cc-faint">{hint}</span>}
  </label>
);

export const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex items-start justify-between gap-4 border-b border-cc-border/70 py-2 text-[13px] last:border-0">
    <span className="text-cc-muted">{k}</span>
    <span className="min-w-0 break-words text-right font-medium text-cc-text">{v}</span>
  </div>
);

export const SourceLink: React.FC<{ href: string; label?: string }> = ({ href, label = 'Official source' }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[13px] font-medium text-cc-accent underline decoration-cc-accent/30 underline-offset-4 hover:decoration-cc-accent">
    {label} <ExternalLink className="h-3.5 w-3.5" />
  </a>
);

export const Tabs: React.FC<{ tabs: { id: string; label: React.ReactNode }[]; value: string; onChange: (id: string) => void; className?: string }> = ({ tabs, value, onChange, className }) => {
  const id = useId();
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    onChange(n.id);
    (e.currentTarget.parentElement?.querySelector(`[data-tab="${n.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-cc-border px-3', className)}>
      {tabs.map((t, i) => (
        <button key={t.id} role="tab" data-tab={t.id} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={e => onKey(e, i)}
          className={cx('relative whitespace-nowrap px-2 py-3 text-[13px] font-medium transition-colors duration-150', value === t.id ? 'text-cc-text' : 'text-cc-muted hover:text-cc-text')}>
          {t.label}
          {value === t.id && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-cc-accent" transition={SPRING} />}
        </button>
      ))}
    </div>
  );
};

/** Segmented control (pills) with a sliding thumb. */
export const Segmented: React.FC<{ options: { id: string; label: React.ReactNode }[]; value: string; onChange: (id: string) => void; className?: string; label?: string }> =
  ({ options, value, onChange, className, label }) => {
    const id = useId();
    return (
      <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-control bg-cc-hover p-0.5', className)}>
        {options.map(o => (
          <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            className={cx('relative h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors duration-150', value === o.id ? 'text-cc-text' : 'text-cc-muted hover:text-cc-text')}>
            {value === o.id && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[8px] bg-cc-surface shadow-[0_1px_2px_rgb(var(--cc-shadow)/0.16)]" transition={SPRING} />}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    );
  };

/** Route transition: the new page rises into place while the old one steps back. */
export const FadeSwap: React.FC<{ k: string; children: React.ReactNode; className?: string }> = ({ k, children, className }) => {
  const [first, setFirst] = useState(true);
  const reduce = useReducedMotion();
  useEffect(() => { setFirst(false); }, []);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} className={className}
        initial={first ? false : reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(2px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: DUR.instant } }}
        transition={{ duration: DUR.base, ease: EASE_OUT }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
