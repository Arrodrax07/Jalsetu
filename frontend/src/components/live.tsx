/** Live-telemetry building blocks. Every value shown comes from the last accepted real GPS fix and real timestamps. */
import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2 } from './icons';
import { cx, formatAge, ProvMark, type TrackingState } from './ui';
import { DUR, EASE_OUT, SPRING, SPRING_SOFT } from '../motion';

/**
 * How fresh the last fix is, on the same scale the server uses: live window, stale window, offline beyond.
 * The needle moves every second, so a phone that stops reporting is visibly ageing before it changes state.
 */
export const FreshnessMeter: React.FC<{ age: number | null; liveSeconds: number; offlineSeconds: number; className?: string }> = ({ age, liveSeconds, offlineSeconds, className }) => {
  const span = offlineSeconds * 1.5;
  const pos = age == null ? 1 : Math.min(1, age / span);
  const liveW = liveSeconds / span, staleW = (offlineSeconds - liveSeconds) / span;
  const state: TrackingState = age == null ? 'no_signal' : age <= liveSeconds ? 'live' : age <= offlineSeconds ? 'stale' : 'offline';
  return (
    <div className={cx('w-full', className)} role="meter" aria-valuemin={0} aria-valuemax={span} aria-valuenow={age ?? span}
      aria-label={age == null ? 'No fix yet' : `Last fix ${formatAge(age)} ago, ${state}`}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-cc-hover">
        <div className="absolute inset-y-0 left-0 bg-cc-live/35" style={{ width: `${liveW * 100}%` }} />
        <div className="absolute inset-y-0 bg-cc-stale/30" style={{ left: `${liveW * 100}%`, width: `${staleW * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-cc-offline/25" style={{ left: `${(liveW + staleW) * 100}%` }} />
      </div>
      <div className="relative h-0">
        <motion.span className={cx('absolute -top-[9px] h-3 w-[3px] -translate-x-1/2 rounded-full',
          state === 'live' ? 'bg-cc-live' : state === 'stale' ? 'bg-cc-stale' : state === 'offline' ? 'bg-cc-offline' : 'bg-cc-nosignal')}
          animate={{ left: `${pos * 100}%` }} transition={SPRING_SOFT} />
      </div>
      <div className="mt-2 flex justify-between text-[10.5px] text-cc-faint">
        <span>Live ≤ {liveSeconds}s</span><span>Stale ≤ {formatAge(offlineSeconds)}</span><span>Offline</span>
      </div>
    </div>
  );
};

/** A number that briefly highlights when its source fix changes (so operators see each real update land). */
export const FixValue: React.FC<{ fixKey: string | null | undefined; children: React.ReactNode; className?: string }> = ({ fixKey, children, className }) => {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={fixKey ?? 'none'} className={cx('inline-block', className)}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6, position: 'absolute' }}
        transition={{ duration: DUR.quick, ease: EASE_OUT }}>
        {children}
      </motion.span>
    </AnimatePresence>
  );
};

const STEPS = ['Assigned', 'Accepted', 'En Route', 'Arrived', 'Delivering', 'Delivered', 'Completed'] as const;
const STEP_LABEL: Record<string, string> = { Assigned: 'Assigned', Accepted: 'Accepted', 'En Route': 'On the way', Arrived: 'Arrived', Delivering: 'Delivering', Delivered: 'Delivered', Completed: 'Verified' };

/** Where a trip is in its lifecycle. The filled track grows with a spring when the server moves the trip on. */
export const TripProgress: React.FC<{ status: string; compact?: boolean; className?: string }> = ({ status, compact, className }) => {
  const s = status === 'Planned' ? 'Assigned' : status;
  const idx = Math.max(0, STEPS.indexOf(s as typeof STEPS[number]));
  const cancelled = status === 'Cancelled';
  const pct = (idx / (STEPS.length - 1)) * 100;
  const d = compact ? 10 : 18;
  const last = STEPS.length - 1;
  return (
    <div className={cx('relative', !compact && 'pb-5', className)} aria-label={`Trip status: ${status}`} >
      <div className="absolute h-[2px] rounded-full bg-cc-hover" style={{ left: d / 2, right: d / 2, top: d / 2 - 1 }} />
      {!cancelled && <motion.div className="absolute h-[2px] rounded-full bg-cc-accent" style={{ left: d / 2, top: d / 2 - 1 }} initial={false}
        animate={{ width: `calc(${pct}% - ${(pct / 100) * d}px)` }} transition={SPRING_SOFT} />}
      <ol className="relative flex justify-between" aria-hidden={compact || undefined}>
        {STEPS.map((st, i) => {
          const done = !cancelled && i < idx, here = !cancelled && i === idx;
          return (
            <li key={st} className="relative flex flex-col items-center" style={{ width: d }}>
              <motion.span initial={false} animate={{ scale: here ? 1.15 : 1 }} transition={SPRING} style={{ width: d, height: d }}
                className={cx('flex items-center justify-center rounded-full transition-colors duration-300', compact ? 'border-[1.5px]' : 'border-2',
                  done ? 'border-cc-accent bg-cc-accent text-white' : here ? 'border-cc-accent bg-cc-surface' : 'border-cc-border bg-cc-surface')}>
                {!compact && (done ? <CheckCircle2 className="h-3 w-3" weight="bold" /> : here ? <span className="h-1.5 w-1.5 rounded-full bg-cc-accent" /> : null)}
              </motion.span>
              {!compact && (here || (i === 0 && idx > 1) || (i === last && idx < last - 1)) && <span className={cx('absolute top-6 whitespace-nowrap text-[10.5px]', i === 0 ? 'left-0' : i === last ? 'right-0' : 'left-1/2 -translate-x-1/2',
                here ? 'font-semibold text-cc-text' : done ? 'text-cc-muted' : 'text-cc-faint', here && i !== 0 && i !== last && 'rounded-full bg-cc-accent/10 px-1.5 text-cc-accent-strong')}>{STEP_LABEL[st]}</span>}
              {!compact && <span className="sr-only">{STEP_LABEL[st]}{done ? ' done' : here ? ' current' : ''}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/** Compact live indicator for list rows: state mark + ageing text. */
export const LiveAge: React.FC<{ state: TrackingState; age: number | null }> = ({ state, age }) => (
  <span className={cx('inline-flex items-center gap-1.5 text-[11.5px]', state === 'live' ? 'text-green-800' : state === 'stale' ? 'text-amber-800' : state === 'offline' ? 'text-red-700' : 'text-cc-muted')}>
    <ProvMark kind={state} />
    {state === 'no_signal' ? 'no fix yet' : <span className="mono">{formatAge(age ?? 0)}</span>}
  </span>
);
