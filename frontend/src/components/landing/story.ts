/**
 * The landing story as one timeline. Scroll gives `p` (0..1); everything in the world and the type is a function of
 * it. Kept free of React so the render loop can read it every frame without re-rendering anything.
 */
export interface Chapter { id: string; label: string; start: number; end: number }

export const CHAPTERS: Chapter[] = [
  { id: 'scale', label: 'Scale', start: 0, end: 0.1 },
  { id: 'problem', label: 'The problem', start: 0.1, end: 0.22 },
  { id: 'jalsetu', label: 'JalSetu', start: 0.22, end: 0.34 },
  { id: 'intelligence', label: 'Intelligence', start: 0.34, end: 0.48 },
  { id: 'live', label: 'Live operations', start: 0.48, end: 0.62 },
  { id: 'disaster', label: 'Disaster response', start: 0.62, end: 0.74 },
  { id: 'network', label: 'The network', start: 0.74, end: 0.84 },
  { id: 'impact', label: 'Impact', start: 0.84, end: 0.93 },
  { id: 'return', label: 'Return', start: 0.93, end: 1 },
];

/** Shared, mutable story clock. `target` follows the scrollbar; `p` eases toward it in the render loop. */
export const clock = { target: 0, p: 0, v: 0, pointerX: 0, pointerY: 0, reduce: false };

/** Advance the story clock with a critically damped spring: every move eases in and settles, never snaps. */
export function stepClock(dt: number) {
  const K = clock.reduce ? 600 : 22, D = 2 * Math.sqrt(K);
  let rem = Math.min(dt, 0.1);
  while (rem > 0) {
    const h = Math.min(rem, 1 / 120);
    clock.v += ((clock.target - clock.p) * K - clock.v * D) * h;
    clock.p += clock.v * h;
    rem -= h;
  }
  if (clock.p < 0) { clock.p = 0; clock.v = 0; } else if (clock.p > 1) { clock.p = 1; clock.v = 0; }
  if (Math.abs(clock.target - clock.p) < 1e-5 && Math.abs(clock.v) < 1e-4) { clock.p = clock.target; clock.v = 0; }
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** 0 before a, 1 after b, eased between. */
export const ramp = (p: number, a: number, b: number) => smooth((p - a) / (b - a));
/** Rises a→b, holds, falls c→d. */
export const band = (p: number, a: number, b: number, c: number, d: number) => Math.min(ramp(p, a, b), 1 - ramp(p, c, d));

export interface Phases {
  chaos: number; sweep: number; places: number; routes: number; spikes: number; focus: number;
  tanker: number; ops: number; disaster: number; national: number; districts: number; calm: number;
  /** cloud banks: only while the camera dives into Maharashtra and climbs back out to India */
  clouds: number;
}

export function phases(p: number): Phases {
  return {
    chaos: band(p, 0.11, 0.2, 0.235, 0.31),
    sweep: clamp01((p - 0.235) / (0.33 - 0.235)),
    places: 0.5 + 0.5 * ramp(p, 0.07, 0.15),
    routes: 1 - 0.55 * band(p, 0.36, 0.42, 0.72, 0.78),
    spikes: band(p, 0.35, 0.42, 0.5, 0.55),
    focus: band(p, 0.4, 0.44, 0.6, 0.64),
    tanker: clamp01((p - 0.5) / (0.6 - 0.5)),
    ops: band(p, 0.48, 0.51, 0.61, 0.64),
    disaster: band(p, 0.63, 0.68, 0.76, 0.81),
    national: Math.max(band(p, 0.76, 0.81, 0.85, 0.89), 0.55 * ramp(p, 0.95, 1)),
    districts: band(p, 0.3, 0.38, 0.76, 0.82),
    calm: ramp(p, 0.84, 0.9),
    clouds: Math.max(band(p, 0.05, 0.1, 0.17, 0.22), band(p, 0.74, 0.78, 0.83, 0.88)),
  };
}

export type V3 = [number, number, number];
export interface Key { p: number; pos: V3; target: V3; fov: number }

/** Camera path. `f` is the focus place, `h` the start of the illustrated tanker run; portrait screens stand further back. */
export function cameraKeys(f: { x: number; z: number }, h: { x: number; z: number }, portrait: boolean): Key[] {
  const mh: V3 = [-1.8, 0, 3.3];
  const mid: V3 = [(f.x + h.x) / 2, 0, (f.z + h.z) / 2];
  const back = portrait ? 1.55 : 1;
  const k = (p: number, pos: V3, target: V3, fov = 38): Key => ({ p, pos: [pos[0], pos[1] * back, pos[2] * (portrait ? 1.25 : 1)], target, fov: portrait ? fov + 10 : fov });
  // landscape: the country sits right of the opening type; portrait: centred under it
  const sx = portrait ? 0 : -8.5;
  return [
    k(0, [0.5 + sx, 33, 23], [1.2 + sx, 0, 1.5], 36),
    k(0.09, [-1.5 + sx * 0.6, 27, 19.5], [0.5 + sx * 0.6, 0, 1.8], 36),
    k(0.2, [-5.5, 10.5, 13.5], mh, 40),
    k(0.235, [-5, 9.6, 12.5], mh, 40),
    k(0.33, [6.5, 9, 11.5], mh, 38),
    k(0.4, [f.x + 2.2, 3.4, f.z + 4.6], [f.x, 0, f.z], 36),
    k(0.47, [f.x + 0.9, 1.15, f.z + 1.9], [f.x, 0.35, f.z], 34),
    k(0.5, [mid[0] + 1.4, 2.6, mid[2] + 3.6], [mid[0], 0, mid[2]], 36),
    k(0.6, [f.x + 1.2, 1.8, f.z + 2.6], [f.x, 0, f.z], 36),
    k(0.66, [1.5, 11, 13], [-0.6, 0, 3], 40),
    k(0.74, [2.5, 10.5, 12.5], [-0.4, 0, 3.2], 40),
    k(0.82, [0, 30, 22], [0.8, 0, 1.5], 38),
    k(0.9, [7, 33, 24], [1, 0, 1], 36),
    k(1, [0, 46, 12], [1, 0, 0.6], 34),
  ];
}

/** Position on the camera path: eased between neighbouring keys, so the camera settles on each chapter. */
export function sampleKeys(keys: Key[], p: number, out: { pos: V3; target: V3; fov: number }) {
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1].p) i++;
  const a = keys[i], b = keys[i + 1];
  const t = smooth((p - a.p) / (b.p - a.p));
  for (let j = 0; j < 3; j++) {
    out.pos[j] = a.pos[j] + (b.pos[j] - a.pos[j]) * t;
    out.target[j] = a.target[j] + (b.target[j] - a.target[j]) * t;
  }
  out.fov = a.fov + (b.fov - a.fov) * t;
  return out;
}

/** Chapter index for a progress value. */
export const chapterAt = (p: number) => Math.max(0, CHAPTERS.findIndex(c => p >= c.start && p < c.end + (c.end === 1 ? 0.001 : 0)));
