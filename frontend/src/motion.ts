/**
 * JalSetu motion language. Every animation in the product uses these values.
 *
 *  instant  (120 ms)  operational feedback: press, toggle, hover. Never makes an operator wait.
 *  quick    (200 ms)  small state changes: chip swaps, list reorders, tooltips.
 *  base     (320 ms)  content changes inside a surface: tab panes, filters, table rows.
 *  spatial  (springs) things that travel: drawers, sheets, selection highlights, nav indicator.
 *  map      (1.1 s)   camera moves between places; geography needs time to read.
 *  cinematic(2.4 s)   only the first India -> Maharashtra fly-in.
 *
 * Rules: animate transform and opacity only; content arrives from where it came from (drawers from their edge,
 * map selections expand from the marker); reduced motion keeps short fades and drops travel, loops and pulses.
 */
export const EASE_OUT = [0.2, 0.9, 0.1, 1] as const;          // decisive arrival
export const EASE_SPATIAL = [0.32, 0.72, 0, 1] as const;      // heavy, physical
export const EASE = EASE_OUT;

export const DUR = { instant: 0.12, quick: 0.2, base: 0.32, slow: 0.5, map: 1.1, cinematic: 2.4 } as const;

export const SPRING = { type: 'spring', stiffness: 460, damping: 36, mass: 0.7 } as const;        // indicators, chips
export const SPRING_SHEET = { type: 'spring', stiffness: 340, damping: 36, mass: 0.9 } as const;  // drawers, sheets
export const SPRING_SOFT = { type: 'spring', stiffness: 200, damping: 26 } as const;              // numbers, gauges

export const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
};
