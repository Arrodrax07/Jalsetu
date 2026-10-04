/**
 * The landing story as one timeline. Scroll gives `p` (0..1); everything in the world and the type is a function of
 * it. Kept free of React so the render loop can read it every frame without re-rendering anything.
 */
export interface Chapter { id: string; label: string; start: number; end: number }

export const CHAPTERS: Chapter[] = [
  { id: 'scale', label: 'Scale', start: 0, end: 0.09 },
  { id: 'problem', label: 'The problem', start: 0.09, end: 0.19 },
  { id: 'jalsetu', label: 'JalSetu', start: 0.19, end: 0.29 },
  { id: 'intelligence', label: 'Intelligence', start: 0.29, end: 0.4 },
  { id: 'live', label: 'Live operations', start: 0.4, end: 0.5 },
  { id: 'ground', label: 'On the ground', start: 0.5, end: 0.66 },
  { id: 'disaster', label: 'Disaster response', start: 0.66, end: 0.76 },
  { id: 'network', label: 'The network', start: 0.76, end: 0.85 },
  { id: 'impact', label: 'Impact', start: 0.85, end: 0.93 },
  { id: 'return', label: 'Return', start: 0.93, end: 1 },
];

/** The descent to the ground is inserted into the map story: during it the map timeline holds still. `base` maps
 *  page progress onto the map timeline every other phase and camera key was tuned on. */
const NEW = [0, 0.09, 0.19, 0.29, 0.4, 0.5, 0.66, 0.76, 0.85, 0.93, 1];
const OLD = [0, 0.1, 0.22, 0.34, 0.48, 0.62, 0.62, 0.74, 0.84, 0.93, 1];
export function base(p: number) {
  if (p <= 0) return 0;
  for (let i = 1; i < NEW.length; i++) if (p <= NEW[i]) return OLD[i - 1] + ((p - NEW[i - 1]) / (NEW[i] - NEW[i - 1])) * (OLD[i] - OLD[i - 1]);
  return 1;
}
/** Ground chapter timing (page progress): descend through the clouds, drone over the real ground, the tanker arrives,
 *  then climb back out to the exact map view the descent started from. */
export const G = { start: 0.5, drone: 0.555, hold: 0.615, end: 0.66 };

/** Written by the world every frame, read by the page's type layer. */
export const groundState = { arrived: false, stopped: false, delivering: false };

/** Shared, mutable story clock. `target` follows the scrollbar; `p` eases toward it in the render loop. */
export const clock = { target: 0, p: 0, v: 0, pointerX: 0, pointerY: 0, reduce: false };

/** Advance the story clock: one critically damped spring toward the scroll position (settles in ~0.35 s, no overshoot),
 *  with a speed cap so a long jump (scrollbar drag, chapter rail, End key) flies through the journey instead of snapping.
 *  This is the ONLY smoothing between input and camera: native scroll is never hijacked, so wheels, trackpads (which
 *  bring their own inertia), touch and the scrollbar all feel like themselves. */
export function stepClock(dt: number) {
  const K = clock.reduce ? 900 : 90, D = 2 * Math.sqrt(K), VMAX = clock.reduce ? 50 : 0.32;
  let rem = Math.min(dt, 0.1);
  while (rem > 0) {
    const h = Math.min(rem, 1 / 240);
    clock.v += ((clock.target - clock.p) * K - clock.v * D) * h;
    if (clock.v > VMAX) clock.v = VMAX; else if (clock.v < -VMAX) clock.v = -VMAX;
    clock.p += clock.v * h;
    rem -= h;
  }
  if (clock.p < 0) { clock.p = 0; clock.v = 0; } else if (clock.p > 1) { clock.p = 1; clock.v = 0; }
  if (Math.abs(clock.target - clock.p) < 2e-5 && Math.abs(clock.v) < 2e-4) { clock.p = clock.target; clock.v = 0; }
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
  /** cinema bars: while the camera dives into Maharashtra and climbs back out to India */
  clouds: number;
  /** ground chapter: 0..1 progress of the descent, the tanker's drive, the climb; flight = letterbox weight */
  descend: number; drive: number; ascend: number; inGround: number; flight: number;
}

export function phases(pp: number): Phases {
  const p = base(pp);
  return {
    descend: smooth((pp - G.start) / (G.drone - G.start)),
    drive: clamp01((pp - 0.528) / (0.605 - 0.528)),
    ascend: smooth((pp - G.hold) / (G.end - G.hold)),
    inGround: pp > G.start && pp < G.end ? 1 : 0,
    flight: Math.max(band(pp, G.start, 0.512, 0.54, 0.556), band(pp, 0.618, 0.632, 0.648, G.end)),
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
