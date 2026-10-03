/**
 * Opening sequence (~3.5 s on every page load, skippable with any click or key):
 * a drop falls, ripples spread, Maharashtra's real outline draws itself, district HQs light up
 * (drought-hit Beed and Latur in terracotta), then the wordmark rises and the curtain lifts.
 * Pure SVG + Motion: resolution-independent and ~0 kB of media.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MAHARASHTRA } from '../assets/maharashtra';
import { EASE } from './ui';

const CRISIS = new Set(['Beed', 'Latur']);

/** The intro plays on every full page load (refresh / new tab); in-app navigation never replays it. */
export function useIntro(): [boolean, () => void] {
  const [show, setShow] = useState(true);
  return [show, () => setShow(false)];
}

/** Maharashtra outline with optional draw-on animation. Reused by the intro and the sign-in page. */
export const MaharashtraArt: React.FC<{ draw?: boolean; delay?: number; className?: string; dots?: boolean; labels?: boolean }> =
  ({ draw = true, delay = 0, className, dots = true, labels = true }) => {
    const [w, h] = MAHARASHTRA.viewBox.split(' ').slice(2).map(Number);
    const cities = Object.entries(MAHARASHTRA.cities);
    return (
      <svg viewBox={`-40 -40 ${w + 80} ${h + 80}`} className={className} aria-hidden>
        <defs>
          <linearGradient id="mh-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0c6e96" stopOpacity="0.10" />
            <stop offset="1" stopColor="#0c6e96" stopOpacity="0.02" />
          </linearGradient>
          <pattern id="mh-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="9" stroke="#0c6e96" strokeOpacity="0.09" strokeWidth="1.2" />
          </pattern>
        </defs>
        <motion.path d={MAHARASHTRA.d} fill="url(#mh-fill)" initial={{ opacity: draw ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.9, duration: 0.8 }} />
        <motion.path d={MAHARASHTRA.d} fill="url(#mh-hatch)" initial={{ opacity: draw ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: delay + 1.1, duration: 0.8 }} />
        <motion.path d={MAHARASHTRA.d} fill="none" stroke="#131f2a" strokeWidth="2.2" strokeLinejoin="round"
          initial={{ pathLength: draw ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ delay, duration: 1.4, ease: [0.65, 0, 0.35, 1] }} />
        {dots && cities.map(([name, [x, y]], i) => {
          const hot = CRISIS.has(name);
          return (
            <motion.g key={name} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${x}px ${y}px` }}
              transition={{ delay: delay + 0.9 + i * 0.07, type: 'spring', stiffness: 380, damping: 22 }}>
              {hot && (
                <motion.circle cx={x} cy={y} r={10} fill="none" stroke="#cc5422" strokeWidth="2"
                  animate={{ r: [10, 34], opacity: [0.7, 0] }} transition={{ delay: delay + 1.6, duration: 1.6, repeat: Infinity, ease: 'easeOut' }} />
              )}
              <circle cx={x} cy={y} r={hot ? 9 : 6} fill={hot ? '#cc5422' : '#0c6e96'} stroke="#fff" strokeWidth="2.5" />
              {labels && <text x={x + 13} y={y + 5} fontSize="22" fontFamily="Geist, sans-serif" fill={hot ? '#a8401a' : '#3c4a56'} fontWeight={hot ? 600 : 500}>{name}</text>}
            </motion.g>
          );
        })}
      </svg>
    );
  };

export const Intro: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const reduce = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    // Start the countdown only once the page is actually visible (a page opened in a background tab
    // should still show the whole sequence when the user switches to it).
    let t: ReturnType<typeof setTimeout> | undefined;
    const start = () => { if (!t && document.visibilityState === 'visible') t = setTimeout(() => setLeaving(true), reduce ? 2600 : 3400); };
    const skip = () => setLeaving(true);
    start();
    document.addEventListener('visibilitychange', start);
    window.addEventListener('keydown', skip);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', start); window.removeEventListener('keydown', skip); };
  }, [reduce]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!leaving && (
        <motion.div key="intro" className="contours fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-cc-bg"
          onClick={() => setLeaving(true)} role="presentation"
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: '-4%', filter: 'blur(6px)' }} transition={{ duration: 0.7, ease: EASE }}>
          {/* falling drop */}
          {!reduce && (
            <motion.svg viewBox="0 0 32 32" className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 text-cc-accent"
              initial={{ y: '-55vh', opacity: 0, scaleY: 1.25 }} animate={{ y: ['-55vh', '-2vh', '-2vh'], opacity: [0, 1, 0], scaleY: [1.25, 1.1, 0.4] }}
              transition={{ duration: 0.85, times: [0, 0.82, 1], ease: 'easeIn' }}>
              <path d="M16 3.5c-4.6 6-8.5 10.6-8.5 15.2A8.5 8.5 0 0 0 16 27.2a8.5 8.5 0 0 0 8.5-8.5C24.5 14.1 20.6 9.5 16 3.5Z" fill="currentColor" />
            </motion.svg>
          )}
          {/* ripples */}
          {!reduce && [0, 1, 2].map(i => (
            <motion.span key={i} className="absolute left-1/2 top-1/2 rounded-full border border-cc-accent/40"
              style={{ width: 20, height: 20, marginLeft: -10, marginTop: -10 }}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 28 + i * 10], opacity: [0.9, 0] }}
              transition={{ delay: 0.78 + i * 0.18, duration: 1.8, ease: [0.16, 1, 0.3, 1] }} />
          ))}

          <motion.div className="relative w-[min(560px,78vw)]" initial={{ opacity: 0, scale: reduce ? 1 : 0.94 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: reduce ? 0 : 0.85, duration: 0.9, ease: EASE }}>
            <MaharashtraArt delay={reduce ? 0.1 : 0.95} />
          </motion.div>

          <div className="relative mt-4 text-center">
            <motion.h1 className="display text-[64px] leading-none text-cc-text md:text-[84px]"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: reduce ? 1.2 : 2.05, duration: 0.8, ease: EASE }}>
              Jal<em className="text-cc-accent">Setu</em>
            </motion.h1>
            <motion.p className="mt-3 text-[13px] uppercase tracking-[0.28em] text-cc-muted"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 1.5 : 2.4, duration: 0.6 }}>
              Water, where it is needed most
            </motion.p>
            <div className="mx-auto mt-6 h-px w-48 overflow-hidden bg-cc-border">
              <motion.div className="h-full bg-cc-text" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ transformOrigin: 'left' }}
                transition={{ duration: reduce ? 2.5 : 3.3, ease: 'linear' }} />
            </div>
          </div>
          <p className="absolute bottom-6 text-[11px] text-cc-faint">Click or press any key to skip</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
